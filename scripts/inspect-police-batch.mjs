import pg from "pg";

const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run with --env-file=.env.local");
  process.exit(1);
}

const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 2,
  statement_timeout: 600_000,
});

const MIDS = [
  "M260113053019","M250521013903","M250821124353","M251114052726","M240429045335",
  "M250513021229","M250516062827","M251014053031","M260623143402","M250724051256",
  "M260106024109","M251105044528","M250528011850","M250916093724","M251017103053",
  "M250608054722","M251022111751","M250911054329","M250530044731","M250520043535",
  "M250911054230","M251107112114",
];

const FROM = "2026-04-01 00:00:00";
const TO   = "2026-07-01 00:00:00"; // exclusive upper bound (Apr,May,Jun 2026)

async function run(label, sql, params = []) {
  console.log(`\n=== ${label} ===`);
  const start = Date.now();
  const { rows } = await pool.query(sql, params);
  console.log(`(${((Date.now() - start) / 1000).toFixed(1)}s, ${rows.length} rows)`);
  console.table(rows);
  return rows;
}

// 1. Resolve merchant list -> internal id
const merchants = await run(
  "merchant resolution",
  `SELECT id, merchant_no, merchant_name_en
     FROM merchant_info
    WHERE merchant_no = ANY($1::text[])
    ORDER BY merchant_no`,
  [MIDS],
);
const foundNos = new Set(merchants.map((m) => m.merchant_no));
const missing = MIDS.filter((m) => !foundNos.has(m));
console.log("\nMissing MIDs (not in merchant_info):", missing.length ? missing.join(", ") : "(none)");

const ids = merchants.map((m) => m.id);

// 2. transfer_transaction classification columns
await run(
  "transfer_transaction (type, destination_type, payment_type) cross-tab [merchants, Apr-Jun 2026]",
  `SELECT COALESCE(type,'(null)')             AS type,
          COALESCE(destination_type,'(null)') AS destination_type,
          COALESCE(payment_type,'(null)')     AS payment_type,
          COUNT(*)::bigint                     AS rows,
          SUM(amount)::numeric                 AS total_amount
     FROM transfer_transaction
    WHERE merchant_id = ANY($1::bigint[])
      AND transfer_date >= $2::timestamp AND transfer_date < $3::timestamp
    GROUP BY 1,2,3
    ORDER BY rows DESC`,
  [ids, FROM, TO],
);

// 3. transfer_transaction status
await run(
  "transfer_transaction status [merchants, Apr-Jun 2026]",
  `SELECT COALESCE(status,'(null)') AS status,
          COUNT(*)::bigint          AS rows,
          SUM(amount)::numeric      AS total_amount
     FROM transfer_transaction
    WHERE merchant_id = ANY($1::bigint[])
      AND transfer_date >= $2::timestamp AND transfer_date < $3::timestamp
    GROUP BY 1 ORDER BY rows DESC`,
  [ids, FROM, TO],
);

// 4. payment_transaction status
await run(
  "payment_transaction status [merchants, Apr-Jun 2026]",
  `SELECT COALESCE(status,'(null)') AS status,
          COUNT(*)::bigint          AS rows,
          SUM(amount)::numeric      AS total_amount
     FROM payment_transaction
    WHERE merchant_id = ANY($1::bigint[])
      AND payment_date >= $2::timestamp AND payment_date < $3::timestamp
    GROUP BY 1 ORDER BY rows DESC`,
  [ids, FROM, TO],
);

await pool.end();
