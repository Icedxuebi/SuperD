import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Onboarding pipeline view of merchant_info.state.
//
// FSM order (top → bottom, confirmed against the platform "All States" list):
//   REGISTER                       — applicant entered info (create_date)
//   PRE_BUSINESS_APPROVE           — waiting for ops to action
//   BUSINESS_APPROVE               — waiting for merchant to upload more docs
//   PRE_APPROVE_OPERATION          — KYC / KYM by ops
//   PRE_APPROVE_OPERATION_MANAGER  — ops manager sign-off
//   PRE_APPROVE_RISK               — risk team determines risk level
//   PRE_APPROVE_RISK_MANAGER       — risk manager sign-off
//   PRE_APPROVE_SUPERVISOR         — COO sign-off       (supervisor_approve_date)
//   PRE_APPROVE_MANAGER            — CEO sign-off       (manager_approve_date)
//                                    only required when risk = 'H'
//   PRE_APPROVE_DOCUMENT           — waiting for contract
//   WAITING_SANDBOX                — waiting for merchant sandbox testing
//   COMPLETE_SANDBOX               — sandbox done, ready to go live
//   APPROVE                        — live; terminal
//   REJECT                         — terminal alt path
//
// WAITING_SANDBOX caveat:
//   merchant_info often doesn't reflect every merchant still sitting in
//   sandbox — `mi.state` can lag, or the merchant can exist only in
//   merchant_process_history. So we treat mph as authoritative for sandbox:
//   any merchant with a mph row of state = 'WAITING_SANDBOX' and
//   create_date IS NOT NULL whose mi.state has not progressed past
//   sandbox (APPROVE / COMPLETE_SANDBOX) gets bucketed as WAITING_SANDBOX,
//   overriding whatever mi.state says. Orphans (no mi row at all) are
//   included too. No merchant is double-counted: when we promote one to
//   WAITING_SANDBOX, we drop it from its mi.state bucket.
//
// NULL state rows are excluded — incomplete registrations that never entered
// the funnel and would distort the view.
//
// "In pipeline" excludes APPROVE and REJECT.
// Aging is computed against create_date — the very first timestamp on the
// merchant row, set before the REGISTER form is finished. register_date can
// be significantly later and is NULL for very-early funnel rows.
const SQL = `
WITH mph_waiting AS (
  SELECT
      mph.merchant_id,
      MIN(mph.create_date) AS ws_create_date
  FROM merchant_process_history mph
  WHERE mph.state = 'WAITING_SANDBOX'
    AND mph.create_date IS NOT NULL
  GROUP BY mph.merchant_id
),
combined AS (
  SELECT
    CASE
      WHEN w.merchant_id IS NOT NULL
        AND mi.state NOT IN ('APPROVE', 'COMPLETE_SANDBOX')
      THEN 'WAITING_SANDBOX'
      ELSE mi.state
    END                                                            AS state,
    mi.create_date
  FROM merchant_info mi
  LEFT JOIN mph_waiting w ON w.merchant_id = mi.id
  WHERE mi.state IS NOT NULL
  UNION ALL
  SELECT 'WAITING_SANDBOX' AS state, w.ws_create_date AS create_date
  FROM mph_waiting w
  WHERE NOT EXISTS (
    SELECT 1 FROM merchant_info mi WHERE mi.id = w.merchant_id
  )
)
SELECT
    state                                                          AS state,
    COUNT(*)::int                                                  AS count,
    COUNT(*) FILTER (
      WHERE create_date IS NULL
    )::int                                                         AS no_create_date,
    COUNT(*) FILTER (
      WHERE create_date IS NOT NULL
        AND (now() AT TIME ZONE 'Asia/Bangkok')::date - create_date::date <= 7
    )::int                                                         AS age_0_7,
    COUNT(*) FILTER (
      WHERE create_date IS NOT NULL
        AND (now() AT TIME ZONE 'Asia/Bangkok')::date - create_date::date BETWEEN 8 AND 30
    )::int                                                         AS age_8_30,
    COUNT(*) FILTER (
      WHERE create_date IS NOT NULL
        AND (now() AT TIME ZONE 'Asia/Bangkok')::date - create_date::date BETWEEN 31 AND 90
    )::int                                                         AS age_31_90,
    COUNT(*) FILTER (
      WHERE create_date IS NOT NULL
        AND (now() AT TIME ZONE 'Asia/Bangkok')::date - create_date::date > 90
    )::int                                                         AS age_90_plus,
    MIN(create_date)::text                                         AS oldest_create_date,
    MAX(create_date)::text                                         AS newest_create_date
FROM combined
GROUP BY state
ORDER BY count DESC;
`;

