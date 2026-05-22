import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SQL = `
WITH daily AS (
  SELECT
    pt.merchant_id,
    DATE(pt.payment_date)::text AS day,
    SUM(pt.amount)              AS amount
  FROM payment_transaction pt
  WHERE pt.payment_date >= $1::date
    AND pt.payment_date <  ($2::date + INTERVAL '1 day')
  GROUP BY pt.merchant_id, DATE(pt.payment_date)
)
SELECT
  mi.merchant_no       AS mid,
  mi.merchant_name_en  AS merchant_name,
  pi.partner_no        AS partner,
  mi.website,
  d.day,
  d.amount
FROM daily d
JOIN merchant_info mi ON mi.id = d.merchant_id
LEFT JOIN partner_info pi ON pi.id = mi.partner_id;
`;

type Row = {
  mid: string;
  merchant_name: string;
  partner: string | null;
  website: string | null;
  day: string;
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

    const aggregated = new Map<
      string,
      {
        mid: string;
        merchantName: string;
        partner: string | null;
        website: string | null;
        totalAmount: number;
      }
    >();
    const dailyMap = new Map<string, Map<string, number>>(); // day -> mid -> amount

    for (const r of result.rows) {
      const amt = Number(r.amount);
      const existing = aggregated.get(r.mid);
      if (existing) existing.totalAmount += amt;
      else
        aggregated.set(r.mid, {
          mid: r.mid,
          merchantName: r.merchant_name,
          partner: r.partner,
          website: r.website,
          totalAmount: amt,
        });

      if (!dailyMap.has(r.day)) dailyMap.set(r.day, new Map());
      const dayMap = dailyMap.get(r.day)!;
      dayMap.set(r.mid, (dayMap.get(r.mid) ?? 0) + amt);
    }

    const merchants = Array.from(aggregated.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 100);

    const top5Mids = merchants.slice(0, 5).map((m) => m.mid);
    const trend = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayMap]) => {
        const row: Record<string, string | number> = { date };
        for (const mid of top5Mids) {
          const merchant = merchants.find((m) => m.mid === mid);
          if (merchant) row[merchant.merchantName] = dayMap.get(mid) ?? 0;
        }
        return row;
      });

    return NextResponse.json({
      merchants,
      trend,
      top5Names: top5Mids
        .map((mid) => merchants.find((m) => m.mid === mid)?.merchantName)
        .filter((n): n is string => !!n),
      dayCount: dailyMap.size,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/top100/merchants]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
