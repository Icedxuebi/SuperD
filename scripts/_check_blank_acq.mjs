import pg from "pg";
const { Pool } = pg;
const url = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 1,
  statement_timeout: 120_000,
});

const { rows } = await pool.query(`
  select
    status,
    payment_type,
    count(*) filter (where acq_transaction_id = '') as blank_acq,
    count(*) filter (where acq_transaction_id is null) as null_acq,
    count(*) as total
  from payment_transaction
  where date_trunc('day', payment_date) between '2026-03-01' and '2026-03-02'
  group by status, payment_type
  order by blank_acq desc
`);
console.table(rows);

const { rows: totals } = await pool.query(`
  select
    count(*) filter (where acq_transaction_id = '') as blank_acq_total,
    count(*) filter (where acq_transaction_id is null) as null_acq_total,
    count(*) as total_rows
  from payment_transaction
  where date_trunc('day', payment_date) between '2026-03-01' and '2026-03-02'
`);
console.log("=== overall totals ===");
console.table(totals);

await pool.end();
