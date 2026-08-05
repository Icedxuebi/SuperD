// Generates three deliverables into ./hugefile for every merchant in checkmer.xlsx:
//   1) 1_transaction_details/<mid>_<name>.xlsx  — one workbook per merchant (streamed)
//   2) 2_monthly_summary.xlsx                   — per merchant, month x type (count + amount)
//   3) 3_same_account_sample.xlsx               — SAMPLE (style of inspect-transfer-vs-withdraw):
//        accounts that BOTH pay a merchant (Payment.from_account) AND receive a withdraw
//        (Withdraw.account_no) in the same month. Sheets: Overlap Summary (all merchant-months
//        with any overlap), Sample Accounts (top-5 matched accounts / merchant-month), Sample
//        Transactions (a few real in/out txns per sampled account). Computed in SQL, not held
//        in memory — the full match set is millions of rows and is intentionally NOT dumped.
//
// Per-merchant 3-month window (read straight from checkmer.xlsx cols F=Status, G=Close date):
//   Active  -> Apr, May, Jun 2026 (the 3 complete months before the current month).
//   Closed  -> the close month + the 2 months before it (full calendar months).
//
// Types in scope: Payment, Withdraw, Transfer (Settlement excluded). All statuses (S and E)
// are included, with a Status column so an analyst can filter.
//
// Run:  node --max-old-space-size=4096 --env-file=.env.local scripts/gen-checkmer-batch.mjs
// Flags: --limit=N (first N merchants)  --mids=M1,M2  --out=hugefile  --xlsx=checkmer.xlsx
//        --sample-top=N (matched accounts per merchant-month, default 5)  --sample-tx=N (txns
//        per account per side, default 3)  --no-details (skip #1, e.g. to rebuild only #3)
import pg from "pg";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set (run with --env-file=.env.local)"); process.exit(1); }

const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 3,
  statement_timeout: 600_000,
});

const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const XLSX_FILE = path.resolve(ROOT, arg("xlsx", "checkmer.xlsx"));
const OUT = path.resolve(ROOT, arg("out", "hugefile"));
const LIMIT = arg("limit") ? parseInt(arg("limit"), 10) : null;
const MID_FILTER = arg("mids") ? new Set(arg("mids").split(/[\s,]+/).filter(Boolean)) : null;
const SAMPLE_TOP = arg("sample-top") ? parseInt(arg("sample-top"), 10) : 5;
const SAMPLE_TX = arg("sample-tx") ? parseInt(arg("sample-tx"), 10) : 3;
const SKIP_DETAILS = process.argv.includes("--no-details");

