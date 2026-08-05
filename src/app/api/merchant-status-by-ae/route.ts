import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Active / Inactive / Close are three independent buckets over APPROVED
// merchants, keyed on the merchant flag (merchant_info.enabled) and whether the
// merchant has an enabled users row ("user enabled"). Same rule as
// /api/merchants (merchant lookup):
//   Active   → state = 'APPROVE' AND user enabled     AND merchant enabled.
//   Inactive → state = 'APPROVE' AND user enabled     AND merchant NOT enabled.
//   Close    → state = 'APPROVE' AND user NOT enabled AND merchant NOT enabled.
// close_date is not consulted. A merchant that fits none of the three is dropped
// from the page entirely — the onboarding pipeline (BUSINESS_APPROVE,
// PRE_APPROVE_*, REGISTER, REJECT, *_SANDBOX, NULL state) plus the leftover
// approved combo (user NOT enabled AND merchant enabled), which the rule leaves
// undefined. (/api/partner-merchant-risk keeps that leftover as an "Other"
// bucket instead; this page drops it, matching how it already drops pipeline.)
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
         AND COALESCE(bool_or(u.enabled), FALSE)
         AND mi.enabled IS TRUE)                            AS is_active,
        (mi.state = 'APPROVE'
         AND COALESCE(bool_or(u.enabled), FALSE)
         AND mi.enabled IS FALSE)                           AS is_inactive,
        (mi.state = 'APPROVE'
         AND NOT COALESCE(bool_or(u.enabled), FALSE)
         AND mi.enabled IS FALSE)                           AS is_close
    FROM merchant_info mi
    LEFT JOIN users u ON u.merchant_id = mi.id
    GROUP BY mi.id, mi.partner_id, mi.state, mi.enabled
)
SELECT
    pi.partner_no                                       AS partner_no,
    COUNT(*) FILTER (WHERE pm.is_active)::int           AS active,
    COUNT(*) FILTER (WHERE pm.is_inactive)::int         AS inactive,
    COUNT(*) FILTER (WHERE pm.is_close)::int            AS close
FROM per_merchant pm
LEFT JOIN partner_info pi ON pi.id = pm.partner_id
WHERE pm.is_active OR pm.is_inactive OR pm.is_close  -- only approved merchants in a bucket; drop pipeline / rejected / sandbox / undefined combo
GROUP BY pi.partner_no
ORDER BY active DESC, inactive DESC, close DESC, partner_no ASC NULLS LAST;
`;

type RawRow = {
  partner_no: string | null;
  active: number;
  inactive: number;
  close: number;
};

export async function GET() {
  try {
    const pool = getPool();
    const result = await pool.query<RawRow>(SQL);

    // Roll up every row (including the no-partner bucket) into totals…
    const totals = result.rows.reduce(
      (acc, r) => {
        acc.active += r.active;
        acc.inactive += r.inactive;
        acc.close += r.close;
        return acc;
      },
      { active: 0, inactive: 0, close: 0 },
    );

    const partners = result.rows
      .filter((r) => r.partner_no !== null)
      .map((r) => ({
        partner_no: r.partner_no as string,
        active: r.active,
        inactive: r.inactive,
        close: r.close,
        total: r.active + r.inactive + r.close,
      }));

    return NextResponse.json({
      partners,
      totals: {
        ...totals,
        total: totals.active + totals.inactive + totals.close,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/merchant-status-by-ae]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
