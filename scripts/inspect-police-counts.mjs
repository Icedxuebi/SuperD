import pg from "pg";

const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 2,
  statement_timeout: 600_000,
});

const DEFAULT_MIDS = [
  "M260113053019","M250521013903","M250821124353","M251114052726","M240429045335",
  "M250513021229","M250516062827","M251014053031","M260623143402","M250724051256",
  "M260106024109","M251105044528","M250528011850","M250916093724","M251017103053",
  "M250608054722","M251022111751","M250911054329","M250530044731","M250520043535",
  "M250911054230","M251107112114",
];

// --mids=M1,M2,... overrides the default batch above (same contract as gen-police-batch.mjs).
const midsArg = process.argv.find((a) => a.startsWith("--mids="));
const MIDS = midsArg ? midsArg.slice("--mids=".length).split(/[\s,]+/).filter(Boolean) : DEFAULT_MIDS;

const FROM = "2026-04-01 00:00:00";
const TO   = "2026-07-01 00:00:00";

const { rows: mrows } = await pool.query(
  `SELECT id, merchant_no, merchant_name_en FROM merchant_info WHERE merchant_no = ANY($1::text[])`, [MIDS]);
const ids = mrows.map((m) => m.id);

const start = Date.now();
const { rows } = await pool.query(
  `
  WITH pay AS (
    SELECT merchant_id,
           to_char(date_trunc('month', payment_date), 'YYYY-MM') AS ym,
           'Payment'::text AS type,
           COUNT(*)::bigint AS cnt,
           SUM(amount)::numeric AS amt
      FROM payment_transaction
     WHERE merchant_id = ANY($1::bigint[])
       AND payment_date >= $2::timestamp AND payment_date < $3::timestamp
     GROUP BY 1,2
  ),
  tr AS (
    SELECT merchant_id,
           to_char(date_trunc('month', transfer_date), 'YYYY-MM') AS ym,
           COALESCE(type,'(null)') AS type,
           COUNT(*)::bigint AS cnt,
           SUM(amount)::numeric AS amt
      FROM transfer_transaction
     WHERE merchant_id = ANY($1::bigint[])
       AND transfer_date >= $2::timestamp AND transfer_date < $3::timestamp
     GROUP BY 1,2,3
  )
  SELECT * FROM pay UNION ALL SELECT * FROM tr
  `,
  [ids, FROM, TO],
);
console.log(`agg query: ${((Date.now()-start)/1000).toFixed(1)}s, ${rows.length} rows`);

const nameOf = new Map(mrows.map((m) => [String(m.id), m.merchant_name_en]));
const noOf = new Map(mrows.map((m) => [String(m.id), m.merchant_no]));

// Grand total by type
const byType = {};
let grandCnt = 0;
for (const r of rows) {
  byType[r.type] ??= { cnt: 0, amt: 0 };
  byType[r.type].cnt += Number(r.cnt);
  byType[r.type].amt += Number(r.amt);
  grandCnt += Number(r.cnt);
}
console.log(`\n=== Grand total by type (Apr-Jun 2026, ${mrows.length} merchant${mrows.length === 1 ? "" : "s"}) ===`);
console.table(Object.fromEntries(Object.entries(byType).map(([k,v]) => [k, { count: v.cnt, amount: v.amt.toFixed(2) }])));
console.log("TOTAL detail rows:", grandCnt);

// Per merchant total (to plan file structure)
const perM = new Map();
for (const r of rows) {
  const key = String(r.merchant_id);
  perM.set(key, (perM.get(key) ?? 0) + Number(r.cnt));
}
console.log("\n=== Per-merchant total detail rows ===");
const perMtable = [...perM.entries()]
  .map(([id, cnt]) => ({ merchant_no: noOf.get(id), name: nameOf.get(id), rows: cnt }))
  .sort((a,b) => b.rows - a.rows);
console.table(perMtable);
console.log("Max single-merchant rows:", Math.max(...perMtable.map(r=>r.rows)));

await pool.end();