const DETAIL_DIR = path.join(OUT, "1_transaction_details");
fs.mkdirSync(DETAIL_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Month-window helpers
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
function monthWindow(y, m) {           // m is 1-12
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { ym: `${y}-${pad(m)}`, from: `${y}-${pad(m)}-01 00:00:00`, to: `${ny}-${pad(nm)}-01 00:00:00` };
}
function threeMonthsEnding(y, m) {     // [M-2, M-1, M]
  const out = [];
  for (let k = 2; k >= 0; k--) {
    let mm = m - k, yy = y;
    while (mm <= 0) { mm += 12; yy -= 1; }
    out.push(monthWindow(yy, mm));
  }
  return out;
}
const ACTIVE_MONTHS = [monthWindow(2026, 4), monthWindow(2026, 5), monthWindow(2026, 6)];

function windowFor(status, closeStr) {
  if (status === "Active") return ACTIVE_MONTHS;
  // Closed / Inactive -> anchor on close date's month
  if (!closeStr) return null;
  const s = String(closeStr).slice(0, 7);           // YYYY-MM
  const [y, m] = s.split("-").map(Number);
  if (!y || !m) return null;
  return threeMonthsEnding(y, m);
}

// ---------------------------------------------------------------------------
// Read checkmer.xlsx -> merchant list with status + close date
// ---------------------------------------------------------------------------
const inWb = new ExcelJS.Workbook();
await inWb.xlsx.readFile(XLSX_FILE);
const inWs = inWb.worksheets[0];
let sheetMerchants = [];
inWs.eachRow((row, n) => {
  if (n === 1) return;
  const no = String(row.getCell(2).value ?? "").trim();
  if (!no) return;
  sheetMerchants.push({
    no,
    name_th: row.getCell(3).value ?? null,
    status: row.getCell(6).value ?? null,   // F
    close: row.getCell(7).value ?? null,    // G
  });
});
if (MID_FILTER) sheetMerchants = sheetMerchants.filter((m) => MID_FILTER.has(m.no));
if (LIMIT) sheetMerchants = sheetMerchants.slice(0, LIMIT);
console.log(`Merchants from sheet: ${sheetMerchants.length}`);

// Resolve merchant_no -> internal id + english name
const { rows: resolved } = await pool.query(
  `SELECT id, merchant_no, merchant_name_en FROM merchant_info WHERE merchant_no = ANY($1::text[])`,
  [sheetMerchants.map((m) => m.no)],
);
const byNo = new Map(resolved.map((r) => [r.merchant_no, r]));
const merchants = [];
for (const m of sheetMerchants) {
  const r = byNo.get(m.no);
  if (!r) { console.warn(`  ! not found in DB: ${m.no}`); continue; }
  const window = windowFor(m.status, m.close);
  if (!window) { console.warn(`  ! no window for ${m.no} (status=${m.status}, close=${m.close})`); continue; }
  merchants.push({
    id: r.id, no: m.no, name: r.merchant_name_en || m.name_th || m.no,
    status: m.status, close: m.close ? String(m.close).slice(0, 10) : null, window,
  });
}
merchants.sort((a, b) => a.no.localeCompare(b.no));
console.log(`Resolved & windowed: ${merchants.length}`);

// ---------------------------------------------------------------------------
// SQL: one merchant + one month -> Payment + Withdraw + Transfer rows
// ---------------------------------------------------------------------------
const DETAIL_SQL = `
SELECT
    pt.id::text              AS order_id,
    mi.merchant_no           AS mid,
    mi.merchant_name_en      AS merchant_name,
    gc_qr.merchant_id        AS biller_id,
    pt.payment_date          AS txn_date,
    pt.merchant_invoice      AS ref1,
    pt.merchant_reference_no AS ref2,
    'Payment'                AS type,
    pt.status                AS status,
    pt.amount                AS amount,
    ptr.from_account         AS bank_acc_no,
    ptr.from_name            AS bank_acc_name,
    ptr.from_bank            AS bank_code,
    md.name_en               AS bank_name
FROM payment_transaction pt
JOIN merchant_info mi                       ON mi.id = pt.merchant_id
LEFT JOIN payment_transaction_response ptr  ON ptr.ptx_id = pt.id
LEFT JOIN gateway_channel gc_qr             ON gc_qr.id = mi.qr_gwc_id
LEFT JOIN master_data md
       ON md.key1 = 'BANK' AND md.key2 = ptr.from_bank AND md.enabled = TRUE
WHERE pt.merchant_id = $1
  AND pt.payment_date >= $2::timestamp AND pt.payment_date < $3::timestamp

UNION ALL

SELECT
    tt.id::text, mi.merchant_no, mi.merchant_name_en, gc_qr.merchant_id,
    tt.transfer_date, tt.merchant_invoice, tt.merchant_reference_no,
    tt.type, tt.status, tt.amount,
    tt.account_no, tt.account_holder_name, tt.bank_code, md.name_en
FROM transfer_transaction tt
JOIN merchant_info mi                       ON mi.id = tt.merchant_id
LEFT JOIN gateway_channel gc_qr             ON gc_qr.id = mi.qr_gwc_id
LEFT JOIN master_data md
       ON md.key1 = 'BANK' AND md.key2 = tt.bank_code AND md.enabled = TRUE
WHERE tt.merchant_id = $1
  AND tt.transfer_date >= $2::timestamp AND tt.transfer_date < $3::timestamp
  AND tt.type IN ('Withdraw','Transfer')

ORDER BY 5;
`;

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
const TYPES = ["Payment", "Withdraw", "Transfer"];
const sanitize = (s) => String(s).replace(/[^A-Za-z0-9 _.-]/g, "").trim().slice(0, 60) || "merchant";
const num = (v) => (v == null ? null : Number(v));

function detailRowObj(r) {
  const amt = num(r.amount);
  return {
    order_id: r.order_id, mid: r.mid, merchant_name: r.merchant_name,
    biller_id: r.biller_id ?? null,
    txn_date: r.txn_date ? String(r.txn_date).slice(0, 19) : null,
    ref1: r.ref1 ?? null, ref2: r.ref2 ?? null, type: r.type, status: r.status,
    amount: Number.isFinite(amt) ? amt : null,
    bank_acc_no: r.bank_acc_no ?? null, bank_acc_name: r.bank_acc_name ?? null,
    bank_code: r.bank_code ?? null, bank_name: r.bank_name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Pass 1: per merchant -> detail workbook (#1) + summary aggregation (#2)
// Memory-safe: detail rows are streamed to disk; only the small #2 aggregates
// (1187 x 3 rows) are kept. #3 is a separate SQL pass below.
// ---------------------------------------------------------------------------
const summaryRows = [];        // { mid, name, status, ym, {type_c,type_a}, tot_c, tot_a }
const monthRoll = new Map();   // ym -> calendar rollup across all merchants

const t0 = Date.now();
let done = 0, grandTxns = 0;

for (const m of merchants) {
  let wb = null;
  if (!SKIP_DETAILS) {
    const file = path.join(DETAIL_DIR, `${m.no}_${sanitize(m.name)}.xlsx`);
    wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: false });
  }

  let mTxns = 0;
  for (const mo of m.window) {
    const { rows } = await pool.query(DETAIL_SQL, [m.id, mo.from, mo.to]);
    mTxns += rows.length;

    // One sheet per window month keeps every sheet well under Excel's ~1,048,576-row limit.
    let ws = null;
    if (wb) {
      ws = wb.addWorksheet(mo.ym);
      ws.columns = DETAIL_COLS;
      ws.getRow(1).font = { bold: true };
    }
    const agg = {};
    for (const t of TYPES) agg[t] = { c: 0, a: 0 };
    for (const r of rows) {
      const o = detailRowObj(r);
      if (ws) ws.addRow(o).commit();
      if (agg[o.type]) { agg[o.type].c++; agg[o.type].a += o.amount ?? 0; }
    }
    if (ws) ws.commit();

    let tc = 0, ta = 0;
    const srow = { mid: m.no, name: m.name, status: m.status, ym: mo.ym };
    for (const t of TYPES) { srow[`${t}_c`] = agg[t].c; srow[`${t}_a`] = agg[t].a; tc += agg[t].c; ta += agg[t].a; }
    srow.tot_c = tc; srow.tot_a = ta;
    summaryRows.push(srow);

    let mr = monthRoll.get(mo.ym);
    if (!mr) { mr = {}; for (const t of TYPES) { mr[`${t}_c`] = 0; mr[`${t}_a`] = 0; } mr.tot_c = 0; mr.tot_a = 0; monthRoll.set(mo.ym, mr); }
    for (const t of TYPES) { mr[`${t}_c`] += agg[t].c; mr[`${t}_a`] += agg[t].a; }
    mr.tot_c += tc; mr.tot_a += ta;
  }

  if (wb) await wb.commit();
  grandTxns += mTxns;
  done++;
  if (done % 25 === 0 || done === merchants.length) {
    const rate = done / ((Date.now() - t0) / 1000);
    const eta = ((merchants.length - done) / rate).toFixed(0);
    console.log(`  [${done}/${merchants.length}] ${m.no} ${m.status} txns=${mTxns} | ${rate.toFixed(1)}/s ETA ${eta}s`);
  }
}
console.log(`Pass 1 done: ${done} merchants, ${grandTxns} txns in ${((Date.now() - t0) / 1000).toFixed(0)}s.`);

// ---------------------------------------------------------------------------
// Deliverable #2: monthly summary
// ---------------------------------------------------------------------------
{
  const wb = new ExcelJS.Workbook();

  const wsB = wb.addWorksheet("By Merchant");
  wsB.columns = [
    { header: "MID", key: "mid", width: 16 },
    { header: "Merchant Name", key: "name", width: 22 },
    { header: "Status", key: "status", width: 10 },
    { header: "Month", key: "ym", width: 10 },
    ...TYPES.flatMap((t) => [
      { header: `${t} Count`, key: `${t}_c`, width: 13, style: { numFmt: "#,##0" } },
      { header: `${t} Amount`, key: `${t}_a`, width: 16, style: { numFmt: "#,##0.00" } },
    ]),
    { header: "Total Count", key: "tot_c", width: 13, style: { numFmt: "#,##0" } },
    { header: "Total Amount", key: "tot_a", width: 16, style: { numFmt: "#,##0.00" } },
  ];
  wsB.getRow(1).font = { bold: true };
  wsB.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of summaryRows) wsB.addRow(r);

  const wsM = wb.addWorksheet("All by Month");
  wsM.columns = wsB.columns.slice(3); // Month + type cols + totals
  wsM.getRow(1).font = { bold: true };
  const totals = {}; for (const t of TYPES) { totals[`${t}_c`] = 0; totals[`${t}_a`] = 0; } totals.tot_c = 0; totals.tot_a = 0;
  for (const ym of [...monthRoll.keys()].sort()) {
    const mr = monthRoll.get(ym);
    wsM.addRow({ ym, ...mr });
    for (const t of TYPES) { totals[`${t}_c`] += mr[`${t}_c`]; totals[`${t}_a`] += mr[`${t}_a`]; }
    totals.tot_c += mr.tot_c; totals.tot_a += mr.tot_a;
  }
  wsM.addRow({ ym: "TOTAL", ...totals }).font = { bold: true };

  const p = path.join(OUT, "2_monthly_summary.xlsx");
  await wb.xlsx.writeFile(p);
  console.log(`Wrote ${p} (${summaryRows.length} merchant-month rows)`);
}

// ---------------------------------------------------------------------------
// Deliverable #3 (SAMPLE): same account pays-in AND is withdrawn-to, same month.
// All aggregation happens in SQL; only bounded samples come back to Node.
// ---------------------------------------------------------------------------

// Per-month overlap counts + in/out totals for one merchant (over its window range).
const OVERLAP_SQL = `
WITH pay AS (
  SELECT to_char(date_trunc('month', pt.payment_date), 'YYYY-MM') ym, ptr.from_account acct,
         COUNT(*) c, SUM(pt.amount) a
  FROM payment_transaction pt JOIN payment_transaction_response ptr ON ptr.ptx_id = pt.id
  WHERE pt.merchant_id = $1 AND pt.payment_date >= $2::timestamp AND pt.payment_date < $3::timestamp
    AND ptr.from_account IS NOT NULL AND ptr.from_account <> ''
  GROUP BY 1, 2),
wd AS (
  SELECT to_char(date_trunc('month', transfer_date), 'YYYY-MM') ym, account_no acct,
         COUNT(*) c, SUM(amount) a
  FROM transfer_transaction
  WHERE merchant_id = $1 AND transfer_date >= $2::timestamp AND transfer_date < $3::timestamp
    AND type = 'Withdraw' AND account_no IS NOT NULL AND account_no <> ''
  GROUP BY 1, 2),
m AS (SELECT pay.ym, pay.acct, pay.c pc, pay.a pa, wd.c wc, wd.a wa
        FROM pay JOIN wd ON wd.ym = pay.ym AND wd.acct = pay.acct)
SELECT m.ym,
       (SELECT COUNT(*) FROM pay p WHERE p.ym = m.ym) AS pay_accts,
       (SELECT COUNT(*) FROM wd  w WHERE w.ym = m.ym) AS wd_accts,
       COUNT(*) AS overlap_accts,
       SUM(pc) AS in_cnt, SUM(pa) AS in_amt, SUM(wc) AS out_cnt, SUM(wa) AS out_amt
FROM m GROUP BY m.ym ORDER BY m.ym;
`;

// Top-N matched accounts per month for one merchant (with representative names/banks).
const SAMPLE_ACCT_SQL = `
WITH pay AS (
  SELECT to_char(date_trunc('month', pt.payment_date), 'YYYY-MM') ym, ptr.from_account acct,
         COUNT(*) c, SUM(pt.amount) a, MAX(ptr.from_name) nm, MAX(ptr.from_bank) bk
  FROM payment_transaction pt JOIN payment_transaction_response ptr ON ptr.ptx_id = pt.id
  WHERE pt.merchant_id = $1 AND pt.payment_date >= $2::timestamp AND pt.payment_date < $3::timestamp
    AND ptr.from_account IS NOT NULL AND ptr.from_account <> ''
  GROUP BY 1, 2),
wd AS (
  SELECT to_char(date_trunc('month', transfer_date), 'YYYY-MM') ym, account_no acct,
         COUNT(*) c, SUM(amount) a, MAX(account_holder_name) nm, MAX(bank_code) bk
  FROM transfer_transaction
  WHERE merchant_id = $1 AND transfer_date >= $2::timestamp AND transfer_date < $3::timestamp
    AND type = 'Withdraw' AND account_no IS NOT NULL AND account_no <> ''
  GROUP BY 1, 2),
m AS (
  SELECT pay.ym, pay.acct, pay.c pc, pay.a pa, pay.nm pay_name, pay.bk pay_bank,
         wd.c wc, wd.a wa, wd.nm wd_name, wd.bk wd_bank,
         row_number() OVER (PARTITION BY pay.ym ORDER BY (pay.c + wd.c) DESC, (pay.a + wd.a) DESC) rn
  FROM pay JOIN wd ON wd.ym = pay.ym AND wd.acct = pay.acct)
SELECT * FROM m WHERE rn <= $4 ORDER BY ym, rn;
`;

// A few real in/out transactions for the sampled accounts of one merchant.
const SAMPLE_TX_SQL = `
WITH tx AS (
  SELECT to_char(date_trunc('month', pt.payment_date), 'YYYY-MM') ym, ptr.from_account acct,
         pt.id::text order_id, pt.payment_date txn_date, 'Payment' type, pt.status, pt.amount,
         ptr.from_name holder, ptr.from_bank bank
  FROM payment_transaction pt JOIN payment_transaction_response ptr ON ptr.ptx_id = pt.id
  WHERE pt.merchant_id = $1 AND pt.payment_date >= $2::timestamp AND pt.payment_date < $3::timestamp
    AND ptr.from_account = ANY($4::text[])
  UNION ALL
  SELECT to_char(date_trunc('month', transfer_date), 'YYYY-MM') ym, account_no acct,
         id::text, transfer_date, 'Withdraw', status, amount, account_holder_name, bank_code
  FROM transfer_transaction
  WHERE merchant_id = $1 AND transfer_date >= $2::timestamp AND transfer_date < $3::timestamp
    AND type = 'Withdraw' AND account_no = ANY($4::text[]))
SELECT ym, acct, order_id, txn_date, type, status, amount, holder, bank
FROM (SELECT *, row_number() OVER (PARTITION BY ym, acct, type ORDER BY amount DESC NULLS LAST) rn FROM tx) t
WHERE rn <= $5 ORDER BY acct, ym, type, amount DESC;
`;

{
  const t3 = Date.now();
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: path.join(OUT, "3_same_account_sample.xlsx"), useStyles: true, useSharedStrings: false,
  });

  const wsSum = wb.addWorksheet("Overlap Summary", { views: [{ state: "frozen", ySplit: 1 }] });
  wsSum.columns = [
    { header: "MID", key: "mid", width: 16 },
    { header: "Merchant Name", key: "name", width: 22 },
    { header: "Status", key: "status", width: 10 },
    { header: "Month", key: "ym", width: 10 },
    { header: "Payer Accounts", key: "pay_accts", width: 14, style: { numFmt: "#,##0" } },
    { header: "Withdraw Accounts", key: "wd_accts", width: 16, style: { numFmt: "#,##0" } },
    { header: "Overlap Accounts", key: "overlap", width: 15, style: { numFmt: "#,##0" } },
    { header: "% of Payers", key: "pct", width: 12, style: { numFmt: "0.0%" } },
    { header: "In Count", key: "in_c", width: 12, style: { numFmt: "#,##0" } },
    { header: "In Amount", key: "in_a", width: 16, style: { numFmt: "#,##0.00" } },
    { header: "Out Count", key: "out_c", width: 12, style: { numFmt: "#,##0" } },
    { header: "Out Amount", key: "out_a", width: 16, style: { numFmt: "#,##0.00" } },
  ];
  wsSum.getRow(1).font = { bold: true };

  const wsAcc = wb.addWorksheet("Sample Accounts", { views: [{ state: "frozen", ySplit: 1 }] });
  wsAcc.columns = [
    { header: "MID", key: "mid", width: 16 },
    { header: "Merchant Name", key: "name", width: 22 },
    { header: "Month", key: "ym", width: 10 },
    { header: "Rank", key: "rn", width: 6, style: { numFmt: "#,##0" } },
    { header: "Bank Account Number", key: "acct", width: 22 },
    { header: "Payer Name (in)", key: "pay_name", width: 22 },
    { header: "Withdraw Holder (out)", key: "wd_name", width: 22 },
    { header: "Pay Bank", key: "pay_bank", width: 10 },
    { header: "WD Bank", key: "wd_bank", width: 10 },
    { header: "Pay #", key: "pc", width: 8, style: { numFmt: "#,##0" } },
    { header: "Pay Amount (in)", key: "pa", width: 16, style: { numFmt: "#,##0.00" } },
    { header: "WD #", key: "wc", width: 8, style: { numFmt: "#,##0" } },
    { header: "WD Amount (out)", key: "wa", width: 16, style: { numFmt: "#,##0.00" } },
    { header: "Net (in-out)", key: "net", width: 16, style: { numFmt: "#,##0.00" } },
  ];
  wsAcc.getRow(1).font = { bold: true };

  const wsTx = wb.addWorksheet("Sample Transactions", { views: [{ state: "frozen", ySplit: 1 }] });
  wsTx.columns = [
    { header: "MID", key: "mid", width: 16 },
    { header: "Merchant Name", key: "name", width: 22 },
    { header: "Month", key: "ym", width: 10 },
    { header: "Match Account", key: "acct", width: 22 },
    { header: "Order ID", key: "order_id", width: 14 },
    { header: "Transaction Date", key: "txn_date", width: 20 },
    { header: "Type", key: "type", width: 11 },
    { header: "Status", key: "status", width: 8 },
    { header: "Amount", key: "amount", width: 15, style: { numFmt: "#,##0.00" } },
    { header: "Holder Name", key: "holder", width: 24 },
    { header: "Bank Code", key: "bank", width: 10 },
  ];
  wsTx.getRow(1).font = { bold: true };

  let overlapRows = 0, sampleAccts = 0, sampleTx = 0, merchantsWithOverlap = 0;
  let i = 0;
  for (const m of merchants) {
    i++;
    const range = [m.id, m.window[0].from, m.window[2].to];
    const { rows: ov } = await pool.query(OVERLAP_SQL, range);
    if (ov.length === 0) continue;
    merchantsWithOverlap++;

    for (const r of ov) {
      const payAccts = Number(r.pay_accts);
      wsSum.addRow({
        mid: m.no, name: m.name, status: m.status, ym: r.ym,
        pay_accts: payAccts, wd_accts: Number(r.wd_accts), overlap: Number(r.overlap_accts),
        pct: payAccts ? Number(r.overlap_accts) / payAccts : 0,
        in_c: Number(r.in_cnt), in_a: Number(r.in_amt), out_c: Number(r.out_cnt), out_a: Number(r.out_amt),
      }).commit();
      overlapRows++;
    }

    const { rows: accs } = await pool.query(SAMPLE_ACCT_SQL, [...range, SAMPLE_TOP]);
    const sampledAccts = new Set();
    for (const a of accs) {
      sampledAccts.add(a.acct);
      wsAcc.addRow({
        mid: m.no, name: m.name, ym: a.ym, rn: Number(a.rn), acct: a.acct,
        pay_name: a.pay_name ?? null, wd_name: a.wd_name ?? null,
        pay_bank: a.pay_bank ?? null, wd_bank: a.wd_bank ?? null,
        pc: Number(a.pc), pa: Number(a.pa), wc: Number(a.wc), wa: Number(a.wa),
        net: Number(a.pa) - Number(a.wa),
      }).commit();
      sampleAccts++;
    }

    if (sampledAccts.size) {
      const { rows: txs } = await pool.query(SAMPLE_TX_SQL, [...range, [...sampledAccts], SAMPLE_TX]);
      for (const t of txs) {
        wsTx.addRow({
          mid: m.no, name: m.name, ym: t.ym, acct: t.acct, order_id: t.order_id,
          txn_date: t.txn_date ? String(t.txn_date).slice(0, 19) : null,
          type: t.type, status: t.status, amount: num(t.amount), holder: t.holder ?? null, bank: t.bank ?? null,
        }).commit();
        sampleTx++;
      }
    }
    if (i % 100 === 0) console.log(`  #3 scanned ${i}/${merchants.length}, ${merchantsWithOverlap} with overlap`);
  }

  wsSum.commit(); wsAcc.commit(); wsTx.commit();
  await wb.commit();
  console.log(`Wrote 3_same_account_sample.xlsx: ${merchantsWithOverlap} merchants w/ overlap, ` +
    `${overlapRows} summary rows, ${sampleAccts} sample accounts, ${sampleTx} sample txns in ${((Date.now() - t3) / 1000).toFixed(0)}s.`);
}

await pool.end();
console.log(`All done in ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