// Per-merchant detail for stuck merchants — anyone in a non-terminal state
// is considered stuck, regardless of age. Once a merchant lands on the
// platform and isn't yet APPROVE/REJECT, they're blocking somewhere in the
// funnel.
//
// Pre-approval merchants typically don't have a merchant_no or company_name
// yet (those get filled in after onboarding completes). We also return the
// internal id and the merchant/brand name so the page can fall back to
// "#<id>" + brand name when the public identifiers are missing — otherwise
// half the rows render as blanks.
//
// Two age numbers:
//   age_days       = days since create_date — the first touchpoint, set when
//                    the merchant row is first inserted (before they finish
//                    the REGISTER form).
//   days_at_stage  = days since the merchant ENTERED their current stage.
//                    Most stages: GREATEST of all upstream timestamps —
//                    create_date → register_date → operation_approve_date
//                    → operation_manager_approve_date → risk_approve_date
//                    → risk_manager_approve_date → supervisor_approve_date
//                    (COO) → manager_approve_date (CEO).
//                    Override for PRE_APPROVE_DOCUMENT (contract waiting):
//                      - risk = 'H'  → start from GREATEST(supervisor, manager)
//                        because high-risk needs both COO + CEO sign-off
//                      - risk = 'M' / 'L' / NULL → start from supervisor_approve_date
//                        (CEO is not in the path for non-high-risk)
//                    The six *_approve_date columns are stored UTC despite
//                    their `timestamp without time zone` type (see
//                    docs/dbinfo.md "merchant_info column quirks"), so we
//                    shift them +7h to match Bangkok wall-clock before taking
//                    GREATEST. create_date and register_date are already
//                    Bangkok wall-clock. GREATEST ignores NULLs.
//
// WAITING_SANDBOX rule (same as the aggregate above): mph is authoritative
// for sandbox. A merchant with a mph row of state = 'WAITING_SANDBOX' is
// promoted to that bucket unless mi.state has moved past it
// (APPROVE / COMPLETE_SANDBOX). When promoted, days_at_stage counts from
// the merchant's earliest mph WAITING_SANDBOX create_date — that's when
// sandbox waiting actually started. Orphans (no mi row) come in via the
// second UNION arm with the same accounting.
//
// REJECTed merchants who were ever in WAITING_SANDBOX still surface here,
// because the rule is "not yet APPROVE/COMPLETE_SANDBOX" — flag that with
// product if you'd rather treat REJECT as terminal.
const STUCK_SQL = `
WITH mph_waiting AS (
  SELECT
      mph.merchant_id,
      MIN(mph.create_date) AS ws_create_date
  FROM merchant_process_history mph
  WHERE mph.state = 'WAITING_SANDBOX'
    AND mph.create_date IS NOT NULL
  GROUP BY mph.merchant_id
)
SELECT
    mi.id::text                                                    AS merchant_id,
    mi.merchant_no,
    mi.company_name_en,
    mi.company_name_th,
    mi.merchant_name_en,
    mi.merchant_name_th,
    mi.person_type,
    CASE
      WHEN w.merchant_id IS NOT NULL THEN 'WAITING_SANDBOX'
      ELSE mi.state
    END                                                            AS state,
    mi.risk                                                        AS risk,
    si.name                                                        AS owner_name,
    pi.partner_no,
    mi.create_date::text                                           AS create_date,
    mi.register_date::text                                         AS register_date,
    CASE
      WHEN mi.create_date IS NULL THEN NULL
      ELSE ((now() AT TIME ZONE 'Asia/Bangkok')::date - mi.create_date::date)::int
    END                                                            AS age_days,
    sc.state_changed_at::text                                      AS state_changed_at,
    ((now() AT TIME ZONE 'Asia/Bangkok')::date - sc.state_changed_at::date)::int
                                                                   AS days_at_stage
FROM merchant_info mi
LEFT JOIN partner_info pi ON pi.id = mi.partner_id
LEFT JOIN staff_info si ON si.id = mi.staff_owner_id
LEFT JOIN mph_waiting w ON w.merchant_id = mi.id
  AND mi.state NOT IN ('APPROVE', 'COMPLETE_SANDBOX')
LEFT JOIN LATERAL (
  SELECT CASE
    WHEN w.merchant_id IS NOT NULL THEN
      w.ws_create_date
    WHEN mi.state = 'PRE_APPROVE_DOCUMENT' AND mi.risk = 'H' THEN
      GREATEST(
        mi.supervisor_approve_date + INTERVAL '7 hours',
        mi.manager_approve_date    + INTERVAL '7 hours'
      )
    WHEN mi.state = 'PRE_APPROVE_DOCUMENT' THEN
      mi.supervisor_approve_date + INTERVAL '7 hours'
    ELSE
      GREATEST(
        mi.create_date,
        mi.register_date,
        mi.operation_approve_date         + INTERVAL '7 hours',
        mi.operation_manager_approve_date + INTERVAL '7 hours',
        mi.risk_approve_date              + INTERVAL '7 hours',
        mi.risk_manager_approve_date      + INTERVAL '7 hours',
        mi.supervisor_approve_date        + INTERVAL '7 hours',
        mi.manager_approve_date           + INTERVAL '7 hours'
      )
  END AS state_changed_at
) sc ON true
WHERE mi.state IS NOT NULL
  AND (
    (mi.state <> 'APPROVE' AND mi.state <> 'REJECT')
    OR w.merchant_id IS NOT NULL
  )

UNION ALL

SELECT
    o.merchant_id::text                                            AS merchant_id,
    NULL                                                           AS merchant_no,
    NULL                                                           AS company_name_en,
    NULL                                                           AS company_name_th,
    NULL                                                           AS merchant_name_en,
    NULL                                                           AS merchant_name_th,
    NULL                                                           AS person_type,
    'WAITING_SANDBOX'                                              AS state,
    NULL                                                           AS risk,
    NULL                                                           AS owner_name,
    NULL                                                           AS partner_no,
    o.ws_create_date::text                                         AS create_date,
    NULL                                                           AS register_date,
    ((now() AT TIME ZONE 'Asia/Bangkok')::date - o.ws_create_date::date)::int AS age_days,
    o.ws_create_date::text                                         AS state_changed_at,
    ((now() AT TIME ZONE 'Asia/Bangkok')::date - o.ws_create_date::date)::int AS days_at_stage
FROM mph_waiting o
WHERE NOT EXISTS (SELECT 1 FROM merchant_info mi WHERE mi.id = o.merchant_id)

ORDER BY days_at_stage DESC NULLS LAST, merchant_id ASC
LIMIT 1000;
`;

