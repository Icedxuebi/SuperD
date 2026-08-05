// Fills column F (Closure Reason) in merchants-by-ae.xlsx for rows highlighted
// yellow (fill FFFFFF00), keyed by MID in column B, using merchant_info.close_remark.
//
// Writes to a NEW file by default; pass --in-place to overwrite the source.
//
// Run:
//   node --env-file=.env.local scripts/fill-close-remark.mjs --dry-run
//   node --env-file=.env.local scripts/fill-close-remark.mjs --in-place
import pg from "pg";
import ExcelJS from "exceljs";

function flag(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const XLSX_IN = flag("xlsx") ?? "merchants-by-ae.xlsx";
const SHEET = flag("sheet") ?? "Merchants";
const DRY_RUN = process.argv.includes("--dry-run");
const IN_PLACE = process.argv.includes("--in-place");
const OUT = flag("out") ?? (IN_PLACE ? XLSX_IN : XLSX_IN.replace(/\.xlsx$/i, ".filled.xlsx"));

const MID_COL = 2; // B
const REMARK_COL = 6; // F — Closure Reason
const YELLOW = "FFFFFF00";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX_IN);
const ws = wb.getWorksheet(SHEET);
if (!ws) { console.error(`Sheet "${SHEET}" not found in ${XLSX_IN}`); process.exit(1); }

function fillColor(cell) {
  return cell.fill?.fgColor?.argb ?? null;
}

const targetRows = []; // { rowNo, mid }
for (let r = 2; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const mid = String(row.getCell(MID_COL).value ?? "").trim();
  if (!mid) continue;
  if (fillColor(row.getCell(1)) === YELLOW) targetRows.push({ rowNo: r, mid });
}
console.log(`${XLSX_IN} / ${SHEET}: ${targetRows.length} yellow rows to fill`);

const MIDS = [...new Set(targetRows.map((t) => t.mid))];
const pool = new pg.Pool({ connectionString: url, max: 3, statement_timeout: 60_000 });
const { rows } = await pool.query(
  `SELECT merchant_no, close_remark, close_date, state
     FROM merchant_info
    WHERE merchant_no = ANY($1::text[])`,
  [MIDS],
);
await pool.end();

const byMid = new Map(rows.map((r) => [r.merchant_no, r]));

let filled = 0;
let noRemark = [];
for (const { rowNo, mid } of targetRows) {
  const rec = byMid.get(mid);
  const remark = rec?.close_remark?.trim();
  if (!remark) {
    noRemark.push({ mid, state: rec?.state ?? "(not found)" });
    continue;
  }
  if (!DRY_RUN) ws.getRow(rowNo).getCell(REMARK_COL).value = remark;
  filled++;
}

console.log(`filled: ${filled}`);
if (noRemark.length) {
  console.log(`\n${noRemark.length} MID(s) have NO close_remark in DB (left blank):`);
  for (const n of noRemark) console.log(`  ${n.mid}  state=${n.state}`);
}

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written.");
} else {
  await wb.xlsx.writeFile(OUT);
  console.log(`\nWrote -> ${OUT}${IN_PLACE ? "  (in place)" : ""}`);
}
