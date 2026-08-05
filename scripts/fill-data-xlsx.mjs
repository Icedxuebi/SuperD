// Fills the DB-sourced columns of data.xlsx, keyed by the MID in column B.
// Which columns get filled is driven by the instructions already in the header
// row (row 1 of Sheet1):
//
//   E  taxid (or company_tax_id)              -> company_tax_id, else citizen_id
//   J  location (use gen-address-lines.mjs)   -> the address line
//   K  postal_code                            -> postal_code of that SAME address
//   L  bankaccount (use gen_bank)lines.mjs)   -> the bank line, $<code>,<account no>
//   M  company_register_capital               -> company_register_capital
//
// The J and L queries are imported from lib/merchant-lines.mjs — the very same
// SQL the two gen-*-lines.mjs CLIs run — so the sheet always agrees with them.
//
// Every other column is left untouched, including the VLOOKUP formulas in P
// (ExcelJS readFile -> set cells -> writeFile preserves formulas + formatting).
//
// Writes to a NEW file by default: data.xlsx is not tracked by git, so an
// in-place write would be unrecoverable. Pass --in-place once you're happy.
//
// Run:
//   node --env-file=.env.local scripts/fill-data-xlsx.mjs --dry-run
//   node --env-file=.env.local scripts/fill-data-xlsx.mjs
//   node --env-file=.env.local scripts/fill-data-xlsx.mjs --in-place
import pg from "pg";
import ExcelJS from "exceljs";
import { BANK_LINE_SQL, ADDRESS_LINE_SQL, TAX_CAPITAL_SQL } from "./lib/merchant-lines.mjs";

const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

function flag(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const XLSX_IN = flag("xlsx") ?? "data.xlsx";
const SHEET = flag("sheet") ?? "Sheet1";
const DRY_RUN = process.argv.includes("--dry-run");
const IN_PLACE = process.argv.includes("--in-place");
const OUT = flag("out") ?? (IN_PLACE ? XLSX_IN : XLSX_IN.replace(/\.xlsx$/i, ".filled.xlsx"));

const MID_COL = 2; // column B — รหัสร้านค้า

// col        = 1-based column index to write
// expect     = substring the header must contain, so a reshuffled sheet fails
//              loudly here instead of writing into the wrong column
// get(rec)   = value to write; return "" to leave the cell blank
// numeric    = write as a number rather than text
const TARGETS = [
  { col: 5,  letter: "E", expect: "taxid",                    get: (r) => r.tax_id },
  { col: 10, letter: "J", expect: "location",                 get: (r) => r.address_line },
  { col: 11, letter: "K", expect: "postal_code",              get: (r) => r.postal_code },
  { col: 12, letter: "L", expect: "bankaccount",              get: (r) => r.bank_line },
  { col: 13, letter: "M", expect: "company_register_capital", get: (r) => r.capital, numeric: true },
];

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX_IN);
const ws = wb.getWorksheet(SHEET);
if (!ws) { console.error(`Sheet "${SHEET}" not found in ${XLSX_IN}`); process.exit(1); }

function cellText(cell) {
  let v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.text) return String(v.text);
    return "";
  }
  return String(v).trim();
}

// Fail loudly if the sheet's layout no longer matches what we expect to fill.
const headerRow = ws.getRow(1);
for (const t of TARGETS) {
  const h = cellText(headerRow.getCell(t.col)).toLowerCase();
  if (!h.includes(t.expect.toLowerCase())) {
    console.error(
      `Header check failed: expected column ${t.letter} to mention "${t.expect}", found "${h}".\n` +
      `The sheet layout has changed — refusing to write into the wrong column.`,
    );
    process.exit(1);
  }
}

