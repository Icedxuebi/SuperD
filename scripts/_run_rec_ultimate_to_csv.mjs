// Runs a reconcile .sql once per calendar day of a month, one CSV per day.
// Re-running the same command resumes: days whose CSV already exists in
// files/ are skipped, so an interrupted month picks up where it left off.
// Pass --force to redo every day regardless.
// Run: node --env-file=.env.local scripts/_run_rec_ultimate_to_csv.mjs --month=2026-03
// --sql= picks which reconcile to run; it defaults to rec_ultimate.sql
// (payments in). Use --sql=rec_transaction.sql for transfers out. The CSV
// name follows the .sql basename, so the two never overwrite each other.
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

const MONTH = arg("month", null);
if (!MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error("Usage: node --env-file=.env.local scripts/_run_rec_ultimate_to_csv.mjs --month=YYYY-MM [--sql=rec_ultimate.sql] [--force] [--from-day=N]");
  process.exit(1);
}
const SQL_FILE = arg("sql", "rec_ultimate.sql");
const FORCE = process.argv.includes("--force");
const FROM_DAY = Number(arg("from-day", "1"));

// One (start_day, end_day) pair per calendar day of the month, sliding by a
// day each time: (1,2), (2,3), ... (last, next-month-1st) — matches
// rec_ultimate.sql's own "inclusive day window" shape. fromDay (1-indexed)
// skips earlier days entirely, e.g. to resume a month past a known-bad day.
function daySlices(month, fromDay) {
  const [y, m] = month.split("-").map(Number);
  const out = [];
  for (let d = new Date(Date.UTC(y, m - 1, fromDay)); d.getUTCMonth() === m - 1; d = new Date(d.getTime() + 864e5)) {
    const next = new Date(d.getTime() + 864e5);
    out.push([d.toISOString().slice(0, 10), next.toISOString().slice(0, 10)]);
  }
  return out;
}
const SLICES = daySlices(MONTH, FROM_DAY);

const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 1,
  statement_timeout: 1_800_000,
});

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = path.isAbsolute(SQL_FILE) ? SQL_FILE : path.join(ROOT, SQL_FILE);
if (!fs.existsSync(sqlPath)) { console.error(`SQL file not found: ${sqlPath}`); process.exit(1); }
const sql = fs.readFileSync(sqlPath, "utf8");
const PREFIX = path.basename(sqlPath, ".sql");

const OUT_DIR = process.env.CSV_OUT_DIR || path.join(ROOT, "files");
fs.mkdirSync(OUT_DIR, { recursive: true });

function csvField(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

console.error(`Running ${path.basename(sqlPath)} for ${MONTH} (${SLICES.length} days)...`);
const failed = [];
for (const [start, end] of SLICES) {
  const outPath = path.join(OUT_DIR, `${PREFIX}_${start}_to_${end}.csv`);
  if (!FORCE && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    console.error(`  ${start} -> ${end}: skip (already exists)`);
    continue;
  }
  const t0 = Date.now();
  try {
    const { rows, fields } = await pool.query(sql, [start, end]);
    const cols = fields.map((f) => f.name);
    const lines = [cols.map(csvField).join(",")];
    for (const row of rows) {
      lines.push(cols.map((c) => csvField(row[c])).join(","));
    }
    fs.writeFileSync(outPath, lines.join("\r\n") + "\r\n", "utf8");
    console.error(`  ${start} -> ${end}: ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${outPath}`);
  } catch (err) {
    console.error(`  ${start} -> ${end}: FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s — ${err.message}`);
    failed.push(`${start} -> ${end}`);
  }
}

await pool.end();
if (failed.length) {
  console.error(`Done, but ${failed.length} day(s) failed and were skipped:`);
  for (const f of failed) console.error(`  ${f}`);
  process.exit(1);
}
console.error("Done.");