type StateRow = {
  state: string;
  count: number;
  no_create_date: number;
  age_0_7: number;
  age_8_30: number;
  age_31_90: number;
  age_90_plus: number;
  oldest_create_date: string | null;
  newest_create_date: string | null;
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
  risk: string | null;
  owner_name: string | null;
  partner_no: string | null;
  create_date: string | null;
  register_date: string | null;
  age_days: number | null;
  state_changed_at: string | null;
  days_at_stage: number | null;
};

// Order states top-to-bottom as the real funnel. Anything we don't know
// about (e.g. a future state) gets appended after the known ones but
// before the terminal states.
const FUNNEL_ORDER = [
  "REGISTER",
  "PRE_BUSINESS_APPROVE",
  "BUSINESS_APPROVE",
  "PRE_APPROVE_OPERATION",
  "PRE_APPROVE_OPERATION_MANAGER",
  "PRE_APPROVE_RISK",
  "PRE_APPROVE_RISK_MANAGER",
  "PRE_APPROVE_SUPERVISOR",
  "PRE_APPROVE_MANAGER",
  "PRE_APPROVE_DOCUMENT",
  "WAITING_SANDBOX",
  "COMPLETE_SANDBOX",
  "APPROVE",
  "REJECT",
];

function stateRank(s: string): number {
  const i = FUNNEL_ORDER.indexOf(s);
  return i === -1 ? FUNNEL_ORDER.length - 2 : i;
}

export async function GET() {
  try {
    const pool = getPool();
    const [stateRes, stuckRes] = await Promise.all([
      pool.query<StateRow>(SQL),
      pool.query<StuckRow>(STUCK_SQL),
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
        }
        if (r.state === "APPROVE") acc.approved = r.count;
        if (r.state === "REJECT") acc.rejected = r.count;
        return acc;
      },
      { all: 0, inPipeline: 0, approved: 0, rejected: 0 },
    );

    return NextResponse.json({
      states,
      totals,
      stuck: stuckRes.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/onboarding-funnel]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
