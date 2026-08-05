import pg from "pg";
const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);
const url = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 1, statement_timeout: 300_000,
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

const FROM = "2026-04-01 00:00:00", TO = "2026-07-01 00:00:00";

const { rows: mm } = await pool.query(
  `SELECT id, merchant_no, merchant_name_en FROM merchant_info WHERE merchant_no = ANY($1::text[])`, [MIDS]);
const ids = mm.map(m=>m.id);
const nameOf = new Map(mm.map(m=>[String(m.id), m.merchant_name_en]));
const noOf = new Map(mm.map(m=>[String(m.id), m.merchant_no]));

async function q(label, sql, p=[]) {
  console.log(`\n=== ${label} ===`);
  const { rows } = await pool.query(sql, p);
  console.table(rows);
  return rows;
}

// fee / cal_rate / destination_type / payment_type profile per type
await q("type profile: fee, rate, destination_type, payment_type",
  `SELECT type,
          COUNT(*)::bigint AS rows,
          MIN(amount)::numeric AS min_amt, MAX(amount)::numeric AS max_amt,
          ROUND(AVG(amount)::numeric,2) AS avg_amt,
          ROUND(AVG(fee)::numeric,4) AS avg_fee,
          ROUND(AVG(cal_rate)::numeric,4) AS avg_rate,
          COUNT(DISTINCT destination_type) AS n_dest_types,
          COUNT(DISTINCT payment_type) AS n_pay_types,
          COUNT(DISTINCT fee_type) AS n_fee_types
     FROM transfer_transaction
    WHERE merchant_id = ANY($1::bigint[]) AND transfer_date >= $2 AND transfer_date < $3
    GROUP BY type ORDER BY rows DESC`, [ids, FROM, TO]);

await q("fee_type by type",
  `SELECT type, COALESCE(fee_type,'(null)') fee_type, COUNT(*)::bigint rows
     FROM transfer_transaction
    WHERE merchant_id = ANY($1::bigint[]) AND transfer_date >= $2 AND transfer_date < $3
    GROUP BY 1,2 ORDER BY 1, rows DESC`, [ids, FROM, TO]);

// Do Transfer destinations differ from that merchant's Withdraw destinations?
// For each merchant with Transfers, count how many Transfer destination accounts
// also appear as a Withdraw destination for the same merchant.
await q("Transfer destination accounts: self (also a withdraw acct) vs external",
  `WITH wd AS (
     SELECT DISTINCT merchant_id, account_no
       FROM transfer_transaction
      WHERE merchant_id = ANY($1::bigint[]) AND transfer_date >= $2 AND transfer_date < $3
        AND type='Withdraw' AND account_no IS NOT NULL AND account_no <> ''
   ),
   tr AS (
     SELECT merchant_id, account_no, account_holder_name, bank_code, amount
       FROM transfer_transaction
      WHERE merchant_id = ANY($1::bigint[]) AND transfer_date >= $2 AND transfer_date < $3
        AND type='Transfer'
   )
   SELECT
     CASE WHEN wd.account_no IS NOT NULL THEN 'same as a withdraw acct' ELSE 'external/other' END AS destination,
     COUNT(*)::bigint AS transfer_rows,
     ROUND(SUM(tr.amount)::numeric,2) AS total_amt
   FROM tr LEFT JOIN wd ON wd.merchant_id = tr.merchant_id AND wd.account_no = tr.account_no
   GROUP BY 1 ORDER BY transfer_rows DESC`, [ids, FROM, TO]);

// sample Transfer rows
const sample = await pool.query(
  `SELECT merchant_id, account_no, account_holder_name, bank_code, amount, destination_type, payment_type, status,
          left(COALESCE(condition,''),40) AS condition, left(COALESCE(merchant_reference_no,''),24) AS ref
     FROM transfer_transaction
    WHERE merchant_id = ANY($1::bigint[]) AND transfer_date >= $2 AND transfer_date < $3 AND type='Transfer'
    ORDER BY amount DESC LIMIT 15`, [ids, FROM, TO]);
console.log("\n=== sample Transfer rows (top 15 by amount) ===");
console.table(sample.rows.map(r => ({
  merchant: noOf.get(String(r.merchant_id)),
  m_name: nameOf.get(String(r.merchant_id)),
  acct: r.account_no, holder: r.account_holder_name, bank: r.bank_code,
  amount: r.amount, dest: r.destination_type, ptype: r.payment_type, status: r.status,
  cond: r.condition, ref: r.ref,
})));

await pool.end();
