import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only the current and previous calendar month — enough to drive the date
// picker without scanning 90 days of payment_transaction on every page load.
const SQL = `
SELECT DISTINCT DATE(payment_date)::text AS day
FROM payment_transaction
WHERE payment_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
ORDER BY day DESC;
`;

export async function GET() {
  try {
    const pool = getPool();
    const result = await pool.query<{ day: string }>(SQL);
    const periods = result.rows.map((r, i) => ({
      id: i + 1,
      dateStart: r.day,
      dateEnd: r.day,
    }));
    return NextResponse.json({ periods });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/top100/periods]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
