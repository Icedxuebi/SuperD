import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIERS = [5, 10, 25] as const;

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

    if (result.rows.length === 0) {
      return NextResponse.json({
        from,
        to,
        dayCount: 0,
        tiers: TIERS,
        merchants: [],
        topPerformers: { top5: null, top10: null, top25: null },
      });
    }

    // Bucket by day, then rank within each day, then accumulate counters per merchant.
    const perDay = new Map<
      string,
      Map<string, { mid: string; merchantName: string; partner: string | null; amount: number }>
    >();
    for (const r of result.rows) {
      const amt = Number(r.amount);
      if (!perDay.has(r.day)) perDay.set(r.day, new Map());
      const bucket = perDay.get(r.day)!;
      const existing = bucket.get(r.mid);
      if (existing) existing.amount += amt;
      else
        bucket.set(r.mid, {
          mid: r.mid,
          merchantName: r.merchant_name,
          partner: r.partner,
          amount: amt,
        });
    }

    const stats = new Map<
      string,
      {
        mid: string;
        merchantName: string;
        partner: string | null;
        top5Count: number;
        top10Count: number;
        top25Count: number;
        daysAppeared: number;
        totalAmount: number;
        bestRank: number;
      }
    >();

    for (const bucket of perDay.values()) {
      const ranked = Array.from(bucket.values()).sort((a, b) => b.amount - a.amount);
      ranked.forEach((m, idx) => {
        const rank = idx + 1;
        const existing = stats.get(m.mid);
        if (existing) {
          if (rank <= 5) existing.top5Count += 1;
          if (rank <= 10) existing.top10Count += 1;
          if (rank <= 25) existing.top25Count += 1;
          existing.daysAppeared += 1;
          existing.totalAmount += m.amount;
          if (rank < existing.bestRank) existing.bestRank = rank;
          existing.merchantName = m.merchantName;
          if (m.partner) existing.partner = m.partner;
        } else {
          stats.set(m.mid, {
            mid: m.mid,
            merchantName: m.merchantName,
            partner: m.partner,
            top5Count: rank <= 5 ? 1 : 0,
            top10Count: rank <= 10 ? 1 : 0,
            top25Count: rank <= 25 ? 1 : 0,
            daysAppeared: 1,
            totalAmount: m.amount,
            bestRank: rank,
          });
        }
      });
    }

    const merchants = Array.from(stats.values()).sort((a, b) => {
      if (b.top5Count !== a.top5Count) return b.top5Count - a.top5Count;
      if (b.top10Count !== a.top10Count) return b.top10Count - a.top10Count;
      if (b.top25Count !== a.top25Count) return b.top25Count - a.top25Count;
      return b.totalAmount - a.totalAmount;
    });

    function topBy(key: "top5Count" | "top10Count" | "top25Count") {
      let best: (typeof merchants)[number] | null = null;
      for (const m of merchants) {
        if (!best || m[key] > best[key]) best = m;
      }
      return best && best[key] > 0
        ? { mid: best.mid, merchantName: best.merchantName, count: best[key] }
        : null;
    }

    return NextResponse.json({
      from,
      to,
      dayCount: perDay.size,
      tiers: TIERS,
      merchants,
      topPerformers: {
        top5: topBy("top5Count"),
        top10: topBy("top10Count"),
        top25: topBy("top25Count"),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/top100/stats]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
