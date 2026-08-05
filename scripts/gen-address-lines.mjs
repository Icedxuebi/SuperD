// Emits each merchant's address as one space-joined line:
//   <no> <moo> <building> <floor> <soi> <road> <sub_district> <district> <province>
// e.g. 26 เทศบาล 3 สระแก้ว เมืองสระแก้ว สระแก้ว
//
// Sibling of gen-bank-lines.mjs — same flags, same MID handling.
//
// The query lives in scripts/lib/merchant-lines.mjs (shared with fill-data-xlsx.mjs
// so the two can't drift). See it for the two things that make this non-obvious:
// merchant_address is reachable via BOTH merchant_id and merchant_personal_id, and
// a merchant has 3-4 addresses that are picked between by type priority
// (SHOP_ADDRESS -> WORKING -> CURRENT -> PERSONAL -> anything else).
//
// Use --with-type to see which tier each line came from — a PERSONAL line is the
// owner's home address, not the shop.
//
// Missing fields COLLAPSE rather than leave a slot (gen-bank-lines.mjs keeps its
// slots; here the separator is a space, so an empty slot is just a double space).
//
// Run:
//   node --env-file=.env.local scripts/gen-address-lines.mjs M241108093043
//   node --env-file=.env.local scripts/gen-address-lines.mjs --mids-file=mids.txt --out=addr.txt
//   node --env-file=.env.local scripts/gen-address-lines.mjs --all --with-mid --with-type
import pg from "pg";
import fs from "node:fs";
import { ADDRESS_LINE_SQL } from "./lib/merchant-lines.mjs";

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
const WITH_TYPE = process.argv.includes("--with-type");
const DELIM = flag("delim") ?? " ";   // separator BETWEEN address parts
const META = ";";                     // separator for the --with-mid / --with-type prefixes
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

const { rows } = await pool.query(ADDRESS_LINE_SQL, [ALL ? null : MIDS, DELIM]);
await pool.end();

function render(mid, r) {
  const parts = [];
  if (WITH_MID) parts.push(mid);
  if (WITH_TYPE) parts.push(r.addr_type);
  parts.push(r.address_line);
  return parts.join(META);
}

const lines = [];
const missing = [];
const dupes = [];

if (ALL) {
  // No caller order to honour. ~300 pre-approval rows have no merchant_no yet,
  // so --with-mid falls back to '#<id>' the way the UI does (see docs/dbinfo.md).
  for (const r of rows) lines.push(render(r.merchant_no ?? `#${r.id}`, r));
} else {
  // merchant_no has no unique constraint (the DB has none at all), so guard
  // against a MID resolving to more than one row. Rows with a NULL merchant_no
  // can't reach here — they never match ANY($1), since NULL = anything is NULL.
  const byMid = new Map();
  for (const r of rows) {
    if (!byMid.has(r.merchant_no)) byMid.set(r.merchant_no, []);
    byMid.get(r.merchant_no).push(r);
  }
  // Preserve the caller's MID order — the output is meant to paste back
  // alongside the input list.
  for (const mid of MIDS) {
    const found = byMid.get(mid);
    if (!found) { missing.push(mid); continue; }
    if (found.length > 1) dupes.push(`${mid} (${found.length} rows)`);
    for (const r of found) lines.push(render(mid, r));
  }
}

const text = lines.join("\n");
if (OUT) {
  fs.writeFileSync(OUT, text + (text ? "\n" : ""), "utf8");
  console.error(`Wrote ${lines.length} line(s) -> ${OUT}`);
} else if (text) {
  console.log(text);
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
