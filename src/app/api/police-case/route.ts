import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MID_RE = /^[A-Z][A-Z0-9]{2,30}$/;
// Accept either `YYYY-MM-DDTHH:MM` (HTML datetime-local default) or with seconds.
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;
// The API returns the full row set so Excel export gets everything; the page
// uses this constant to cap what it renders into the DOM (the slow part).
const PREVIEW_LIMIT = 1000;

const SQL = `
SELECT
    pt.id::text                          AS "Order ID",
    mi.merchant_no                       AS "MID",
    mi.merchant_name_en                  AS "Merchant Name",
    gc_qr.merchant_id                    AS "BillerID",
    pt.payment_date                      AS "Transaction Date",
    pt.merchant_invoice                  AS "Ref1",
    pt.merchant_reference_no             AS "Ref2",
    'Payment'                            AS "Type",
    pt.amount                            AS "Amount",
    ptr.from_account                     AS "Bank Account Number",
    ptr.from_name                        AS "Bank Account Name",
    ptr.from_bank                        AS "Bank Code",
    md.name_en                           AS "Bank Name"
FROM payment_transaction pt
JOIN merchant_info mi                       ON mi.id = pt.merchant_id
LEFT JOIN payment_transaction_response ptr  ON ptr.ptx_id = pt.id
LEFT JOIN gateway_channel gc_qr             ON gc_qr.id = mi.qr_gwc_id
LEFT JOIN master_data md
       ON md.key1 = 'BANK' AND md.key2 = ptr.from_bank AND md.enabled = TRUE
WHERE mi.merchant_no = $1
  AND pt.payment_date BETWEEN $2::timestamp AND $3::timestamp

UNION ALL

SELECT
    tt.id::text,
    mi.merchant_no,
    mi.merchant_name_en,
    gc_qr.merchant_id,
    tt.transfer_date,
    tt.merchant_invoice,
    tt.merchant_reference_no,
    'Withdraw',
    tt.amount,
    tt.account_no,
    tt.account_holder_name,
    tt.bank_code,
    md.name_en
FROM transfer_transaction tt
JOIN merchant_info mi                       ON mi.id = tt.merchant_id
LEFT JOIN gateway_channel gc_qr             ON gc_qr.id = mi.qr_gwc_id
LEFT JOIN master_data md
       ON md.key1 = 'BANK' AND md.key2 = tt.bank_code AND md.enabled = TRUE
WHERE mi.merchant_no = $1
  AND tt.transfer_date BETWEEN $2::timestamp AND $3::timestamp

ORDER BY "Transaction Date";
`;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { mid, dateFrom, dateTo } = (body ?? {}) as {
    mid?: unknown;
    dateFrom?: unknown;
    dateTo?: unknown;
  };

  if (typeof mid !== "string" || !MID_RE.test(mid)) {
    return NextResponse.json(
      { error: "Invalid MID format. Expected e.g. M250701022505." },
      { status: 400 },
    );
  }
  if (typeof dateFrom !== "string" || !DATETIME_RE.test(dateFrom)) {
    return NextResponse.json({ error: "dateFrom must be YYYY-MM-DDTHH:MM[:SS]." }, { status: 400 });
  }
  if (typeof dateTo !== "string" || !DATETIME_RE.test(dateTo)) {
    return NextResponse.json({ error: "dateTo must be YYYY-MM-DDTHH:MM[:SS]." }, { status: 400 });
  }
  if (dateFrom > dateTo) {
    return NextResponse.json({ error: "dateFrom must be on or before dateTo." }, { status: 400 });
  }

  try {
    const pool = getPool();
    const result = await pool.query(SQL, [mid, dateFrom, dateTo]);
    return NextResponse.json({
      rows: result.rows,
      count: result.rows.length,
      previewLimit: PREVIEW_LIMIT,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/police-case]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
