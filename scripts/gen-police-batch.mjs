// Generates the three police-case deliverables into ./sd :
//   1) 1_transaction_details/<mid>_<name>.xlsx  — one workbook per merchant
//   2) 2_monthly_summary.xlsx                   — month x type (count + amount)
//   3) 3_sample_pattern_analysis.xlsx           — 1 merchant/month with both Payment & Withdraw
//
// Scope: the 22 merchants below, Apr–Jun 2026, ALL statuses (S and E), with a Status column.
// Run:  node --max-old-space-size=4096 --env-file=.env.local scripts/gen-police-batch.mjs [--test]
import pg from "pg";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

const TEST = process.argv.includes("--test");
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 3,
  statement_timeout: 600_000,
});

const DEFAULT_MIDS = [
  "M260113053019","M250521013903","M250821124353","M251114052726","M240429045335",
  "M250513021229","M250516062827","M251014053031","M260623143402","M250724051256",
  "M260106024109","M251105044528","M250528011850","M250916093724","M251017103053",
  "M250608054722","M251022111751","M250911054329","M250530044731","M250520043535",
  "M250911054230","M251107112114",
];

// MIDs may be overridden on the CLI (keeps the default batch above intact):
//   --mids=M1,M2,...           inline comma/space separated list
//   --mids-file=path.txt       one MID per line (# comments and blanks ignored)
// Otherwise the default 22-merchant batch is used.
function parseMids() {
  const inline = process.argv.find((a) => a.startsWith("--mids="));
  if (inline) return inline.slice("--mids=".length).split(/[\s,]+/).filter(Boolean);
  const fileArg = process.argv.find((a) => a.startsWith("--mids-file="));
  if (fileArg) {
    const p = fileArg.slice("--mids-file=".length);
    return fs.readFileSync(p, "utf8").split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  }
  return DEFAULT_MIDS;
}
const MIDS = parseMids();
console.log(`MIDs (${MIDS.length}): ${MIDS.join(", ")}`);

// Deliverable #3 granularity.
//   --sample=merchant (default) one MERCHANT per month having both Payment & Withdraw
//   --sample=customer          one END-CUSTOMER per month, i.e. a bank account that both
//                              paid the merchant and received a withdraw from it
// Single-MID runs want customer: the merchant pick degenerates into a copy of that
// merchant's detail workbook.
const sampleArg = process.argv.find((a) => a.startsWith("--sample="));
const SAMPLE_MODE = sampleArg ? sampleArg.slice("--sample=".length) : "merchant";
if (SAMPLE_MODE !== "merchant" && SAMPLE_MODE !== "customer") {
  console.error(`--sample must be 'merchant' or 'customer' (got '${SAMPLE_MODE}')`);
  process.exit(1);
}
console.log(`Sample mode: ${SAMPLE_MODE}`);

const MONTHS = [
  { ym: "2026-04", from: "2026-04-01 00:00:00", to: "2026-05-01 00:00:00" },
  { ym: "2026-05", from: "2026-05-01 00:00:00", to: "2026-06-01 00:00:00" },
  { ym: "2026-06", from: "2026-06-01 00:00:00", to: "2026-07-01 00:00:00" },
];
const RANGE = { from: "2026-04-01 00:00:00", to: "2026-07-01 00:00:00" };

const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT_NAME = outArg ? outArg.slice("--out=".length) : "sd";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", OUT_NAME);
const DETAIL_DIR = path.join(OUT, "1_transaction_details");
fs.mkdirSync(DETAIL_DIR, { recursive: true });

// Column layout for detail rows (police-case columns + Status).
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
  { header: "Amount", key: "amount", width: 15, numFmt: "#,##0.00" },
  { header: "Bank Account Number", key: "bank_acc_no", width: 20 },
  { header: "Bank Account Name", key: "bank_acc_name", width: 22 },
  { header: "Bank Code", key: "bank_code", width: 10 },
  { header: "Bank Name", key: "bank_name", width: 22 },
];

const DETAIL_SQL = `
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

ORDER BY 5;
`;

