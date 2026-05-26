import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { parseRefs } from "@/lib/parse-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side cap so a stray paste of thousands of refs can't lock up the table.
const ROW_LIMIT = 5000;
const REF_INPUT_LIMIT = 10000;

const SQL = `
SELECT
    tt.id::text                            AS "Order ID",
    tt.create_by                           AS "Create By",
    tt.create_date                         AS "Create Date",
    tt.merchant_invoice                    AS "Ref1",
    tt.merchant_reference_no               AS "Ref2",
    tt.amount                              AS "Amount",
    tt.status                              AS "Transfer Status",
    tt.transfer_date                       AS "Transfer Date",
    mi.merchant_no                         AS "MID",
    mi.merchant_name_en                    AS "Merchant Name"
FROM transfer_transaction tt
LEFT JOIN merchant_info mi ON mi.id = tt.merchant_id
WHERE tt.merchant_invoice      = ANY($1::text[])
   OR tt.merchant_reference_no = ANY($2::text[])
ORDER BY tt.transfer_date DESC NULLS LAST, tt.create_date DESC NULLS LAST
LIMIT $3;
`;

// Export variant — every column on the transfer (SELECT *) plus the
// merchant identifiers, for the "Export to Excel" button.
const EXPORT_SQL = `
SELECT
    tt.*,
    mi.merchant_no                         AS "MID",
    mi.merchant_name_en                    AS "Merchant Name"
FROM transfer_transaction tt
LEFT JOIN merchant_info mi ON mi.id = tt.merchant_id
WHERE tt.merchant_invoice      = ANY($1::text[])
   OR tt.merchant_reference_no = ANY($2::text[])
ORDER BY tt.transfer_date DESC NULLS LAST, tt.create_date DESC NULLS LAST
LIMIT $3;
`;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { ref1, ref2, full } = (body ?? {}) as {
    ref1?: unknown;
    ref2?: unknown;
    full?: unknown;
  };
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
    const result = await pool.query(full === true ? EXPORT_SQL : SQL, [
      ref1Arr,
      ref2Arr,
      ROW_LIMIT,
    ]);
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
    console.error("[/api/transfer-status]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
