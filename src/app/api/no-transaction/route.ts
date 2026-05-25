import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_DAYS = new Set([75, 90, 120]);

const SQL = `
WITH inactive AS (
  SELECT
    mi.id,
    mi.merchant_no,
    mi.merchant_name_en,
    mi.merchant_name_th,
    mi.state,
    mi.enabled,
    mi.partner_id
  FROM merchant_info mi
  WHERE mi.close_date IS NULL
    AND mi.state = 'APPROVE'
    AND NOT EXISTS (
      SELECT 1
      FROM payment_transaction pt
      WHERE pt.merchant_id = mi.id
        AND pt.status = 'S'
        AND pt.payment_date > NOW() - ($1 || ' days')::interval
    )
)
SELECT
  i.merchant_no,
  COALESCE(NULLIF(TRIM(i.merchant_name_en), ''), NULLIF(TRIM(i.merchant_name_th), '')) AS merchant_name,
  i.state,
  i.enabled,
  pi.partner_no,
  (
    SELECT MAX(payment_date)
    FROM payment_transaction
    WHERE merchant_id = i.id AND status = 'S'
  ) AS last_success_date
FROM inactive i
LEFT JOIN partner_info pi ON pi.id = i.partner_id
ORDER BY i.merchant_no;
`;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const daysRaw = Number(url.searchParams.get("days") ?? "90");
  const days = ALLOWED_DAYS.has(daysRaw) ? daysRaw : 90;

  try {
    const pool = getPool();
    const result = await pool.query(SQL, [days]);
    return NextResponse.json({ days, rows: result.rows, total: result.rows.length });
  } catch (err) {
    console.error("[/api/no-transaction] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
