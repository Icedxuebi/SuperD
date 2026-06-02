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
});

async function run(label, sql, params = []) {
  console.log(`\n=== ${label} ===`);
  try {
    const start = Date.now();
    const { rows } = await pool.query(sql, params);
    console.log(`(${((Date.now() - start) / 1000).toFixed(1)}s, ${rows.length} rows)`);
    console.table(rows);
  } catch (err) {
    console.log(`(error: ${err.message})`);
  }
}

for (const table of ["merchant_kym_period", "merchant_personal_kyc_period", "merchant_personal_cdd_period"]) {
  await run(
    `${table} — columns`,
    `
      SELECT column_name, data_type
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position
    `,
    [table],
  );
}

// Distinct state on merchant_info
await run(
  `merchant_info.state distinct values`,
  `
    SELECT COALESCE(state::text, '(null)') AS state, COUNT(*)::int AS rows
      FROM merchant_info
     GROUP BY state
     ORDER BY rows DESC
  `,
);

// State of KYM source table (the master record, period table just is the recurrence)
await run(
  `merchant_kym.state distinct values (if column exists)`,
  `
    SELECT COALESCE(state::text, '(null)') AS state, COUNT(*)::int AS rows
      FROM merchant_kym
     GROUP BY state
     ORDER BY rows DESC
  `,
);

await run(
  `merchant_personal_kyc.state distinct values (if column exists)`,
  `
    SELECT COALESCE(state::text, '(null)') AS state, COUNT(*)::int AS rows
      FROM merchant_personal_kyc
     GROUP BY state
     ORDER BY rows DESC
  `,
);

// Maybe the period tables have differently-named status columns. Show columns
// containing 'status' or 'state' for all three.
await run(
  `state/status-like columns in period tables`,
  `
    SELECT table_name, column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('merchant_kym_period', 'merchant_personal_kyc_period', 'merchant_personal_cdd_period')
       AND (column_name ILIKE '%state%' OR column_name ILIKE '%status%')
     ORDER BY table_name, ordinal_position
  `,
);

await pool.end();
