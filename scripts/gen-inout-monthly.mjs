// Builds a single workbook for ONE merchant, split into per-month In / Out sheets
// plus a Thai-labelled Summary sheet (the "<Name> - In MMYY" / "<Name> - Out MMYY" layout).
//
//   In  = payment_transaction        (money in)
//   Out = transfer_transaction       (Withdraw + Transfer + Settlement, Type column distinguishes)
//
// All statuses (S and E) are included; every detail sheet carries a Status column.
//
// Run:  node --max-old-space-size=4096 --env-file=.env.local scripts/gen-inout-monthly.mjs \
//         --mid=M250924103830 --from=2026-01-01 --to=2026-07-22
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

const MID = arg("mid", "M250924103830");
const FROM = arg("from", "2026-01-01");
// exclusive upper bound; default = tomorrow, so "present" is fully covered
const TO = arg("to", new Date(Date.now() + 864e5).toISOString().slice(0, 10));
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", arg("out", "sd"));
fs.mkdirSync(OUT_DIR, { recursive: true });

// Month buckets [from, to) — one In sheet and one Out sheet each.
function monthsBetween(from, to) {
  const out = [];
  const [fy, fm] = from.split("-").map(Number);
  const end = new Date(`${to}T00:00:00Z`);
  let y = fy, m = fm;
  for (;;) {
    const start = new Date(Date.UTC(y, m - 1, 1));
    if (start >= end) break;
    const next = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
    out.push({
      ym: `${y}-${String(m).padStart(2, "0")}`,
      mmyy: `${String(m).padStart(2, "0")}${String(y).slice(2)}`,
      from: start.toISOString().slice(0, 10),
      to: next.toISOString().slice(0, 10),
    });
    y = m === 12 ? y + 1 : y; m = m === 12 ? 1 : m + 1;
  }
  return out;
}
const MONTHS = monthsBetween(FROM, TO);

const DETAIL_COLS = [
  { header: "Order ID", key: "order_id", width: 14 },
  { header: "MID", key: "mid", width: 16 },
  { header: "Merchant Name", key: "merchant_name", width: 20 },
  { header: "BillerID", key: "biller_id", width: 14 },
  { header: "Transaction Date", key: "txn_date", width: 20 },
  { header: "Ref1", key: "ref1", width: 16 },
  { header: "Ref2", key: "ref2", width: 16 },
  { header: "Type", key: "type", width: 11 },
  { header: "Status", key: "status", width: 8 },
  { header: "Amount", key: "amount", width: 15, style: { numFmt: "#,##0.00" } },
  { header: "Bank Account Number", key: "bank_acc_no", width: 20 },
  { header: "Bank Account Name", key: "bank_acc_name", width: 22 },
  { header: "Bank Code", key: "bank_code", width: 10 },
  { header: "Bank Name", key: "bank_name", width: 22 },
];

const IN_SQL = `
SELECT
    pt.id::text                 AS order_id,
    mi.merchant_no              AS mid,
    mi.merchant_name_en         AS merchant_name,
    gc_qr.merchant_id           AS biller_id,
    pt.payment_date             AS txn_date,
    pt.merchant_invoice         AS ref1,
    pt.merchant_reference_no    AS ref2,
    'Payment'                   AS type,
    pt.status                   AS status,
    pt.amount                   AS amount,
    ptr.from_account            AS bank_acc_no,
    ptr.from_name               AS bank_acc_name,
    ptr.from_bank               AS bank_code,
    md.name_en                  AS bank_name
FROM payment_transaction pt
JOIN merchant_info mi                       ON mi.id = pt.merchant_id
LEFT JOIN payment_transaction_response ptr  ON ptr.ptx_id = pt.id
LEFT JOIN gateway_channel gc_qr             ON gc_qr.id = mi.qr_gwc_id
LEFT JOIN master_data md
       ON md.key1 = 'BANK' AND md.key2 = ptr.from_bank AND md.enabled = TRUE
WHERE pt.merchant_id = $1
  AND pt.payment_date >= $2::timestamp AND pt.payment_date < $3::timestamp
ORDER BY pt.payment_date, pt.id;
`;

