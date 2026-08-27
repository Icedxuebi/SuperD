// Runs rec_transaction.sql for a given date and writes the CSV into files/.
//
//   node --env-file=.env.local scripts/run-rec-transaction.mjs --date=2026-03-01
//   node --env-file=.env.local scripts/run-rec-transaction.mjs --from=2026-03-01 --to=2026-03-31
//   node --env-file=.env.local scripts/run-rec-transaction.mjs --month=2026-03
//
// One CSV per day, named for the day it holds: files/rec_transaction_2026-03-01.csv.
// Each day runs as the window (D, D) -- rec_transaction.sql includes both ends,
// so that is exactly one calendar day and consecutive files never overlap.
//
// Cross-day matching is handled inside rec_transaction.sql, not here. Statement
// rows are windowed on system_date with a 2-day lookback on the file selection,
// so rows the bank value-dated back to the previous banking day still land in
// the same day as their transfer. A one-day window is therefore correct on its
// own and needs no widening -- an earlier version of this script widened the
// window to compensate, which only fixed the leading day of each file and made
// the output overlap.
//
// --window-days=N still widens the window to (D, D+N-1) for ad-hoc
// investigation. It is no longer needed for correctness, and anything above 1
// emits files that overlap by N-1 days, so do not sum a month of those.
// _run_rec_ultimate_to_csv.mjs always behaves like --window-days=2.
//
// Re-running resumes: days whose CSV already exists and is non-empty are
// skipped, so an interrupted range picks up where it left off. --force redoes
// them. --out=DIR writes somewhere other than files/.
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v); // date -> raw text
types.setTypeParser(1114, (v) => v); // timestamp without tz -> raw text

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

function arg(name, fallback) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
}

const USAGE = `Usage:
  node --env-file=.env.local scripts/run-rec-transaction.mjs --date=YYYY-MM-DD
  node --env-file=.env.local scripts/run-rec-transaction.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD
  node --env-file=.env.local scripts/run-rec-transaction.mjs --month=YYYY-MM
Options: [--window-days=N] [--out=DIR] [--force]`;

const DATE = arg("date", null);
const FROM = arg("from", null);
const TO = arg("to", null);
const MONTH = arg("month", null);
const FORCE = process.argv.includes("--force");
const WINDOW_DAYS = Number(arg("window-days", "1"));
if (!Number.isInteger(WINDOW_DAYS) || WINDOW_DAYS < 1) {
  console.error(`--window-days must be a whole number >= 1 (got ${arg("window-days", "1")})`);
  process.exit(1);
}

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// every day from `from` to `to`, both included
function dayRange(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

let DAYS;
if (DATE) {
  if (!isDay(DATE)) { console.error(`Bad --date: ${DATE}\n\n${USAGE}`); process.exit(1); }
  DAYS = [DATE];
} else if (FROM || TO) {
  if (!isDay(FROM ?? "") || !isDay(TO ?? "")) { console.error(`--from and --to must both be YYYY-MM-DD\n\n${USAGE}`); process.exit(1); }
  if (Date.parse(`${TO}T00:00:00Z`) < Date.parse(`${FROM}T00:00:00Z`)) { console.error(`--to (${TO}) is before --from (${FROM})`); process.exit(1); }
  DAYS = dayRange(FROM, TO);
} else if (MONTH) {
  if (!/^\d{4}-\d{2}$/.test(MONTH)) { console.error(`Bad --month: ${MONTH}\n\n${USAGE}`); process.exit(1); }
  const [y, m] = MONTH.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  DAYS = dayRange(first, last);
} else {
  console.error(USAGE);
  process.exit(1);
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = path.join(ROOT, "rec_transaction.sql");
if (!fs.existsSync(sqlPath)) { console.error(`SQL file not found: ${sqlPath}`); process.exit(1); }
const sql = fs.readFileSync(sqlPath, "utf8");

const OUT_DIR = arg("out", null) ?? process.env.CSV_OUT_DIR ?? path.join(ROOT, "files");
fs.mkdirSync(OUT_DIR, { recursive: true });

function csvField(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 1,
  statement_timeout: 1_800_000,
});

console.error(`Running rec_transaction.sql for ${DAYS.length} day(s), window ${WINDOW_DAYS} day(s) -> ${OUT_DIR}`);
const failed = [];
const grandTotal = {};

for (const day of DAYS) {
  // rec_transaction.sql includes both ends, so end = day + (WINDOW_DAYS - 1)
  const end = new Date(Date.parse(`${day}T00:00:00Z`) + (WINDOW_DAYS - 1) * 864e5)
    .toISOString().slice(0, 10);
  const label = WINDOW_DAYS === 1 ? day : `${day} -> ${end}`;
  const outPath = path.join(OUT_DIR,
    WINDOW_DAYS === 1 ? `rec_transaction_${day}.csv` : `rec_transaction_${day}_to_${end}.csv`);
  if (!FORCE && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    console.error(`  ${label}: skip (already exists)`);
    continue;
  }
  const t0 = Date.now();
  try {
    const { rows, fields } = await pool.query(sql, [day, end]);
    const cols = fields.map((f) => f.name);
    const lines = [cols.map(csvField).join(",")];
    for (const row of rows) {
      lines.push(cols.map((c) => csvField(row[c])).join(","));
    }
    fs.writeFileSync(outPath, lines.join("\r\n") + "\r\n", "utf8");

    const byType = {};
    for (const r of rows) byType[r.match_type] = (byType[r.match_type] || 0) + 1;
    for (const [k, v] of Object.entries(byType)) grandTotal[k] = (grandTotal[k] || 0) + v;
    const summary = Object.entries(byType).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`).join(" ");

    console.error(`  ${label}: ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${outPath}`);
    if (summary) console.error(`           ${summary}`);
  } catch (err) {
    console.error(`  ${label}: FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s — ${err.message}`);
    failed.push(label);
  }
}

await pool.end();

if (Object.keys(grandTotal).length) {
  console.error("\nmatch_type totals:");
  console.table(grandTotal);
}
if (failed.length) {
  console.error(`Done, but ${failed.length} day(s) failed and were skipped:`);
  for (const f of failed) console.error(`  ${f}`);
  process.exit(1);
}
console.error("Done.");
