// One row per merchant under a given AE (partner_no), with lifetime transaction volume.
//
//   payment  = payment_transaction   (money in)
//   transfer = transfer_transaction  (Withdraw + Transfer + Settlement)
//
// Success only (status = 'S') — excludes unpaid QR ('G'), cancelled ('C') and failed ('E').
// All merchants under the AE are listed, including closed/rejected and zero-activity ones.
//
// Run:  node --env-file=.env.local scripts/gen-merchant-by-ae.mjs --ae=AE000075
import pg from "pg";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 3,
  statement_timeout: 900_000,
});

function arg(name, fallback) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
}

const AE = arg("ae", "AE000075");
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", arg("out", "."));
fs.mkdirSync(OUT_DIR, { recursive: true });

// Both aggregates are scoped to the AE's merchant ids, so neither large table is scanned in full.
const SQL = `
WITH mer AS (
  SELECT mi.id, mi.merchant_no, mi.merchant_name_en, mi.merchant_name_th, mi.website, mi.state,
         bg.mcc     AS mcc_code,
         bg.name_th AS mcc_business_group_name
    FROM merchant_info mi
    JOIN partner_info pi ON pi.id = mi.partner_id
    -- master_data Pattern 1 (docs/dbinfo.md): join on id::text with a key1 guard.
    -- LEFT so the 5 merchants with no business_group_id still appear.
    LEFT JOIN master_data bg
           ON bg.id::text = mi.business_group_id::text
          AND bg.key1 = 'BUSINESS_GROUP'
   WHERE pi.partner_no = $1
),
pay AS (
  SELECT pt.merchant_id,
         COUNT(*)::bigint                     AS cnt,
         COALESCE(SUM(pt.amount), 0)::numeric AS amt
    FROM payment_transaction pt
   WHERE pt.merchant_id IN (SELECT id FROM mer)
     AND pt.status = 'S'
   GROUP BY 1
),
trf AS (
  SELECT tt.merchant_id,
         COUNT(*)::bigint                     AS cnt,
         COALESCE(SUM(tt.amount), 0)::numeric AS amt
    FROM transfer_transaction tt
   WHERE tt.merchant_id IN (SELECT id FROM mer)
     AND tt.status = 'S'
   GROUP BY 1
)
SELECT $1                                    AS ae,
       m.merchant_no,
       m.merchant_name_en,
       m.merchant_name_th,
       COALESCE(p.cnt,0) + COALESCE(t.cnt,0) AS transactions,
       COALESCE(p.amt,0) + COALESCE(t.amt,0) AS total_amount,
       COALESCE(p.cnt,0)                     AS payment_count,
       COALESCE(p.amt,0)                     AS payment_amount,
       COALESCE(t.cnt,0)                     AS transfer_count,
       COALESCE(t.amt,0)                     AS transfer_amount,
       NULLIF(btrim(m.website), '')          AS website,
       m.mcc_code,
       m.mcc_business_group_name,
       m.state
  FROM mer m
  LEFT JOIN pay p ON p.merchant_id = m.id
  LEFT JOIN trf t ON t.merchant_id = m.id
 ORDER BY total_amount DESC
`;

const CNT = "#,##0";
const AMT = "#,##0.00";
const COLS = [
  { header: "AE", key: "ae", width: 12 },
  { header: "merchant_no", key: "merchant_no", width: 18 },
  { header: "merchant_name_en", key: "merchant_name_en", width: 34 },
  { header: "merchant_name_th", key: "merchant_name_th", width: 34 },
  { header: "transactions", key: "transactions", width: 14, style: { numFmt: CNT } },
  { header: "total_amount", key: "total_amount", width: 18, style: { numFmt: AMT } },
  { header: "payment_count", key: "payment_count", width: 15, style: { numFmt: CNT } },
  { header: "payment_amount", key: "payment_amount", width: 18, style: { numFmt: AMT } },
  { header: "transfer_count", key: "transfer_count", width: 15, style: { numFmt: CNT } },
  { header: "transfer_amount", key: "transfer_amount", width: 18, style: { numFmt: AMT } },
  { header: "website", key: "website", width: 38 },
  { header: "MCC Code", key: "mcc_code", width: 12 },
  { header: "MCC Business Group Name", key: "mcc_business_group_name", width: 46 },
  // 27 of 53 merchants have no MID yet — a merchant_no is only issued at final approval,
  // so this column explains the blank cells rather than leaving them looking like bad data.
  { header: "state", key: "state", width: 22 },
];
// The six transaction measures only — these drive the TOTAL row, so an MCC code
// (stored after this window) must never be swept in and summed.
const NUM_KEYS = COLS.slice(4, 10).map((c) => c.key);

// Some websites are stored as bare domains ("banchuphan.com") — Excel needs a scheme to
// make the link clickable, but the cell keeps showing whatever the merchant registered.
const linkTarget = (w) => (/^https?:\/\//i.test(w) ? w : `https://${w}`);

console.log(`Querying merchants for ${AE} ...`);
const { rows } = await pool.query(SQL, [AE]);
await pool.end();

if (rows.length === 0) {
  console.error(`No merchants found for AE "${AE}" — check the partner_no (e.g. AE000075).`);
  process.exit(1);
}

// pg returns bigint/numeric as strings; Excel needs real numbers or it stores them as text.
const data = rows.map((r) => {
  const o = { ...r };
  for (const k of NUM_KEYS) o[k] = Number(r[k]);
  // master_data.mcc is a varchar, but the codes are 4-digit numbers and the regulatory
  // monthly report stores them numerically — match that so the column sorts as a number.
  if (/^\d+$/.test(o.mcc_code ?? "")) o.mcc_code = Number(o.mcc_code);
  return o;
});
// Round the accumulated float sums back to satang, otherwise the TOTAL row carries
// artifacts like ...575.3199992 in the stored cell value.
const totals = Object.fromEntries(
  NUM_KEYS.map((k) => [k, Math.round(data.reduce((a, r) => a + r[k], 0) * 100) / 100]),
);

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet(AE);
ws.columns = COLS;
ws.getRow(1).font = { bold: true };
ws.views = [{ state: "frozen", ySplit: 1 }];
const WEB_COL = ws.getColumn("website").number;
data.forEach((r) => {
  const row = ws.addRow(r);
  if (r.website) {
    row.getCell(WEB_COL).value = { text: r.website, hyperlink: linkTarget(r.website) };
    row.getCell(WEB_COL).font = { color: { argb: "FF0563C1" }, underline: true };
  }
});
ws.addRow({ ae: "TOTAL", ...totals }).font = { bold: true };

const file = path.join(OUT_DIR, `${AE}_merchants_summary.xlsx`);
await wb.xlsx.writeFile(file);

console.log(`${data.length} merchants → ${file}`);
console.log(
  `TOTAL  transactions=${totals.transactions.toLocaleString()}  ` +
  `total_amount=${totals.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
);
