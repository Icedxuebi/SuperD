import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SQL = `
SELECT DISTINCT DATE(payment_date)::text AS day
FROM payment_transaction
WHERE payment_date >= CURRENT_DATE - INTERVAL '90 days'
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
