import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SQL = `
SELECT
    mi.merchant_no       AS mid,
    mi.merchant_name_en  AS merchant_name,
    pi.partner_no        AS partner,
    SUM(pt.amount)       AS amount
FROM payment_transaction pt
JOIN merchant_info mi ON mi.id = pt.merchant_id
LEFT JOIN partner_info pi ON pi.id = mi.partner_id
WHERE pt.payment_date >= $1::date
  AND pt.payment_date <  ($2::date + INTERVAL '1 day')
GROUP BY mi.merchant_no, mi.merchant_name_en, pi.partner_no;
`;

type Row = {
  mid: string;
  merchant_name: string;
  partner: string | null;
  amount: string;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "Both `from` and `to` query parameters are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  try {
    const pool = getPool();
    const result = await pool.query<Row>(SQL, [from, to]);

    if (result.rows.length === 0) {
      return NextResponse.json({
        totalMerchants: 0,
        totalAmount: 0,
        topMerchant: null,
        topMerchantAmount: 0,
        uniquePartners: 0,
        partnerBreakdown: [],
      });
    }

    let grandTotal = 0;
    let topMerchant: { name: string; amount: number } | null = null;
    const partnerTotals = new Map<string, number>();

    for (const r of result.rows) {
      const amt = Number(r.amount);
      grandTotal += amt;
      if (!topMerchant || amt > topMerchant.amount) {
        topMerchant = { name: r.merchant_name, amount: amt };
      }
      const partner = r.partner ?? "Unknown";
      partnerTotals.set(partner, (partnerTotals.get(partner) ?? 0) + amt);
    }

    const partnerBreakdown = Array.from(partnerTotals.entries())
      .map(([partner, amount]) => ({ partner, amount }))
      .sort((a, b) => b.amount - a.amount);

    return NextResponse.json({
      totalMerchants: result.rows.length,
      totalAmount: grandTotal,
      topMerchant: topMerchant?.name ?? null,
      topMerchantAmount: topMerchant?.amount ?? 0,
      uniquePartners: partnerTotals.size,
      partnerBreakdown,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/top100/summary]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
