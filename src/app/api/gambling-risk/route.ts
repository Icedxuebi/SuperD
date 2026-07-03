import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gambling-risk triage. Merchants are flagged when any of their outbound
// payouts (transfer_transaction) carry a destination account_holder_name that
// reads like a gambling-site handle — "VIP", "เครดิต" (credit), "โบนัส" (bonus).
// These patterns are fixed (no user input reaches the query), but we still bind
// them as parameters per the parameterized-SQL convention.
//
// Note: this is a full scan of transfer_transaction (~12.8M rows, no usable
// index for a leading-wildcard ILIKE) so the request takes ~30s. We roll the
// matches up to one row per merchant and let the client compute KPIs / scope
// filtering, so the scan runs only once per page load.
const PATTERNS = ["%VIP%", "%เครดิต%", "%โบนัส%"];

// Guard so a runaway scan can't hold a pool connection open indefinitely.
const STATEMENT_TIMEOUT_MS = 180_000;

const SQL = `
  WITH flagged AS (
    SELECT
        tt.merchant_id,
        tt.account_holder_name,
        tt.amount,
        tt.transfer_date
    FROM transfer_transaction tt
    WHERE tt.account_holder_name ILIKE $1
       OR tt.account_holder_name ILIKE $2
       OR tt.account_holder_name ILIKE $3
  ),
  agg AS (
    SELECT
        merchant_id,
        COUNT(*)                              AS hit_count,
        SUM(amount)                           AS total_amount,
        MAX(transfer_date)                    AS last_transfer_date,
        (ARRAY_AGG(DISTINCT account_holder_name ORDER BY account_holder_name))[1:8]
                                              AS sample_names
    FROM flagged
    GROUP BY merchant_id
  )
  SELECT
      a.merchant_id::text                     AS merchant_id,
      a.hit_count::int                        AS hit_count,
      a.total_amount::float8                  AS total_amount,
      a.last_transfer_date::text              AS last_transfer_date,
      a.sample_names,
      mi.merchant_no,
      mi.merchant_name_en,
      mi.merchant_name_th,
      mi.company_name_en,
      mi.company_name_th,
      mi.state                                AS merchant_state,
      mi.enabled                              AS merchant_enabled,
      mi.close_date::text                     AS merchant_close_date,
      pi.partner_no
  FROM agg a
  LEFT JOIN merchant_info mi ON mi.id = a.merchant_id
  LEFT JOIN partner_info  pi ON pi.id = mi.partner_id
  ORDER BY (mi.state = 'APPROVE' AND mi.close_date IS NULL) DESC NULLS LAST,
           a.hit_count DESC;
`;

export async function GET() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const result = await client.query(SQL, PATTERNS);
    return NextResponse.json({
      patterns: PATTERNS,
      rows: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/gambling-risk]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // Reset the per-connection timeout before returning the client to the pool.
    await client.query("SET statement_timeout = DEFAULT").catch(() => {});
    client.release();
  }
}