// Collect MIDs in sheet order.
const rowsByMid = new Map(); // mid -> [sheet row numbers]
for (let r = 2; r <= ws.rowCount; r++) {
  const mid = cellText(ws.getRow(r).getCell(MID_COL));
  if (!mid) continue;
  if (!rowsByMid.has(mid)) rowsByMid.set(mid, []);
  rowsByMid.get(mid).push(r);
}
const MIDS = [...rowsByMid.keys()];
console.log(`${XLSX_IN} / ${SHEET}: ${MIDS.length} unique MIDs across ${[...rowsByMid.values()].flat().length} rows`);

const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 3,
  statement_timeout: 300_000,
});

// Separators match what the gen-*-lines.mjs CLIs default to: the bank line is
// comma-joined ($006,2363277538), the address space-joined.
const [bank, addr, tax] = await Promise.all([
  pool.query(BANK_LINE_SQL, [MIDS, ","]),
  pool.query(ADDRESS_LINE_SQL, [MIDS, " "]),
  pool.query(TAX_CAPITAL_SQL, [MIDS]),
]);
await pool.end();

const rec = new Map();
function slot(mid) {
  if (!rec.has(mid)) {
    rec.set(mid, { tax_id: "", address_line: "", postal_code: "", bank_line: "", capital: "" });
  }
  return rec.get(mid);
}
for (const r of bank.rows) slot(r.merchant_no).bank_line = r.bank_line ?? "";
for (const r of addr.rows) {
  const s = slot(r.merchant_no);
  s.address_line = r.address_line ?? "";
  s.postal_code = r.postal_code ?? "";
  s.addr_type = r.addr_type ?? "";
}
for (const r of tax.rows) {
  const s = slot(r.merchant_no);
  s.tax_id = r.tax_id ?? "";
  s.capital = r.company_register_capital ?? "";
  s.person_type = r.person_type ?? "";
}

const notInDb = MIDS.filter((m) => !rec.has(m));
const filled = Object.fromEntries(TARGETS.map((t) => [t.letter, 0]));
const blank = Object.fromEntries(TARGETS.map((t) => [t.letter, 0]));

for (const [mid, sheetRows] of rowsByMid) {
  const r = rec.get(mid);
  if (!r) continue;
  for (const rowNo of sheetRows) {
    const row = ws.getRow(rowNo);
    for (const t of TARGETS) {
      const raw = t.get(r);
      const v = raw === null || raw === undefined ? "" : String(raw);
      if (v === "") { blank[t.letter]++; continue; }
      // Tax ids and postal codes are digit strings with meaningful leading zeros
      // (e.g. '0105550113260') — writing them as numbers would silently drop the
      // zero and flip long ones to scientific notation. Keep everything text
      // except the genuinely numeric capital column.
      row.getCell(t.col).value = t.numeric ? Number(v) : v;
      filled[t.letter]++;
    }
    row.commit?.();
  }
}

console.log("\nfill result (per column):");
for (const t of TARGETS) {
  const h = cellText(headerRow.getCell(t.col)).replace(/\s+/g, " ").slice(0, 40);
  console.log(`  ${t.letter} | filled ${String(filled[t.letter]).padStart(4)} | blank ${String(blank[t.letter]).padStart(4)} | ${h}`);
}
if (notInDb.length) {
  console.log(`\n${notInDb.length} MID(s) not found in merchant_info: ${notInDb.slice(0, 10).join(", ")}`);
}

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written. Sample of what would be filled:");
  for (const mid of MIDS.slice(0, 3)) {
    const r = rec.get(mid);
    if (!r) continue;
    console.log(`  ${mid}`);
    console.log(`    E taxid    : ${r.tax_id}  (person_type ${r.person_type})`);
    console.log(`    J location : ${r.address_line}  [${r.addr_type}]`);
    console.log(`    K postal   : ${r.postal_code}`);
    console.log(`    L bank     : ${r.bank_line}`);
    console.log(`    M capital  : ${r.capital === "" ? "(blank)" : r.capital}`);
  }
} else {
  await wb.xlsx.writeFile(OUT);
  console.log(`\nWrote -> ${OUT}${IN_PLACE ? "  (in place)" : ""}`);
}
