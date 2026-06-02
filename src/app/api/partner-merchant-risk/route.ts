import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Source: partner_info (~128 rows) + merchant_info (~1.5k rows). Both are
// small so we fetch the full set and let the page do tallying client-side —
// mirrors the shape the original CSV-upload version of this dashboard
// expected, so the rendering logic is unchanged.
//
// Status mapping:  close_date IS NOT NULL → Closed
//                  state = 'APPROVE'      → Active
//                  anything else          → Inactive
//
// Risk mapping:    H → High, M → Medium, L → Low
//                  null / '' / anything else → Unrated

type Status = "Active" | "Inactive" | "Closed";
type Risk = "High" | "Medium" | "Low" | "Unrated";

function normRisk(v: string | null): Risk {
  if (!v) return "Unrated";
  const t = v.trim().toUpperCase();
  if (t === "H" || t === "HIGH") return "High";
  if (t === "M" || t === "MEDIUM") return "Medium";
  if (t === "L" || t === "LOW") return "Low";
  return "Unrated";
}

function normStatus(closeDate: string | null, state: string | null): Status {
  if (closeDate) return "Closed";
  if (state === "APPROVE") return "Active";
  return "Inactive";
}

type PartnerDbRow = {
  partner_no: string | null;
  state: string | null;
  close_date: string | null;
  risk: string | null;
};

type MerchantDbRow = {
  merchant_no: string | null;
  state: string | null;
  close_date: string | null;
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
      `),
      pool.query<MerchantDbRow>(`
        SELECT
          mi.merchant_no,
          mi.state,
          mi.close_date::text AS close_date,
          mi.risk,
          pi.partner_no
        FROM merchant_info mi
        LEFT JOIN partner_info pi ON pi.id = mi.partner_id
      `),
    ]);

    return NextResponse.json({
      partners: partnersRes.rows.map((r) => ({
        ae: r.partner_no,
        status: normStatus(r.close_date, r.state),
        risk: normRisk(r.risk),
      })),
      merchants: merchantsRes.rows.map((r) => ({
        code: r.merchant_no,
        status: normStatus(r.close_date, r.state),
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
