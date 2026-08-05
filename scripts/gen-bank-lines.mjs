// Emits each merchant's bank details as one delimited line:
//   $<3-digit bank code>,<account no>
// e.g. $006,2363277538      (006 = Krung Thai, the Bank of Thailand code)
//
// A field that is missing — or set but unresolvable — is left blank and KEEPS its
// slot, so every line always has exactly 2 fields. The query itself (and why the
// bank code comes from master_data.key2 rather than merchant_info.bank_id) lives
// in scripts/lib/merchant-lines.mjs, shared with fill-data-xlsx.mjs so the two
// can't drift.
//
// Run:
//   node --env-file=.env.local scripts/gen-bank-lines.mjs M241108093043
//   node --env-file=.env.local scripts/gen-bank-lines.mjs --mids-file=mids.txt --out=lines.txt
//   node --env-file=.env.local scripts/gen-bank-lines.mjs --all --with-mid
import pg from "pg";
import fs from "node:fs";
import { BANK_LINE_SQL } from "./lib/merchant-lines.mjs";

const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

function flag(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const ALL = process.argv.includes("--all");
const WITH_MID = process.argv.includes("--with-mid");
const DELIM = flag("delim") ?? ",";
const OUT = flag("out");

// MIDs from --mids=, --mids-file=, or bare positional args. --all takes the lot.
function parseMids() {
  const inline = flag("mids");
  if (inline) return inline.split(/[\s,]+/).filter(Boolean);
  const file = flag("mids-file");
  if (file) {
    return fs.readFileSync(file, "utf8").split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  }
  return process.argv.slice(2).filter((a) => !a.startsWith("-"));
}
const MIDS = parseMids();

if (!ALL && MIDS.length === 0) {
  console.error(
    "No MIDs given. Pass them positionally, via --mids=M1,M2 or --mids-file=path.txt, or use --all.",
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 2,
  statement_timeout: 120_000,
});

const { rows } = await pool.query(BANK_LINE_SQL, [ALL ? null : MIDS, DELIM]);
await pool.end();

const lines = [];
const missing = [];
const dupes = [];

if (ALL) {
  // No caller order to honour, and no MID lookup to do — emit in query order.
  // ~300 pre-approval rows carry no merchant_no yet, so --with-mid falls back to
  // '#<id>' the way the UI does (see docs/dbinfo.md — onboarding FSM).
  for (const r of rows) {
    lines.push(WITH_MID ? `${r.merchant_no ?? `#${r.id}`}${DELIM}${r.bank_line}` : r.bank_line);
  }
} else {
  // merchant_no has no unique constraint (the DB has none at all), so guard
  // against a MID resolving to more than one row rather than silently emitting
  // the first. Rows with a NULL merchant_no can't reach here — they never match
  // ANY($1), since NULL = anything is NULL.
  const byMid = new Map();
  for (const r of rows) {
    if (!byMid.has(r.merchant_no)) byMid.set(r.merchant_no, []);
    byMid.get(r.merchant_no).push(r.bank_line);
  }

  // Preserve the caller's MID order — the output is meant to paste back
  // alongside the input list.
  for (const mid of MIDS) {
    const found = byMid.get(mid);
    if (!found) { missing.push(mid); continue; }
    if (found.length > 1) dupes.push(`${mid} (${found.length} rows)`);
    for (const line of found) lines.push(WITH_MID ? `${mid}${DELIM}${line}` : line);
  }
}

const text = lines.join("\n");
if (OUT) {
  fs.writeFileSync(OUT, text + (text ? "\n" : ""), "utf8");
  console.error(`Wrote ${lines.length} line(s) -> ${OUT}`);
} else {
  if (text) console.log(text);
}

// Diagnostics go to stderr so stdout stays clean for piping/redirecting.
if (missing.length) {
  console.error(`\n${missing.length} MID(s) not found in merchant_info:`);
  for (const m of missing) console.error(`  ${m}`);
}
if (dupes.length) {
  console.error(`\n${dupes.length} MID(s) matched multiple merchant_info rows:`);
  for (const d of dupes) console.error(`  ${d}`);
}
