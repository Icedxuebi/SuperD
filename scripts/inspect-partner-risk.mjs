import pg from "pg";

const { Pool, types } = pg;
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

const url = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: url,
  ssl: /[?&]ssl(mode)?=/i.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 2,
});

async function run(label, sql) {
  console.log(`\n=== ${label} ===`);
  try {
    const start = Date.now();
    const { rows } = await pool.query(sql);
    console.log(`(${((Date.now() - start) / 1000).toFixed(1)}s, ${rows.length} rows)`);
    console.table(rows);
  } catch (err) {
    console.log(`(error: ${err.message})`);
  }
}

await run(
  "partner_info — columns",
  `
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'partner_info'
     ORDER BY ordinal_position
  `,
);

await run(
  "merchant_info risk-ish columns",
  `
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'merchant_info'
       AND (column_name ILIKE '%risk%' OR column_name ILIKE '%state%' OR column_name ILIKE '%status%' OR column_name ILIKE '%close%' OR column_name ILIKE '%enable%')
     ORDER BY ordinal_position
  `,
);

await run(
  "partner_info row count + any state/risk distinct counts",
  `
    SELECT COUNT(*) AS rows,
           COUNT(DISTINCT partner_no) AS distinct_partner_no
      FROM partner_info
  `,
);

// Try common risk/state columns on partner_info — silently skip if absent.
for (const col of ["state", "status", "risk", "risk_level", "risk_type", "enabled", "close_date"]) {
  await run(
    `partner_info.${col} distinct (if exists)`,
    `
      SELECT COALESCE(${col}::text, '(null)') AS v, COUNT(*)::int AS rows
        FROM partner_info
       GROUP BY ${col}
       ORDER BY rows DESC
    `,
  );
}

// And on merchant_info — check for the risk column specifically.
for (const col of ["risk", "risk_level", "risk_type"]) {
  await run(
    `merchant_info.${col} distinct (if exists)`,
    `
      SELECT COALESCE(${col}::text, '(null)') AS v, COUNT(*)::int AS rows
        FROM merchant_info
       GROUP BY ${col}
       ORDER BY rows DESC
    `,
  );
}

await pool.end();
