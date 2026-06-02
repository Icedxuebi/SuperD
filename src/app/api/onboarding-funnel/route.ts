import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Onboarding pipeline view of merchant_info.state.
// FSM order (inferred from docs/dbinfo.md):
//   REGISTER → PRE_APPROVE_DOCUMENT → PRE_APPROVE_OPERATION → PRE_APPROVE_SUPERVISOR
//          → PRE_BUSINESS_APPROVE → BUSINESS_APPROVE → APPROVE
//                                                   ↘ REJECT (terminal, from any stage)
// NULL state means incomplete registration.
//
// "In pipeline" excludes APPROVE and REJECT — those are terminal.
// Aging is computed against register_date because that's the timestamp the
// merchant entered the funnel. register_date is stored as Bangkok wall-clock
// (see lib/db.ts OID overrides), so AGE(now() at TH, register_date) is safe.
const SQL = `
SELECT
    COALESCE(state, '(none)')                                      AS state,
    COUNT(*)::int                                                  AS count,
    COUNT(*) FILTER (
      WHERE register_date IS NULL
    )::int                                                         AS no_register_date,
    COUNT(*) FILTER (
      WHERE register_date IS NOT NULL
        AND (now() AT TIME ZONE 'Asia/Bangkok')::date - register_date::date <= 7
    )::int                                                         AS age_0_7,
    COUNT(*) FILTER (
      WHERE register_date IS NOT NULL
        AND (now() AT TIME ZONE 'Asia/Bangkok')::date - register_date::date BETWEEN 8 AND 30
    )::int                                                         AS age_8_30,
    COUNT(*) FILTER (
      WHERE register_date IS NOT NULL
        AND (now() AT TIME ZONE 'Asia/Bangkok')::date - register_date::date BETWEEN 31 AND 90
    )::int                                                         AS age_31_90,
    COUNT(*) FILTER (
      WHERE register_date IS NOT NULL
        AND (now() AT TIME ZONE 'Asia/Bangkok')::date - register_date::date > 90
    )::int                                                         AS age_90_plus,
    MIN(register_date)::text                                       AS oldest_register_date,
    MAX(register_date)::text                                       AS newest_register_date
FROM merchant_info
GROUP BY COALESCE(state, '(none)')
ORDER BY count DESC;
`;

// Per-merchant detail for stuck merchants — anyone in a non-terminal state
// whose register_date is older than the threshold. Used to drill in on the
// "stuck" cohort. Default threshold = 30 days.
//
// Pre-approval merchants typically don't have a merchant_no or company_name
// yet (those get filled in after onboarding completes). We also return the
// internal id and the merchant/brand name so the page can fall back to
// "#<id>" + brand name when the public identifiers are missing — otherwise
// half the rows render as blanks.
const STUCK_SQL = `
SELECT
    mi.id::text                                                    AS merchant_id,
    mi.merchant_no,
    mi.company_name_en,
    mi.company_name_th,
    mi.merchant_name_en,
    mi.merchant_name_th,
    mi.person_type,
    COALESCE(mi.state, '(none)')                                   AS state,
    pi.partner_no,
    mi.register_date::text                                         AS register_date,
    ((now() AT TIME ZONE 'Asia/Bangkok')::date - mi.register_date::date)::int AS age_days
FROM merchant_info mi
LEFT JOIN partner_info pi ON pi.id = mi.partner_id
WHERE mi.state IS DISTINCT FROM 'APPROVE'
  AND mi.state IS DISTINCT FROM 'REJECT'
  AND mi.register_date IS NOT NULL
  AND (now() AT TIME ZONE 'Asia/Bangkok')::date - mi.register_date::date >= $1
ORDER BY age_days DESC, mi.id ASC
LIMIT 500;
`;

type StateRow = {
  state: string;
  count: number;
  no_register_date: number;
  age_0_7: number;
  age_8_30: number;
  age_31_90: number;
  age_90_plus: number;
  oldest_register_date: string | null;
  newest_register_date: string | null;
};

type StuckRow = {
  merchant_id: string;
  merchant_no: string | null;
  company_name_en: string | null;
  company_name_th: string | null;
  merchant_name_en: string | null;
  merchant_name_th: string | null;
  person_type: string | null;
  state: string;
  partner_no: string | null;
  register_date: string | null;
  age_days: number;
};

// Order states left-to-right as a funnel. Anything we don't know about
// (e.g. a future state) gets appended after the known ones but before
// the terminal states.
const FUNNEL_ORDER = [
  "REGISTER",
  "PRE_APPROVE_DOCUMENT",
  "PRE_APPROVE_OPERATION",
  "PRE_APPROVE_SUPERVISOR",
  "PRE_BUSINESS_APPROVE",
  "BUSINESS_APPROVE",
  "APPROVE",
  "REJECT",
  "(none)",
];

function stateRank(s: string): number {
  const i = FUNNEL_ORDER.indexOf(s);
  return i === -1 ? FUNNEL_ORDER.length - 2 : i;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const stuckDays = Math.max(1, Number(url.searchParams.get("stuckDays") ?? "30"));

    const pool = getPool();
    const [stateRes, stuckRes] = await Promise.all([
      pool.query<StateRow>(SQL),
      pool.query<StuckRow>(STUCK_SQL, [stuckDays]),
    ]);

    const states = stateRes.rows
      .map((r) => ({ ...r, rank: stateRank(r.state) }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ rank: _rank, ...rest }) => rest);

    const totals = stateRes.rows.reduce(
      (acc, r) => {
        acc.all += r.count;
        if (r.state !== "APPROVE" && r.state !== "REJECT") {
          acc.inPipeline += r.count;
          acc.stuck30 += r.age_31_90 + r.age_90_plus;
          acc.stuck90 += r.age_90_plus;
        }
        if (r.state === "APPROVE") acc.approved = r.count;
        if (r.state === "REJECT") acc.rejected = r.count;
        return acc;
      },
      { all: 0, inPipeline: 0, approved: 0, rejected: 0, stuck30: 0, stuck90: 0 },
    );

    return NextResponse.json({
      states,
      totals,
      stuckDays,
      stuck: stuckRes.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/onboarding-funnel]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
