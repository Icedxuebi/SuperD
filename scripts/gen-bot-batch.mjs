// Resumable per-merchant extraction for the BOT batch.
//
// One workbook per merchant, three sheets:
//   Summary      — Thai roll-up, one line per month per direction (the police-case summary layout)
//   Payment In   — every payment_transaction row in range
//   Payment Out  — every transfer_transaction row in range (Withdraw + Transfer + Settlement)
//
// All statuses (S and E) are included; both detail sheets carry a Status column.
// Same column set and query logic as gen-police-batch.mjs / gen-inout-monthly.mjs.
//
// Progress is journalled to BOT/progress.json after every merchant, so an interrupted
// run resumes where it stopped. BOT/remaining.txt is rewritten each time and lists
// exactly which merchants are still outstanding.
//
// Run:  node --max-old-space-size=6144 --env-file=.env.local scripts/gen-bot-batch.mjs --limit=10
//       (re-run the same command to do the next 10)
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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOT = path.join(ROOT, arg("dir", "BOT"));
const LIST = path.join(ROOT, arg("list", "BOT/active-merchants.txt"));
const DATA_DIR = path.join(BOT, "data");
const PROGRESS = path.join(BOT, "progress.json");
const LOGFILE = path.join(BOT, "progress.log");
const REMAINING = path.join(BOT, "remaining.txt");
const LIMIT = Number(arg("limit", "10"));
const FROM = arg("from", "2026-01-01");
const TO = arg("to", "2026-07-22"); // exclusive — covers through 21 Jul 2026
fs.mkdirSync(DATA_DIR, { recursive: true });

function log(line) {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const msg = `[${stamp}] ${line}`;
  console.log(msg);
  fs.appendFileSync(LOGFILE, msg + "\r\n", "utf8");
}

// ---- merchant list (tab or comma separated, first column = MID; header row skipped) ----
const listed = fs.readFileSync(LIST, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    const [mid, ...rest] = l.split(/[\t,]/);
    return { mid: mid.trim(), name: rest.join(" ").trim() };
  })
  .filter((r) => /^M\d+$/.test(r.mid)); // drops the "MID  Name" header

// ---- progress journal ----
let progress = { done: {}, failed: {} };
if (fs.existsSync(PROGRESS)) {
  try { progress = JSON.parse(fs.readFileSync(PROGRESS, "utf8")); }
  catch { log("progress.json unreadable — starting a fresh journal"); }
}
progress.done ??= {};
progress.failed ??= {};

function saveProgress() {
  const doneSet = new Set(Object.keys(progress.done));
  const left = listed.filter((r) => !doneSet.has(r.mid));
  progress.updatedAt = new Date().toISOString();
  progress.totalListed = listed.length;
  progress.doneCount = doneSet.size;
  progress.remainingCount = left.length;
  fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 2), "utf8");
  fs.writeFileSync(
    REMAINING,
    `# ${left.length} of ${listed.length} merchants still to extract` +
      ` (updated ${progress.updatedAt.replace("T", " ").slice(0, 19)} UTC)\r\n` +
      left.map((r) => `${r.mid}\t${r.name}`).join("\r\n") + (left.length ? "\r\n" : ""),
    "utf8",
  );
}

// ============================================================
// SQL — identical column set to the police-case extraction
// ============================================================
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

const AGG_SQL = `
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
`;

// ---- helpers ----
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

// A merchant can hold ~750k rows in one direction; pull a day at a time so no single
// result set is held in memory. Day boundaries preserve the global date ordering.
function daySlices(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d < new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 864e5)) {
    out.push([d.toISOString().slice(0, 10), new Date(d.getTime() + 864e5).toISOString().slice(0, 10)]);
  }
  return out;
}

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

const safe = (s) => String(s).replace(/[^A-Za-z0-9 _.-]/g, "").trim().slice(0, 60) || "merchant";

