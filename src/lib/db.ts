import { Pool, types } from "pg";

// Return the raw Postgres text for both `date` (OID 1082) and
// `timestamp without time zone` (OID 1114) instead of JS Date objects.
// pg's default parsers treat naive values as UTC, which shifts them −7h
// for our Bangkok-local data and breaks dates/times in the UI and Excel.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export function getPool(): Pool {
  if (global.__pgPool) return global.__pgPool;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the Postgres connection string.",
    );
  }

  const needsSsl = /[?&]ssl(mode)?=/i.test(url);
  const pool = new Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  global.__pgPool = pool;
  return pool;
}
