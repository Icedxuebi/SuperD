import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Population = every merchant that is NOT permanently closed. A set close_date
// means the store is perma-closed → excluded from the page entirely. Within the
// remaining (open) population:
//   Active   → fully live: state = 'APPROVE' AND merchant_info.enabled = TRUE
//              AND their users row is enabled.
//   Inactive → every other open merchant — i.e. anything still in the onboarding
//              pipeline and not yet live (BUSINESS_APPROVE, PRE_APPROVE_OPERATION,
//              REGISTER, REJECT, *_SANDBOX, …), plus any approved-but-disabled
//              merchant that hasn't been closed. It is the complement of Active
//              within the open population, so active + inactive = total.
// Each merchant has one users row (users.merchant_id → merchant_info.id), but
// bool_or keeps the query correct if that ever stops holding.
//
// We LEFT JOIN partner_info so merchants without an AE still come back —
// the route splits them out: their counts roll into the donut/KPI totals,
// but they're not surfaced in the per-partner bar chart or breakdown table.
const SQL = `
WITH per_merchant AS (
    SELECT
        mi.id,
        mi.partner_id,
        (mi.state = 'APPROVE'
         AND mi.enabled IS TRUE
         AND COALESCE(bool_or(u.enabled), FALSE)) AS is_active
    FROM merchant_info mi
    LEFT JOIN users u ON u.merchant_id = mi.id
    WHERE mi.close_date IS NULL   -- drop permanently-closed merchants
    GROUP BY mi.id, mi.partner_id, mi.state, mi.enabled
)
SELECT
    pi.partner_no                                       AS partner_no,
    COUNT(*) FILTER (WHERE pm.is_active)::int           AS active,
    COUNT(*) FILTER (WHERE NOT pm.is_active)::int       AS inactive
FROM per_merchant pm
LEFT JOIN partner_info pi ON pi.id = pm.partner_id
GROUP BY pi.partner_no
ORDER BY active DESC, inactive DESC, partner_no ASC NULLS LAST;
`;

type RawRow = { partner_no: string | null; active: number; inactive: number };

export async function GET() {
  try {
    const pool = getPool();
    const result = await pool.query<RawRow>(SQL);

    // Roll up every row (including the no-partner bucket) into totals…
    const totals = result.rows.reduce(
      (acc, r) => {
        acc.active += r.active;
        acc.inactive += r.inactive;
        return acc;
      },
      { active: 0, inactive: 0 },
    );

    const partners = result.rows
      .filter((r) => r.partner_no !== null)
      .map((r) => ({
        partner_no: r.partner_no as string,
        active: r.active,
        inactive: r.inactive,
        total: r.active + r.inactive,
      }));

    return NextResponse.json({
      partners,
      totals: { ...totals, total: totals.active + totals.inactive },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/merchant-status-by-ae]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
