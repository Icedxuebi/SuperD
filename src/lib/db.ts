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
  // eslint-disable-next-line no-var
  var __ticketPool: Pool | undefined;
}

// SSL is opt-in per connection string: the main DB is AWS RDS and carries
// `?sslmode=no-verify`, while the ticket DB host does not support SSL at all
// and must connect plaintext. Keying off the URL keeps both honest.
function createPool(url: string): Pool {
  const needsSsl = /[?&]ssl(mode)?=/i.test(url);
  return new Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function getPool(): Pool {
  if (global.__pgPool) return global.__pgPool;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the Postgres connection string.",
    );
  }

  global.__pgPool = createPool(url);
  return global.__pgPool;
}

// The support-ticket system lives on a separate Postgres instance (database
// `anypay_ticket`) with no FK link to the main DB — see docs/ticketdb.md.
// Merchant enrichment for a ticket therefore needs a second query against
// getPool(), joined in application code.
export function getTicketPool(): Pool {
  if (global.__ticketPool) return global.__ticketPool;

  const url = process.env.TICKETDB_URL;
  if (!url) {
    throw new Error(
      "TICKETDB_URL is not set. Copy .env.example to .env.local and fill in the ticket-DB connection string.",
    );
  }

  global.__ticketPool = createPool(url);
  return global.__ticketPool;
}
