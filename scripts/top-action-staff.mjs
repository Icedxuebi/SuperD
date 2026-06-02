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
  const start = Date.now();
  const { rows } = await pool.query(sql);
  console.log(`(${((Date.now() - start) / 1000).toFixed(1)}s)`);
  console.table(rows);
}

await run(
  "Top non-system create_by (last 365 days)",
  `
    SELECT create_by AS actor, COUNT(*)::bigint AS actions,
           MIN(action_date)::text AS first_seen,
           MAX(action_date)::text AS last_seen
      FROM action_log
     WHERE action_date >= (now() AT TIME ZONE 'Asia/Bangkok') - interval '365 days'
       AND create_by NOT IN ('gateway', 'system')
     GROUP BY create_by
     ORDER BY actions DESC
     LIMIT 30
  `,
);

await run(
  "Distinct api_path counts when create_by is not gateway/system (1y)",
  `
    SELECT api_path, COUNT(*)::bigint AS actions
      FROM action_log
     WHERE action_date >= (now() AT TIME ZONE 'Asia/Bangkok') - interval '365 days'
       AND create_by NOT IN ('gateway', 'system')
     GROUP BY api_path
     ORDER BY actions DESC
     LIMIT 15
  `,
);

await pool.end();
