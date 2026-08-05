// Deliverable #3 — 3_sample_pattern_analysis.xlsx
//
// Covers ALL 22 merchants, for EACH month Apr/May/Jun 2026. For every
// merchant/month we pull a small sample of ~3-4 real transactions (2 Payment +
// 2 Withdraw when both exist, else up to 4 of whichever type is present),
// chronologically spread and successful when possible, so an analyst can eyeball
// the money-in / money-out pattern for the whole cohort.
//
// Reads ONLY the files already produced in ./sd — no database:
//   - sd/2_monthly_summary.xlsx        (By Merchant sheet) -> merchants + counts
//   - sd/1_transaction_details/*.xlsx  (per merchant)      -> the sample rows
//
// Output sheets:
//   - "Selection": 22 merchants x 3 months = 66 rows (counts + sample sizes)
//   - "Samples":   all sampled transactions in one table (detail columns)
//
// Run:  node --max-old-space-size=4096 scripts/gen-sample-pattern.mjs
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sd");
const DETAIL_DIR = path.join(OUT, "1_transaction_details");
const SUMMARY = path.join(OUT, "2_monthly_summary.xlsx");

const MONTHS = ["2026-04", "2026-05", "2026-06"];

// Detail column layout — identical to deliverable #1 so the police reader sees
// the same fields (incl. Status) in the sample rows.
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
// 1-based cell indexes matching DETAIL_COLS above.
const C = { order_id: 1, mid: 2, name: 3, biller: 4, date: 5, ref1: 6, ref2: 7,
  type: 8, status: 9, amount: 10, acc_no: 11, acc_name: 12, bank_code: 13, bank_name: 14 };

// ---------------------------------------------------------------------------
// 1) Read the By Merchant summary -> merchant list + per-month counts
// ---------------------------------------------------------------------------
const sumWb = new ExcelJS.Workbook();
await sumWb.xlsx.readFile(SUMMARY);
const wsB = sumWb.getWorksheet("By Merchant");

const hdr = wsB.getRow(1).values; // 1-based, [empty, "MID", ...]
const col = {};
hdr.forEach((h, i) => { if (typeof h === "string") col[h.trim()] = i; });
for (const n of ["MID", "Merchant Name", "Month", "Payment Count", "Withdraw Count", "Transfer Count"])
  if (!col[n]) throw new Error(`Summary missing column: ${n}`);

const merchants = [];            // {mid, name} unique, in By-Merchant (MID) order
const seen = new Set();
const counts = new Map();        // `${mid}|${ym}` -> {pay, wd, tr}
for (let i = 2; i <= wsB.rowCount; i++) {
  const r = wsB.getRow(i);
  const mid = String(r.getCell(col["MID"]).value ?? "");
  const name = String(r.getCell(col["Merchant Name"]).value ?? "");
  const ym = String(r.getCell(col["Month"]).value ?? "");
  if (!mid || !MONTHS.includes(ym)) continue;
  counts.set(`${mid}|${ym}`, {
    pay: Number(r.getCell(col["Payment Count"]).value ?? 0),
    wd: Number(r.getCell(col["Withdraw Count"]).value ?? 0),
    tr: Number(r.getCell(col["Transfer Count"]).value ?? 0),
  });
  if (!seen.has(mid)) { seen.add(mid); merchants.push({ mid, name }); }
}
console.log(`Merchants: ${merchants.length}, months: ${MONTHS.join(", ")}`);

// ---------------------------------------------------------------------------
// 2) Stream each merchant's detail file -> per-month Payment/Withdraw samples
// ---------------------------------------------------------------------------
const CAP = 2000; // bounded, chronology-preserving decimation cap per (ym,type)
function newBucket() { return { buf: [], step: 1, keep: 0 }; }
function pushSampled(b, row) {
  if (b.keep % b.step === 0) b.buf.push(row);
  b.keep++;
  if (b.buf.length > CAP) { b.buf = b.buf.filter((_, i) => i % 2 === 0); b.step *= 2; }
}
function readRow(r) {
  return {
    order_id: r.getCell(C.order_id).value, mid: r.getCell(C.mid).value,
    merchant_name: r.getCell(C.name).value, biller_id: r.getCell(C.biller).value,
    txn_date: r.getCell(C.date).value, ref1: r.getCell(C.ref1).value,
    ref2: r.getCell(C.ref2).value, type: r.getCell(C.type).value,
    status: r.getCell(C.status).value, amount: r.getCell(C.amount).value,
    bank_acc_no: r.getCell(C.acc_no).value, bank_acc_name: r.getCell(C.acc_name).value,
    bank_code: r.getCell(C.bank_code).value, bank_name: r.getCell(C.bank_name).value,
  };
}

const detailFiles = fs.readdirSync(DETAIL_DIR).filter((f) => f.endsWith(".xlsx"));
function fileFor(mid) {
  const f = detailFiles.find((n) => n.startsWith(`${mid}_`) || n === `${mid}.xlsx`);
  return f ? path.join(DETAIL_DIR, f) : null;
}

// pick n chronologically-spread rows from a bucket, preferring status 'S'
function pickN(bucket, n) {
  if (n <= 0) return [];
  const all = bucket.buf;
  const succ = all.filter((r) => String(r.status) === "S");
  const pool = succ.length >= n ? succ : all;
  if (pool.length <= n) return pool.slice();
  const out = [], used = new Set();
  for (let i = 0; i < n; i++) {
    let idx = n === 1 ? 0 : Math.round((i * (pool.length - 1)) / (n - 1));
    while (used.has(idx) && idx < pool.length - 1) idx++;
    if (used.has(idx)) continue;
    used.add(idx); out.push(pool[idx]);
  }
  return out;
}