// As DETAIL_SQL, but for a single end-customer of one merchant ($4 = bank account).
// A customer is identified by the payer account on the way in (payment_transaction_response
// .from_account) and the destination account on the way out (transfer_transaction.account_no).
const CUSTOMER_DETAIL_SQL = `
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
JOIN merchant_info mi                   ON mi.id = pt.merchant_id
JOIN payment_transaction_response ptr   ON ptr.ptx_id = pt.id
LEFT JOIN gateway_channel gc_qr         ON gc_qr.id = mi.qr_gwc_id
LEFT JOIN master_data md
       ON md.key1 = 'BANK' AND md.key2 = ptr.from_bank AND md.enabled = TRUE
WHERE pt.merchant_id = $1
  AND pt.payment_date >= $2::timestamp AND pt.payment_date < $3::timestamp
  AND ptr.from_account = $4

UNION ALL

SELECT
    tt.id::text, mi.merchant_no, mi.merchant_name_en, gc_qr.merchant_id,
    tt.transfer_date, tt.merchant_invoice, tt.merchant_reference_no,
    tt.type, tt.status, tt.amount,
    tt.account_no, tt.account_holder_name, tt.bank_code, md.name_en
FROM transfer_transaction tt
JOIN merchant_info mi                   ON mi.id = tt.merchant_id
LEFT JOIN gateway_channel gc_qr         ON gc_qr.id = mi.qr_gwc_id
LEFT JOIN master_data md
       ON md.key1 = 'BANK' AND md.key2 = tt.bank_code AND md.enabled = TRUE
WHERE tt.merchant_id = $1
  AND tt.transfer_date >= $2::timestamp AND tt.transfer_date < $3::timestamp
  AND tt.account_no = $4

ORDER BY 5;
`;

