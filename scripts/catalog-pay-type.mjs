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

async function run(label, sql) {
  console.log(`\n=== ${label} ===`);
  const start = Date.now();
  const { rows } = await pool.query(sql);
  console.log(`(${((Date.now() - start) / 1000).toFixed(1)}s, ${rows.length} rows)`);
  console.table(rows);
}

await run(
  "payment_transaction.pay_type distinct values",
  `
    SELECT COALESCE(pay_type, '(null)') AS pay_type,
           COUNT(*)::bigint              AS rows
      FROM payment_transaction
     GROUP BY pay_type
     ORDER BY rows DESC
  `,
);

await run(
  "payment_transaction (pay_type, payment_type) cross-tab",
  `
    SELECT COALESCE(pay_type, '(null)')     AS pay_type,
           COALESCE(payment_type, '(null)') AS payment_type,
           COUNT(*)::bigint                  AS rows
      FROM payment_transaction
     GROUP BY pay_type, payment_type
     ORDER BY rows DESC
  `,
);

await pool.end();