// mid -> ym -> {Payment: [], Withdraw: []}   (final chosen sample rows)
const sampleRows = [];                      // flat list for the Samples sheet
const sampleCount = new Map();              // `${mid}|${ym}` -> {p, w}

for (const m of merchants) {
  const file = fileFor(m.mid);
  if (!file) { console.warn(`  ! no detail file for ${m.mid}`); continue; }
  // fresh buckets for this merchant's 3 months
  const buckets = {};
  for (const ym of MONTHS) buckets[ym] = { Payment: newBucket(), Withdraw: newBucket() };

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { worksheets: "emit", sharedStrings: "cache" });
  for await (const ws of reader) {
    for await (const row of ws) {
      if (row.number === 1) continue;
      const type = row.getCell(C.type).value;
      if (type !== "Payment" && type !== "Withdraw") continue;
      const ym = String(row.getCell(C.date).value ?? "").slice(0, 7);
      if (!buckets[ym]) continue;
      pushSampled(buckets[ym][type], readRow(row));
    }
  }

  for (const ym of MONTHS) {
    const pB = buckets[ym].Payment, wB = buckets[ym].Withdraw;
    const hasP = pB.buf.length > 0, hasW = wB.buf.length > 0;
    let nPay = 0, nWd = 0;
    if (hasP && hasW) { nPay = 2; nWd = 2; }   // both -> show the pattern
    else if (hasP) nPay = 4;                    // only payments
    else if (hasW) nWd = 4;                     // only withdraws
    const pays = pickN(pB, nPay), wds = pickN(wB, nWd);
    const rows = [...pays, ...wds].sort((a, b) =>
      String(a.txn_date).localeCompare(String(b.txn_date)));
    for (const r of rows) sampleRows.push({ ym, ...r });
    sampleCount.set(`${m.mid}|${ym}`, { p: pays.length, w: wds.length });
  }
  const tot = MONTHS.reduce((s, ym) => {
    const c = sampleCount.get(`${m.mid}|${ym}`); return s + (c ? c.p + c.w : 0);
  }, 0);
  console.log(`  ${m.mid} (${m.name}): ${tot} sample rows`);
}

// ---------------------------------------------------------------------------
// 3) Write 3_sample_pattern_analysis.xlsx
// ---------------------------------------------------------------------------
const wb = new ExcelJS.Workbook();

// Selection sheet — 22 merchants x 3 months
const wsSel = wb.addWorksheet("Selection");
wsSel.columns = [
  { header: "MID", key: "mid", width: 16 },
  { header: "Merchant Name", key: "name", width: 24 },
  { header: "Month", key: "ym", width: 12 },
  { header: "Payment Count", key: "pay", width: 15, style: { numFmt: "#,##0" } },
  { header: "Withdraw Count", key: "wd", width: 15, style: { numFmt: "#,##0" } },
  { header: "Transfer Count", key: "tr", width: 15, style: { numFmt: "#,##0" } },
  { header: "Has Both", key: "both", width: 10 },
  { header: "Sample Payment Rows", key: "sp", width: 18, style: { numFmt: "#,##0" } },
  { header: "Sample Withdraw Rows", key: "sw", width: 18, style: { numFmt: "#,##0" } },
  { header: "Total Sample Rows", key: "st", width: 16, style: { numFmt: "#,##0" } },
];
wsSel.getRow(1).font = { bold: true };
wsSel.views = [{ state: "frozen", ySplit: 1 }];
for (const m of merchants) {
  for (const ym of MONTHS) {
    const cnt = counts.get(`${m.mid}|${ym}`) ?? { pay: 0, wd: 0, tr: 0 };
    const s = sampleCount.get(`${m.mid}|${ym}`) ?? { p: 0, w: 0 };
    wsSel.addRow({
      mid: m.mid, name: m.name, ym,
      pay: cnt.pay, wd: cnt.wd, tr: cnt.tr,
      both: cnt.pay > 0 && cnt.wd > 0 ? "Yes" : "No",
      sp: s.p, sw: s.w, st: s.p + s.w,
    });
  }
}

// Samples sheet — every sampled transaction, sorted by MID then date
const wsSamp = wb.addWorksheet("Samples");
wsSamp.columns = [{ header: "Month", key: "ym", width: 10 }, ...DETAIL_COLS];
wsSamp.getRow(1).font = { bold: true };
wsSamp.views = [{ state: "frozen", ySplit: 1 }];
sampleRows.sort((a, b) =>
  String(a.mid).localeCompare(String(b.mid)) ||
  String(a.txn_date).localeCompare(String(b.txn_date)));
for (const r of sampleRows) {
  const amt = r.amount == null ? null : Number(r.amount);
  wsSamp.addRow({
    ym: r.ym, order_id: r.order_id, mid: r.mid, merchant_name: r.merchant_name,
    biller_id: r.biller_id ?? null,
    txn_date: r.txn_date ? String(r.txn_date).slice(0, 19) : null,
    ref1: r.ref1 ?? null, ref2: r.ref2 ?? null, type: r.type, status: r.status,
    amount: Number.isFinite(amt) ? amt : null,
    bank_acc_no: r.bank_acc_no ?? null, bank_acc_name: r.bank_acc_name ?? null,
    bank_code: r.bank_code ?? null, bank_name: r.bank_name ?? null,
  });
}

const outFile = path.join(OUT, "3_sample_pattern_analysis.xlsx");
await wb.xlsx.writeFile(outFile);
console.log(`\nSelection rows: ${merchants.length * MONTHS.length}, sample rows: ${sampleRows.length}`);
console.log(`Wrote ${outFile}`);