// Best (merchant, account) pair per month: the account with the most balanced
// pay-in / withdraw activity, scored by LEAST(pay, wd) to match the merchant picker.
const CUSTOMER_PICK_SQL = `
WITH pay AS (
  SELECT pt.merchant_id,
         to_char(date_trunc('month', pt.payment_date), 'YYYY-MM') AS ym,
         ptr.from_account AS acct,
         MAX(ptr.from_name) AS nm,
         COUNT(*)::int AS cnt,
         SUM(pt.amount)::numeric AS amt
    FROM payment_transaction pt
    JOIN payment_transaction_response ptr ON ptr.ptx_id = pt.id
   WHERE pt.merchant_id = ANY($1::bigint[])
     AND pt.payment_date >= $2::timestamp AND pt.payment_date < $3::timestamp
     AND ptr.from_account IS NOT NULL AND ptr.from_account <> ''
   GROUP BY 1,2,3
),
wd AS (
  SELECT tt.merchant_id,
         to_char(date_trunc('month', tt.transfer_date), 'YYYY-MM') AS ym,
         tt.account_no AS acct,
         MAX(tt.account_holder_name) AS nm,
         COUNT(*)::int AS cnt,
         SUM(tt.amount)::numeric AS amt
    FROM transfer_transaction tt
   WHERE tt.merchant_id = ANY($1::bigint[])
     AND tt.transfer_date >= $2::timestamp AND tt.transfer_date < $3::timestamp
     AND tt.type = 'Withdraw'
     AND tt.account_no IS NOT NULL AND tt.account_no <> ''
   GROUP BY 1,2,3
)
SELECT DISTINCT ON (pay.ym)
       pay.ym, pay.merchant_id, pay.acct,
       pay.nm AS pay_name, wd.nm AS wd_name,
       pay.cnt AS pay_cnt, pay.amt AS pay_amt,
       wd.cnt  AS wd_cnt,  wd.amt  AS wd_amt
  FROM pay
  JOIN wd ON wd.merchant_id = pay.merchant_id AND wd.ym = pay.ym AND wd.acct = pay.acct
 ORDER BY pay.ym, LEAST(pay.cnt, wd.cnt) DESC, pay.cnt DESC, pay.acct;
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

function styleHeader(ws) {
  const h = ws.getRow(1);
  h.font = { bold: true };
  h.commit?.();
}

function sanitize(s) {
  return String(s).replace(/[^A-Za-z0-9 _.-]/g, "").trim().slice(0, 60) || "merchant";
}

// ---- resolve merchants ----
const { rows: merchants } = await pool.query(
  `SELECT id, merchant_no, merchant_name_en FROM merchant_info WHERE merchant_no = ANY($1::text[])`,
  [MIDS],
);
merchants.sort((a, b) => a.merchant_no.localeCompare(b.merchant_no));
const nameOf = new Map(merchants.map((m) => [String(m.id), m.merchant_name_en]));
const noOf = new Map(merchants.map((m) => [String(m.id), m.merchant_no]));
console.log(`Resolved ${merchants.length} merchants.`);

// ============================================================
// Aggregation (feeds deliverable #2 and the sample selection)
// ============================================================
const { rows: agg } = await pool.query(
  `
  WITH pay AS (
    SELECT merchant_id,
           to_char(date_trunc('month', payment_date), 'YYYY-MM') AS ym,
           'Payment'::text AS type, COUNT(*)::bigint AS cnt, SUM(amount)::numeric AS amt
      FROM payment_transaction
     WHERE merchant_id = ANY($1::bigint[])
       AND payment_date >= $2::timestamp AND payment_date < $3::timestamp
     GROUP BY 1,2
  ),
  tr AS (
    SELECT merchant_id,
           to_char(date_trunc('month', transfer_date), 'YYYY-MM') AS ym,
           COALESCE(type,'(null)') AS type, COUNT(*)::bigint AS cnt, SUM(amount)::numeric AS amt
      FROM transfer_transaction
     WHERE merchant_id = ANY($1::bigint[])
       AND transfer_date >= $2::timestamp AND transfer_date < $3::timestamp
     GROUP BY 1,2,3
  )
  SELECT * FROM pay UNION ALL SELECT * FROM tr
  `,
  [merchants.map((m) => m.id), RANGE.from, RANGE.to],
);
console.log(`Aggregation rows: ${agg.length}`);

const TYPES = ["Payment", "Withdraw", "Transfer", "Settlement"];
const ymList = MONTHS.map((m) => m.ym);

// key helpers
const keyMT = (mid, ym, type) => `${mid}|${ym}|${type}`;
const cellCnt = new Map();
const cellAmt = new Map();
for (const r of agg) {
  cellCnt.set(keyMT(r.merchant_id, r.ym, r.type), Number(r.cnt));
  cellAmt.set(keyMT(r.merchant_id, r.ym, r.type), Number(r.amt));
}

// ---------- Deliverable #2: monthly summary ----------
{
  const wb = new ExcelJS.Workbook();

  // Sheet A: all merchants, month x type
  const wsA = wb.addWorksheet("Monthly Summary (All)");
  wsA.columns = [
    { header: "Month", key: "ym", width: 12 },
    ...TYPES.flatMap((t) => [
      { header: `${t} Count`, key: `${t}_c`, width: 14, style: { numFmt: "#,##0" } },
      { header: `${t} Amount`, key: `${t}_a`, width: 18, style: { numFmt: "#,##0.00" } },
    ]),
    { header: "Total Count", key: "tot_c", width: 14, style: { numFmt: "#,##0" } },
    { header: "Total Amount", key: "tot_a", width: 18, style: { numFmt: "#,##0.00" } },
  ];
  const totalsRow = {}; // grand totals accumulator
  for (const t of TYPES) { totalsRow[`${t}_c`] = 0; totalsRow[`${t}_a`] = 0; }
  totalsRow.tot_c = 0; totalsRow.tot_a = 0;

  for (const ym of ymList) {
    const row = { ym };
    let tc = 0, ta = 0;
    for (const t of TYPES) {
      let c = 0, a = 0;
      for (const m of merchants) {
        c += cellCnt.get(keyMT(m.id, ym, t)) ?? 0;
        a += cellAmt.get(keyMT(m.id, ym, t)) ?? 0;
      }
      row[`${t}_c`] = c; row[`${t}_a`] = a; tc += c; ta += a;
      totalsRow[`${t}_c`] += c; totalsRow[`${t}_a`] += a;
    }
    row.tot_c = tc; row.tot_a = ta;
    totalsRow.tot_c += tc; totalsRow.tot_a += ta;
    wsA.addRow(row);
  }
  wsA.addRow({ ym: "TOTAL", ...totalsRow }).font = { bold: true };
  styleHeader(wsA);

  // Sheet B: per merchant, month x type (long-ish wide format)
  const wsB = wb.addWorksheet("By Merchant");
  wsB.columns = [
    { header: "MID", key: "mid", width: 16 },
    { header: "Merchant Name", key: "name", width: 20 },
    { header: "Month", key: "ym", width: 12 },
    ...TYPES.flatMap((t) => [
      { header: `${t} Count`, key: `${t}_c`, width: 13, style: { numFmt: "#,##0" } },
      { header: `${t} Amount`, key: `${t}_a`, width: 16, style: { numFmt: "#,##0.00" } },
    ]),
    { header: "Total Count", key: "tot_c", width: 13, style: { numFmt: "#,##0" } },
    { header: "Total Amount", key: "tot_a", width: 16, style: { numFmt: "#,##0.00" } },
  ];
  for (const m of merchants) {
    for (const ym of ymList) {
      const row = { mid: m.merchant_no, name: m.merchant_name_en, ym };
      let tc = 0, ta = 0;
      for (const t of TYPES) {
        const c = cellCnt.get(keyMT(m.id, ym, t)) ?? 0;
        const a = cellAmt.get(keyMT(m.id, ym, t)) ?? 0;
        row[`${t}_c`] = c; row[`${t}_a`] = a; tc += c; ta += a;
      }
      row.tot_c = tc; row.tot_a = ta;
      wsB.addRow(row);
    }
  }
  styleHeader(wsB);

  const p = path.join(OUT, "2_monthly_summary.xlsx");
  await wb.xlsx.writeFile(p);
  console.log(`Wrote ${p}`);
}

// ---------- Sample selection: 1 merchant or customer per month with both Payment & Withdraw ----------
// Entries share { ym, merchant_id, merchant_no, name, payCnt, wdCnt }; customer mode adds acct.
const sampleChoice = [];
if (SAMPLE_MODE === "merchant") {
  for (const ym of ymList) {
    let best = null;
    for (const m of merchants) {
      const pay = cellCnt.get(keyMT(m.id, ym, "Payment")) ?? 0;
      const wd = cellCnt.get(keyMT(m.id, ym, "Withdraw")) ?? 0;
      if (pay > 0 && wd > 0) {
        const score = Math.min(pay, wd); // most robust "has both" example
        if (!best || score > best.score) {
          best = { ym, merchant_id: m.id, merchant_no: m.merchant_no, name: m.merchant_name_en, payCnt: pay, wdCnt: wd, score };
        }
      }
    }
    if (best) sampleChoice.push(best);
  }
  console.log("Sample picks:", sampleChoice.map((s) => `${s.ym}=${s.merchant_no}(${s.name}) pay=${s.payCnt} wd=${s.wdCnt}`).join(" | "));
} else {
  const { rows: picks } = await pool.query(CUSTOMER_PICK_SQL, [merchants.map((m) => m.id), RANGE.from, RANGE.to]);
  const byYm = new Map(picks.map((p) => [p.ym, p]));
  for (const ym of ymList) {
    const p = byYm.get(ym);
    if (!p) { console.log(`  no customer with both Payment & Withdraw in ${ym}`); continue; }
    sampleChoice.push({
      ym,
      merchant_id: p.merchant_id,
      merchant_no: noOf.get(String(p.merchant_id)),
      name: nameOf.get(String(p.merchant_id)),
      acct: p.acct,
      payName: p.pay_name,
      wdName: p.wd_name,
      payCnt: Number(p.pay_cnt),
      wdCnt: Number(p.wd_cnt),
      payAmt: Number(p.pay_amt),
      wdAmt: Number(p.wd_amt),
    });
  }
  console.log("Sample picks:", sampleChoice.map((s) => `${s.ym}=${s.acct}(${s.payName}) pay=${s.payCnt} wd=${s.wdCnt}`).join(" | "));
}

// ============================================================
// Deliverable #1: per-merchant detail workbooks (streamed)
// ============================================================
const detailMerchants = TEST ? merchants.slice(-2) : merchants; // 2 smallest in test mode
for (const m of detailMerchants) {
  const file = path.join(DETAIL_DIR, `${m.merchant_no}_${sanitize(m.merchant_name_en)}.xlsx`);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: false });
  const ws = wb.addWorksheet("Transactions");
  ws.columns = DETAIL_COLS;
  styleHeader(ws);
  let n = 0;
  for (const mo of MONTHS) {
    const { rows } = await pool.query(DETAIL_SQL, [m.id, mo.from, mo.to]);
    for (const r of rows) addDetailRow(ws, r);
    n += rows.length;
  }
  ws.commit();
  await wb.commit();
  console.log(`  detail ${m.merchant_no} (${m.merchant_name_en}): ${n} rows -> ${path.basename(file)}`);
}

// ============================================================
// Deliverable #3: sample pattern analysis workbook (streamed)
// ============================================================
{
  const file = path.join(OUT, "3_sample_pattern_analysis.xlsx");
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: false });

  // Selection overview sheet
  const wsSel = wb.addWorksheet("Selection");
  wsSel.columns = SAMPLE_MODE === "merchant"
    ? [
        { header: "Month", key: "ym", width: 12 },
        { header: "MID", key: "mid", width: 16 },
        { header: "Merchant Name", key: "name", width: 22 },
        { header: "Payment Count", key: "pay", width: 16, style: { numFmt: "#,##0" } },
        { header: "Withdraw Count", key: "wd", width: 16, style: { numFmt: "#,##0" } },
      ]
    : [
        { header: "Month", key: "ym", width: 12 },
        { header: "MID", key: "mid", width: 16 },
        { header: "Merchant Name", key: "name", width: 22 },
        { header: "Customer Account", key: "acct", width: 20 },
        { header: "Name (from Payment)", key: "pay_name", width: 28 },
        { header: "Name (from Withdraw)", key: "wd_name", width: 28 },
        { header: "Payment Count", key: "pay", width: 15, style: { numFmt: "#,##0" } },
        { header: "Payment Amount", key: "pay_amt", width: 17, style: { numFmt: "#,##0.00" } },
        { header: "Withdraw Count", key: "wd", width: 15, style: { numFmt: "#,##0" } },
        { header: "Withdraw Amount", key: "wd_amt", width: 17, style: { numFmt: "#,##0.00" } },
      ];
  wsSel.getRow(1).font = { bold: true };
  for (const s of sampleChoice) {
    const row = { ym: s.ym, mid: s.merchant_no, name: s.name, pay: s.payCnt, wd: s.wdCnt };
    if (SAMPLE_MODE === "customer") {
      Object.assign(row, { acct: s.acct, pay_name: s.payName, wd_name: s.wdName, pay_amt: s.payAmt, wd_amt: s.wdAmt });
    }
    wsSel.addRow(row).commit();
  }
  wsSel.commit();

  for (const s of sampleChoice) {
    const mo = MONTHS.find((x) => x.ym === s.ym);
    const isCust = SAMPLE_MODE === "customer";
    // Excel caps sheet names at 31 chars and forbids []:*?/\
    const ws = wb.addWorksheet(`${s.ym} ${isCust ? s.acct : s.merchant_no}`.replace(/[[\]:*?/\\]/g, "").slice(0, 31));
    ws.columns = DETAIL_COLS;
    ws.getRow(1).font = { bold: true };
    const { rows } = isCust
      ? await pool.query(CUSTOMER_DETAIL_SQL, [s.merchant_id, mo.from, mo.to, s.acct])
      : await pool.query(DETAIL_SQL, [s.merchant_id, mo.from, mo.to]);
    for (const r of rows) addDetailRow(ws, r);
    ws.commit();
    console.log(`  sample ${s.ym} ${isCust ? s.acct : s.merchant_no}: ${rows.length} rows`);
  }
  await wb.commit();
  console.log(`Wrote ${file}`);
}

await pool.end();
console.log("Done.");
