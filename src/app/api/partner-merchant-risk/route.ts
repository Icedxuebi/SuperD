import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Source: partner_info + merchant_info (~1.5k rows). Both are small so we
// fetch the full set and let the page do tallying client-side — mirrors the
// shape the original CSV-upload version of this dashboard expected, so the
// rendering logic is unchanged.
//
// Partners are restricted to rows that carry an AE code (partner_no) — 94 of
// the 139 partner_info rows. The 45 without a partner_no are internal /
// pre-AE records that don't belong on the AE-oriented dashboard.
//
// Merchants with no state (state NULL / '') are excluded entirely — they are
// incomplete records, not a real status, so they don't belong in any AE's
// totals (this drops AE000004 from 249 → 247, and similarly for every AE).
//
// Merchant status mapping — same rule as /api/merchants (merchant lookup) and
// /api/merchant-status-by-ae, keyed on merchant_info.enabled and whether the
// merchant has an enabled users row ("user enabled"):
//   Active   → state = 'APPROVE' AND user enabled     AND merchant enabled.
//   Inactive → state = 'APPROVE' AND user enabled     AND merchant NOT enabled.
//   Close    → state = 'APPROVE' AND user NOT enabled AND merchant NOT enabled.
//   Other    → everything else: the onboarding pipeline (BUSINESS_APPROVE,
//              PRE_APPROVE_*, REGISTER, REJECT, *_SANDBOX) and the leftover
//              approved combo (user NOT enabled AND merchant enabled) the rule
//              leaves undefined. Unlike the other two consumers, this page keeps
//              those rows visible under "Other" rather than dropping them.
//
// Partner (AE) status keeps its own close_date/state rule — partners have no
// merchant/user enabled flags — and never lands in "Other":
//   close_date IS NOT NULL → Close ; state = 'APPROVE' → Active ; else Inactive.
//
// Risk mapping:    H → High, M → Medium, L → Low
//                  null / '' / anything else → Unrated

type Status = "Active" | "Inactive" | "Close" | "Other";
type Risk = "High" | "Medium" | "Low" | "Unrated";

function normRisk(v: string | null): Risk {
  if (!v) return "Unrated";
  const t = v.trim().toUpperCase();
  if (t === "H" || t === "HIGH") return "High";
  if (t === "M" || t === "MEDIUM") return "Medium";
  if (t === "L" || t === "LOW") return "Low";
  return "Unrated";
}

// Partners only — close_date / state based.
function partnerStatus(closeDate: string | null, state: string | null): Status {
  if (closeDate) return "Close";
  if (state === "APPROVE") return "Active";
  return "Inactive";
}

// Merchants — enabled-flag based (Active / Inactive / Close / Other).
function merchantStatus(
  state: string | null,
  userEnabled: boolean,
  merchantEnabled: boolean | null,
): Status {
  if (state === "APPROVE" && userEnabled && merchantEnabled === true) return "Active";
  if (state === "APPROVE" && userEnabled && merchantEnabled === false) return "Inactive";
  if (state === "APPROVE" && !userEnabled && merchantEnabled === false) return "Close";
  return "Other";
}

type PartnerDbRow = {
  partner_no: string | null;
  state: string | null;
  close_date: string | null;
  risk: string | null;
};

type MerchantDbRow = {
  merchant_no: string | null;
  name: string | null;
  state: string | null;
  merchant_enabled: boolean | null;
  user_enabled: boolean;
  close_date: string | null;
  close_remark: string | null;
  risk: string | null;
  partner_no: string | null;
};

export async function GET() {
  try {
    const pool = getPool();

    const [partnersRes, merchantsRes] = await Promise.all([
      pool.query<PartnerDbRow>(`
        SELECT
          partner_no,
          state,
          close_date::text AS close_date,
          risk
        FROM partner_info
        WHERE partner_no IS NOT NULL AND btrim(partner_no) <> ''
      `),
      pool.query<MerchantDbRow>(`
        SELECT
          mi.merchant_no,
          COALESCE(
            NULLIF(btrim(mi.company_name_en), ''),
            NULLIF(btrim(mi.company_name_th), ''),
            NULLIF(btrim(mi.merchant_name_en), ''),
            NULLIF(btrim(mi.merchant_name_th), '')
          ) AS name,
          mi.state,
          mi.enabled AS merchant_enabled,
          EXISTS (
            SELECT 1 FROM users u
            WHERE u.merchant_id = mi.id AND u.enabled IS TRUE
          ) AS user_enabled,
          mi.close_date::text AS close_date,
          NULLIF(btrim(mi.close_remark), '') AS close_remark,
          mi.risk,
          pi.partner_no
        FROM merchant_info mi
        LEFT JOIN partner_info pi ON pi.id = mi.partner_id
        WHERE mi.state IS NOT NULL AND btrim(mi.state) <> ''
      `),
    ]);

    return NextResponse.json({
      partners: partnersRes.rows.map((r) => ({
        ae: r.partner_no,
        status: partnerStatus(r.close_date, r.state),
        risk: normRisk(r.risk),
      })),
      merchants: merchantsRes.rows.map((r) => ({
        code: r.merchant_no,
        name: r.name,
        status: merchantStatus(r.state, r.user_enabled, r.merchant_enabled),
        closeReason: r.close_remark,
        risk: normRisk(r.risk),
        ae: r.partner_no,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/partner-merchant-risk]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