const OUT_SQL = `
SELECT
    tt.id::text                 AS order_id,
    mi.merchant_no              AS mid,
    mi.merchant_name_en         AS merchant_name,
    gc_qr.merchant_id           AS biller_id,
    tt.transfer_date            AS txn_date,
    tt.merchant_invoice         AS ref1,
    tt.merchant_reference_no    AS ref2,
    tt.type                     AS type,
    tt.status                   AS status,
    tt.amount                   AS amount,
    tt.account_no               AS bank_acc_no,
    tt.account_holder_name      AS bank_acc_name,
    tt.bank_code                AS bank_code,
    md.name_en                  AS bank_name
FROM transfer_transaction tt
JOIN merchant_info mi               ON mi.id = tt.merchant_id
LEFT JOIN gateway_channel gc_qr     ON gc_qr.id = mi.qr_gwc_id
LEFT JOIN master_data md
       ON md.key1 = 'BANK' AND md.key2 = tt.bank_code AND md.enabled = TRUE
WHERE tt.merchant_id = $1
  AND tt.transfer_date >= $2::timestamp AND tt.transfer_date < $3::timestamp
ORDER BY tt.transfer_date, tt.id;
`;

function addDetailRow(ws, r) {
  const amt = r.amount == null ? null : Number(r.amount);
  ws.addRow({
    order_id: r.order_id,
    mid: r.mid,
    merchant_name: r.merchant_name,
    biller_id: r.biller_id ?? null,
    txn_date: r.txn_date ? String(r.txn_date).slice(0, 19) : null,
    ref1: r.ref1 ?? null,
    ref2: r.ref2 ?? null,
    type: r.type,
    status: r.status,
    amount: Number.isFinite(amt) ? amt : null,
    bank_acc_no: r.bank_acc_no ?? null,
    bank_acc_name: r.bank_acc_name ?? null,
    bank_code: r.bank_code ?? null,
    bank_name: r.bank_name ?? null,
  }).commit();
}

// A month can hold ~1M rows; pull it a day at a time so no single result set is
// held in memory. Day boundaries preserve the global date ordering.
function daySlices(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d < new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 864e5)) {
    out.push([d.toISOString().slice(0, 10), new Date(d.getTime() + 864e5).toISOString().slice(0, 10)]);
  }
  return out;
}

// ---- resolve merchant ----
const { rows: mrows } = await pool.query(
  `SELECT id, merchant_no, merchant_name_en, merchant_name_th FROM merchant_info WHERE merchant_no = $1`,
  [MID],
);
if (!mrows.length) { console.error(`MID ${MID} not found`); process.exit(1); }
const M = mrows[0];
const LABEL = M.merchant_name_en || M.merchant_name_th || M.merchant_no;
console.log(`${M.merchant_no} — ${LABEL} (id ${M.id})`);
console.log(`Range ${FROM} .. ${TO} (${MONTHS.length} months)`);

// ---- summary aggregates (drives the Summary sheet; detail sheets re-query for rows) ----
const { rows: agg } = await pool.query(
  `
  SELECT 'IN' AS dir, to_char(date_trunc('month', payment_date), 'YYYY-MM') AS ym,
         COUNT(*)::bigint AS cnt, SUM(amount)::numeric AS amt
    FROM payment_transaction
   WHERE merchant_id = $1 AND payment_date >= $2::timestamp AND payment_date < $3::timestamp
   GROUP BY 2
  UNION ALL
  SELECT 'OUT', to_char(date_trunc('month', transfer_date), 'YYYY-MM'),
         COUNT(*)::bigint, SUM(amount)::numeric
    FROM transfer_transaction
   WHERE merchant_id = $1 AND transfer_date >= $2::timestamp AND transfer_date < $3::timestamp
   GROUP BY 2
  `,
  [M.id, FROM, TO],
);
const stat = new Map(agg.map((r) => [`${r.dir}|${r.ym}`, { cnt: Number(r.cnt), amt: Number(r.amt) }]));
const get = (dir, ym) => stat.get(`${dir}|${ym}`) ?? { cnt: 0, amt: 0 };

const sheetName = (dir, mmyy) => `${LABEL} - ${dir === "IN" ? "In" : "Out"} ${mmyy}`
  .replace(/[[\]:*?/\\]/g, "").slice(0, 31);

