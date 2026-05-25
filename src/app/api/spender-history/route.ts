import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCOUNT_RE = /^[0-9]{4,20}$/;

const SQL = `
SELECT
  ptr.from_account                  AS account_number,
  MAX(COALESCE(NULLIF(TRIM(ptr.from_name), ''), NULLIF(TRIM(pt.customer_name), '')))  AS name,
  pi.partner_no                     AS partner,
  mi.merchant_no                    AS mid,
  COALESCE(NULLIF(TRIM(mi.merchant_name_en), ''), NULLIF(TRIM(mi.merchant_name_th), '')) AS merchant,
  mi.website                        AS website,
  md_bg.mcc                         AS mcc,
  COALESCE(md_bg.name_th, md_bg.name_en) AS business_group,
  SUM(pt.amount)::float8            AS total_amount,
  COUNT(*)::int                     AS transaction_count,
  AVG(pt.amount)::float8            AS average_amount,
  MIN(pt.amount)::float8            AS minimum_amount,
  MAX(pt.amount)::float8            AS maximum_amount,
  MIN(pt.payment_date)::date        AS begin_date,
  MAX(pt.payment_date)::date        AS end_date
FROM payment_transaction_response ptr
JOIN payment_transaction pt ON pt.id = ptr.ptx_id
JOIN merchant_info mi ON mi.id = pt.merchant_id
LEFT JOIN partner_info pi ON pi.id = mi.partner_id
LEFT JOIN master_data md_bg
  ON md_bg.id::text = mi.business_group_id::text
 AND md_bg.key1 = 'BUSINESS_GROUP'
WHERE ptr.from_account = $1
  AND pt.status = 'S'
GROUP BY
  ptr.from_account,
  pi.partner_no,
  mi.merchant_no,
  mi.merchant_name_en,
  mi.merchant_name_th,
  mi.website,
  md_bg.mcc,
  md_bg.name_th,
  md_bg.name_en
ORDER BY SUM(pt.amount) DESC;
`;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const account = (url.searchParams.get("account") ?? "").trim();

  if (!account) {
    return NextResponse.json({ rows: [], total: 0, account: null });
  }

  if (!ACCOUNT_RE.test(account)) {
    return NextResponse.json(
      { error: "Account number must be 4–20 digits." },
      { status: 400 },
    );
  }

  try {
    const pool = getPool();
    const result = await pool.query(SQL, [account]);
    return NextResponse.json({
      account,
      rows: result.rows,
      total: result.rows.length,
    });
  } catch (err) {
    console.error("[/api/spender-history] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
