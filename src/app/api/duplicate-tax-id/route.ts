import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SQL = `
WITH base AS (
  SELECT
    mi.merchant_no,
    COALESCE(NULLIF(TRIM(mi.merchant_name_en), ''), NULLIF(TRIM(mi.merchant_name_th), '')) AS merchant_name,
    mi.state,
    mi.remark,
    mi.close_date,
    mi.close_remark,
    mpi.full_name_th,
    mpi.full_name_en,
    COALESCE(NULLIF(TRIM(mi.company_tax_id), ''), NULLIF(TRIM(mpi.citizen_id), '')) AS tax_id
  FROM merchant_info mi
  LEFT JOIN LATERAL (
    SELECT full_name_th, full_name_en, citizen_id
    FROM merchant_personal_info
    WHERE merchant_id = mi.id
    ORDER BY id ASC
    LIMIT 1
  ) mpi ON TRUE
),
duped AS (
  SELECT tax_id
  FROM base
  WHERE tax_id IS NOT NULL
  GROUP BY tax_id
  HAVING COUNT(*) > 1
)
SELECT b.*
FROM base b
JOIN duped d ON d.tax_id = b.tax_id
ORDER BY b.tax_id, b.merchant_no;
`;

export async function GET() {
  try {
    const pool = getPool();
    const result = await pool.query(SQL);
    return NextResponse.json({ rows: result.rows, total: result.rows.length });
  } catch (err) {
    console.error("[/api/duplicate-tax-id] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