// ============================================================
// One merchant → one workbook
// ============================================================
async function buildMerchant(m, label) {
  const file = path.join(DATA_DIR, `${m.merchant_no}_${safe(label)}.xlsx`);
  const tmp = `${file}.part`; // only renamed into place once fully written
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);

  const { rows: agg } = await pool.query(AGG_SQL, [m.id, FROM, TO]);
  const stat = new Map(agg.map((r) => [`${r.dir}|${r.ym}`, { cnt: Number(r.cnt), amt: Number(r.amt) }]));
  const get = (dir, ym) => stat.get(`${dir}|${ym}`) ?? { cnt: 0, amt: 0 };

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: tmp, useStyles: true, useSharedStrings: false });

  // ---- Sheet 1: Summary ----
  let totals;
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
      { header: "รายการ", key: "b_item", width: 24 },
      { header: "Type", key: "b_type", width: 8 },
      { header: "จำนวนรายการ", key: "b_cnt", width: 15, style: { numFmt: "#,##0" } },
      { header: "จำนวนเงิน", key: "b_amt", width: 18, style: { numFmt: "#,##0.00" } },
    ];
    // The streaming writer commits row 1 as soon as data rows are added — style it now.
    ws.getRow(1).font = { bold: true };

    const lines = [];
    for (const mo of MONTHS) {
      for (const dir of ["IN", "OUT"]) {
        const s = get(dir, mo.ym);
        lines.push({ item: `${label} - ${dir === "IN" ? "In" : "Out"} ${mo.mmyy}`, cnt: s.cnt, amt: s.amt, type: dir });
      }
    }
    const sum = (t) => lines.filter((l) => l.type === t)
      .reduce((a, l) => ({ cnt: a.cnt + l.cnt, amt: a.amt + l.amt }), { cnt: 0, amt: 0 });
    const totIn = sum("IN"), totOut = sum("OUT");

    const right = [
      { b_item: `${label} - In`, b_type: "IN", b_cnt: totIn.cnt, b_amt: totIn.amt },
      { b_item: `${label} - Out`, b_type: "OUT", b_cnt: totOut.cnt, b_amt: totOut.amt },
      { b_item: "รวมทั้งหมด", b_cnt: totIn.cnt + totOut.cnt, b_amt: totIn.amt + totOut.amt },
    ];

    lines.forEach((l, i) => {
      const row = ws.addRow({ ...l, ...(right[i] ?? {}) });
      if (i === 2) row.font = { bold: true };
      row.commit();
    });
    for (let i = lines.length; i < right.length; i++) ws.addRow(right[i]).commit();

    const tot = ws.addRow({ item: "รวมทั้งหมด", cnt: totIn.cnt + totOut.cnt, amt: totIn.amt + totOut.amt });
    tot.font = { bold: true };
    tot.commit();
    ws.commit();
    totals = { totIn, totOut };
  }

  // ---- Sheets 2 & 3: Payment In / Payment Out ----
  const written = {};
  for (const [dir, sheet, sql] of [["IN", "Payment In", IN_SQL], ["OUT", "Payment Out", OUT_SQL]]) {
    const ws = wb.addWorksheet(sheet);
    ws.columns = DETAIL_COLS;
    ws.getRow(1).font = { bold: true };
    let n = 0;
    for (const mo of MONTHS) {
      for (const [d0, d1] of daySlices(mo.from, mo.to)) {
        const { rows } = await pool.query(sql, [m.id, d0, d1]);
        for (const r of rows) addDetailRow(ws, r);
        n += rows.length;
      }
    }
    ws.commit();
    written[dir] = n;
  }

  await wb.commit();

  // Cross-check the streamed row counts against the independent GROUP BY aggregate.
  const expIn = totals.totIn.cnt, expOut = totals.totOut.cnt;
  if (written.IN !== expIn || written.OUT !== expOut) {
    throw new Error(`row mismatch: wrote In=${written.IN}/Out=${written.OUT}, aggregate says In=${expIn}/Out=${expOut}`);
  }

  fs.renameSync(tmp, file);
  return {
    file: path.relative(ROOT, file).replace(/\\/g, "/"),
    inCnt: written.IN, outCnt: written.OUT,
    inAmt: totals.totIn.amt, outAmt: totals.totOut.amt,
    sizeMB: +(fs.statSync(file).size / 1048576).toFixed(1),
  };
}

// ============================================================
// Batch
// ============================================================
const todo = listed.filter((r) => !progress.done[r.mid]).slice(0, LIMIT);
log(`=== batch start: ${todo.length} merchant(s), range ${FROM} .. ${TO} (exclusive) ===`);
log(`journal: ${Object.keys(progress.done).length}/${listed.length} already done`);
if (!todo.length) { log("nothing left to do"); saveProgress(); await pool.end(); process.exit(0); }

const { rows: resolved } = await pool.query(
  `SELECT id, merchant_no, merchant_name_en FROM merchant_info WHERE merchant_no = ANY($1::text[])`,
  [todo.map((r) => r.mid)],
);
const byNo = new Map(resolved.map((r) => [r.merchant_no, r]));

let ok = 0, bad = 0;
for (const [i, r] of todo.entries()) {
  const m = byNo.get(r.mid);
  if (!m) {
    log(`(${i + 1}/${todo.length}) ${r.mid} ${r.name} — SKIPPED: not found in merchant_info`);
    progress.failed[r.mid] = { name: r.name, error: "not found in merchant_info", at: new Date().toISOString() };
    bad++; saveProgress();
    continue;
  }
  const label = m.merchant_name_en || r.name || m.merchant_no;
  const t0 = Date.now();
  try {
    log(`(${i + 1}/${todo.length}) ${r.mid} ${label} — start`);
    const res = await buildMerchant(m, label);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    log(`(${i + 1}/${todo.length}) ${r.mid} ${label} — DONE In=${res.inCnt} Out=${res.outCnt} ${res.sizeMB}MB in ${secs}s -> ${res.file}`);
    progress.done[r.mid] = { name: label, ...res, at: new Date().toISOString(), seconds: Number(secs) };
    delete progress.failed[r.mid];
    ok++;
  } catch (e) {
    log(`(${i + 1}/${todo.length}) ${r.mid} ${label} — FAILED: ${e.message}`);
    progress.failed[r.mid] = { name: label, error: e.message, at: new Date().toISOString() };
    bad++;
  }
  saveProgress(); // journal after every merchant so a crash loses at most one
}

saveProgress();
log(`=== batch end: ${ok} ok, ${bad} failed — ${progress.doneCount}/${listed.length} done, ${progress.remainingCount} remaining ===`);
log(`remaining list: ${path.relative(ROOT, REMAINING).replace(/\\/g, "/")}`);
await pool.end();