// ============================================================
// Workbook
// ============================================================
const file = path.join(OUT_DIR, `${M.merchant_no}_${LABEL.replace(/[^A-Za-z0-9 _.-]/g, "").trim()}_in-out_monthly.xlsx`);
const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: false });

// ---- Summary ----
{
  const ws = wb.addWorksheet("Summary");
  ws.columns = [
    { header: "รายการ", key: "item", width: 30 },
    { header: "จำนวนรายการ", key: "cnt", width: 15, style: { numFmt: "#,##0" } },
    { header: "จำนวนเงิน", key: "amt", width: 18, style: { numFmt: "#,##0.00" } },
    { header: "Type", key: "type", width: 8 },
    { header: "", key: "g1", width: 3 },
    { header: "", key: "g2", width: 3 },
    { header: "", key: "g3", width: 3 },
    { header: "รายการ", key: "b_item", width: 22 },
    { header: "Type", key: "b_type", width: 8 },
    { header: "จำนวนรายการ", key: "b_cnt", width: 15, style: { numFmt: "#,##0" } },
    { header: "จำนวนเงิน", key: "b_amt", width: 18, style: { numFmt: "#,##0.00" } },
  ];
  // The streaming writer commits row 1 as soon as data rows are added — style it now.
  ws.getRow(1).font = { bold: true };

  // Left block: one line per detail sheet, In then Out for each month.
  const lines = [];
  for (const mo of MONTHS) {
    for (const dir of ["IN", "OUT"]) {
      const s = get(dir, mo.ym);
      lines.push({ item: sheetName(dir, mo.mmyy), cnt: s.cnt, amt: s.amt, type: dir });
    }
  }
  const totIn = lines.filter((l) => l.type === "IN").reduce((a, l) => ({ cnt: a.cnt + l.cnt, amt: a.amt + l.amt }), { cnt: 0, amt: 0 });
  const totOut = lines.filter((l) => l.type === "OUT").reduce((a, l) => ({ cnt: a.cnt + l.cnt, amt: a.amt + l.amt }), { cnt: 0, amt: 0 });

  // Right block rides along on the first three rows.
  const right = [
    { b_item: `${LABEL} - In`, b_type: "IN", b_cnt: totIn.cnt, b_amt: totIn.amt },
    { b_item: `${LABEL} - Out`, b_type: "OUT", b_cnt: totOut.cnt, b_amt: totOut.amt },
    { b_item: "รวมทั้งหมด", b_cnt: totIn.cnt + totOut.cnt, b_amt: totIn.amt + totOut.amt },
  ];

  lines.forEach((l, i) => {
    const row = ws.addRow({ ...l, ...(right[i] ?? {}) });
    if (i === 2) row.font = { bold: true };
    row.commit();
  });
  // If there are fewer detail lines than right-block rows, flush the remainder.
  for (let i = lines.length; i < right.length; i++) ws.addRow(right[i]).commit();

  const tot = ws.addRow({ item: "รวมทั้งหมด", cnt: totIn.cnt + totOut.cnt, amt: totIn.amt + totOut.amt });
  tot.font = { bold: true };
  tot.commit();
  ws.commit();
  console.log(`Summary: IN ${totIn.cnt} / ${totIn.amt.toFixed(2)} — OUT ${totOut.cnt} / ${totOut.amt.toFixed(2)}`);
}

// ---- Detail sheets: In then Out, per month ----
for (const mo of MONTHS) {
  for (const [dir, sql] of [["IN", IN_SQL], ["OUT", OUT_SQL]]) {
    const ws = wb.addWorksheet(sheetName(dir, mo.mmyy));
    ws.columns = DETAIL_COLS;
    ws.getRow(1).font = { bold: true };

    let n = 0;
    for (const [d0, d1] of daySlices(mo.from, mo.to)) {
      const { rows } = await pool.query(sql, [M.id, d0, d1]);
      for (const r of rows) addDetailRow(ws, r);
      n += rows.length;
    }
    ws.commit();
    const expect = get(dir, mo.ym).cnt;
    console.log(`  ${sheetName(dir, mo.mmyy)}: ${n} rows${n === expect ? "" : ` (!! summary says ${expect})`}`);
  }
}

await wb.commit();
await pool.end();
console.log(`Wrote ${file}`);
