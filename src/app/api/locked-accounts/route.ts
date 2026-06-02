import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// users is the unified auth table (~1,744 rows). One row can be a merchant,
// staff, or partner user via the mutually-exclusive merchant_id/staff_id/
// partner_id columns. A user counts as "locked" if any of these are true:
//   1. login_permanently_locked = true
//   2. mfa_otp_locked_until is in the future
//   3. locked_until is in the future
// We surface the strongest reason first (permanent > MFA > login).
//
// We don't filter by enabled — even disabled accounts that are also locked
// are interesting to operations because they may need to be cleared before
// the merchant can be re-enabled.

const SUMMARY_SQL = `
SELECT
  COUNT(*) FILTER (WHERE u.login_permanently_locked IS TRUE)::int  AS permanent_locked,
  COUNT(*) FILTER (
    WHERE u.mfa_otp_locked_until IS NOT NULL
      AND u.mfa_otp_locked_until > (now() AT TIME ZONE 'Asia/Bangkok')
  )::int                                                            AS mfa_locked,
  COUNT(*) FILTER (
    WHERE u.locked_until IS NOT NULL
      AND u.locked_until > (now() AT TIME ZONE 'Asia/Bangkok')
  )::int                                                            AS login_locked,
  COUNT(*)::int                                                     AS total_users,
  COUNT(*) FILTER (WHERE u.enabled IS TRUE)::int                    AS total_enabled
FROM users u;
`;

// Detail query. We compute is_locked at the SQL layer so the table is
// already filtered to lockouts.
//
// "Owner" labelling:
//   merchant_id  → 'merchant'  + merchant_info.merchant_no / company name
//   partner_id   → 'partner'   + partner_info.partner_no   / partner name
//   staff_id     → 'staff'     + staff_info.first/last name
//   (all NULL)   → 'unknown'
const DETAIL_SQL = `
WITH locked AS (
  SELECT u.*
  FROM users u
  WHERE u.login_permanently_locked IS TRUE
     OR (u.mfa_otp_locked_until IS NOT NULL
         AND u.mfa_otp_locked_until > (now() AT TIME ZONE 'Asia/Bangkok'))
     OR (u.locked_until IS NOT NULL
         AND u.locked_until > (now() AT TIME ZONE 'Asia/Bangkok'))
)
SELECT
  l.username,
  l.enabled,
  l.merchant_id,
  l.partner_id,
  l.staff_id,
  l.failed_login_attempts,
  l.mfa_otp_failed_attempts,
  l.login_lock_tier,
  l.login_permanently_locked,
  l.mfa_otp_locked_until::text                                        AS mfa_otp_locked_until,
  l.locked_until::text                                                AS locked_until,
  l.last_failed_login_time::text                                      AS last_failed_login_time,
  CASE
    WHEN l.merchant_id IS NOT NULL THEN 'merchant'
    WHEN l.partner_id  IS NOT NULL THEN 'partner'
    WHEN l.staff_id    IS NOT NULL THEN 'staff'
    ELSE 'unknown'
  END                                                                 AS owner_type,
  mi.merchant_no,
  COALESCE(mi.company_name_en, mi.company_name_th)                    AS merchant_company,
  pi.partner_no
FROM locked l
LEFT JOIN merchant_info mi ON mi.id = l.merchant_id
LEFT JOIN partner_info  pi ON pi.id = l.partner_id
ORDER BY
  l.login_permanently_locked DESC,
  l.mfa_otp_locked_until DESC NULLS LAST,
  l.locked_until DESC NULLS LAST,
  l.username ASC;
`;

type SummaryRow = {
  permanent_locked: number;
  mfa_locked: number;
  login_locked: number;
  total_users: number;
  total_enabled: number;
};

type DetailRow = {
  username: string;
  enabled: boolean | null;
  merchant_id: string | null;
  partner_id: string | null;
  staff_id: string | null;
  failed_login_attempts: number | null;
  mfa_otp_failed_attempts: number | null;
  login_lock_tier: string | number | null;
  login_permanently_locked: boolean | null;
  mfa_otp_locked_until: string | null;
  locked_until: string | null;
  last_failed_login_time: string | null;
  owner_type: "merchant" | "partner" | "staff" | "unknown";
  merchant_no: string | null;
  merchant_company: string | null;
  partner_no: string | null;
};

export async function GET() {
  try {
    const pool = getPool();
    const [summaryRes, detailRes] = await Promise.all([
      pool.query<SummaryRow>(SUMMARY_SQL),
      pool.query<DetailRow>(DETAIL_SQL),
    ]);

    return NextResponse.json({
      summary: summaryRes.rows[0] ?? {
        permanent_locked: 0,
        mfa_locked: 0,
        login_locked: 0,
        total_users: 0,
        total_enabled: 0,
      },
      rows: detailRes.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/locked-accounts]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
