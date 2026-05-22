import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Active / inactive is derived from `merchant_info.enabled`, excluding
// closed merchants entirely (close_date IS NOT NULL means the store is closed).
// `enabled = TRUE`  AND close_date IS NULL → Active
// `enabled = FALSE` AND close_date IS NULL → Inactive
//
// We LEFT JOIN partner_info so merchants without an AE still come back —
// the route splits them out: their counts roll into the donut/KPI totals,
// but they're not surfaced in the per-partner bar chart or breakdown table.
const SQL = `
SELECT
    pi.partner_no                                       AS partner_no,
    COUNT(*) FILTER (WHERE mi.enabled IS TRUE)::int     AS active,
    COUNT(*) FILTER (WHERE mi.enabled IS FALSE)::int    AS inactive
FROM merchant_info mi
LEFT JOIN partner_info pi ON pi.id = mi.partner_id
WHERE mi.enabled IS NOT NULL
  AND mi.close_date IS NULL
GROUP BY pi.partner_no
HAVING COUNT(*) FILTER (WHERE mi.enabled IS TRUE) > 0
    OR COUNT(*) FILTER (WHERE mi.enabled IS FALSE) > 0
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

    // …but only expose rows with a real partner_no to the chart + table.
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
