import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side cap so a stray paste of thousands of refs can't lock up the table.
const ROW_LIMIT = 5000;
const REF_INPUT_LIMIT = 10000;

const SQL = `
SELECT
    pt.id::text                            AS "Order ID",
    pt.create_by                           AS "Create By",
    pt.create_date                         AS "Create Date",
    pt.merchant_invoice                    AS "Ref1",
    pt.merchant_reference_no               AS "Ref2",
    pt.amount                              AS "Amount",
    pt.status                              AS "Payment Status",
    pt.payment_date                        AS "Payment Date",
    mi.merchant_no                         AS "MID",
    mi.merchant_name_en                    AS "Merchant Name"
FROM payment_transaction pt
LEFT JOIN merchant_info mi ON mi.id = pt.merchant_id
WHERE pt.merchant_invoice      = ANY($1::text[])
   OR pt.merchant_reference_no = ANY($2::text[])
ORDER BY pt.payment_date DESC NULLS LAST, pt.create_date DESC NULLS LAST
LIMIT $3;
`;

function parseRefs(input: unknown): string[] {
  if (typeof input === "string") {
    return input
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (Array.isArray(input)) {
    return input.map((s) => String(s).trim()).filter((s) => s.length > 0);
  }
  return [];
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { ref1, ref2 } = (body ?? {}) as { ref1?: unknown; ref2?: unknown };
  const ref1Arr = parseRefs(ref1);
  const ref2Arr = parseRefs(ref2);

  if (ref1Arr.length === 0 && ref2Arr.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one Ref1 or Ref2 value." },
      { status: 400 },
    );
  }
  if (ref1Arr.length > REF_INPUT_LIMIT || ref2Arr.length > REF_INPUT_LIMIT) {
    return NextResponse.json(
      { error: `Too many refs — maximum ${REF_INPUT_LIMIT.toLocaleString()} per field.` },
      { status: 400 },
    );
  }

  try {
    const pool = getPool();
    const result = await pool.query(SQL, [ref1Arr, ref2Arr, ROW_LIMIT]);
    return NextResponse.json({
      rows: result.rows,
      count: result.rows.length,
      capped: result.rows.length === ROW_LIMIT,
      rowLimit: ROW_LIMIT,
      submittedRef1: ref1Arr.length,
      submittedRef2: ref2Arr.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/payment-status]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
