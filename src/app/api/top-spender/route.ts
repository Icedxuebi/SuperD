import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "YYYY-MM" — what <input type="month"> produces
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const ALLOWED_LIMITS = new Set([50, 100, 250, 500]);

// Two-step query: (1) aggregate on payment_transaction only — pt.customer_bank_account_no
// is fully populated (verified 100% coverage in 2026-05) and avoids the join to the
// 12 GB payment_transaction_response table. (2) enrich the top N rows with the
// bank-confirmed display name from payment_transaction_response, which is indexed by
// from_account and resolves in ~3 s for 100 keys.
const SQL_AGG = `
SELECT
  pt.customer_bank_account_no            AS account_number,
  SUM(pt.amount)::float8                 AS total_amount,
  COUNT(*)::int                          AS transaction_count,
  COUNT(*)            OVER ()            AS overall_spenders,
  SUM(SUM(pt.amount)) OVER ()::float8    AS overall_amount,
  SUM(COUNT(*))       OVER ()            AS overall_transactions
FROM payment_transaction pt
WHERE pt.status = 'S'
  AND pt.payment_date >= $1::timestamp
  AND pt.payment_date <  $2::timestamp
  AND pt.customer_bank_account_no IS NOT NULL
  AND TRIM(pt.customer_bank_account_no) <> ''
GROUP BY pt.customer_bank_account_no
ORDER BY SUM(pt.amount) DESC
LIMIT $3;
`;

const SQL_NAMES = `
SELECT
  ptr.from_account AS account_number,
  MAX(ptr.from_name) AS name
FROM payment_transaction_response ptr
WHERE ptr.from_account = ANY($1::text[])
GROUP BY ptr.from_account;
`;

function monthBounds(month: string): { start: string; end: string } {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error("invalid month");
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) throw new Error("invalid month");
  const start = `${year.toString().padStart(4, "0")}-${m[2]}-01 00:00:00`;
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const end = `${nextYear.toString().padStart(4, "0")}-${nextMon.toString().padStart(2, "0")}-01 00:00:00`;
  return { start, end };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = (url.searchParams.get("month") ?? "").trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = ALLOWED_LIMITS.has(limitRaw) ? limitRaw : 100;

  if (!MONTH_RE.test(month)) {
    return NextResponse.json(
      { error: "month must be in YYYY-MM format" },
      { status: 400 },
    );
  }

  let bounds;
  try {
    bounds = monthBounds(month);
  } catch {
    return NextResponse.json({ error: "invalid month" }, { status: 400 });
  }

  try {
    const pool = getPool();
    const aggResult = await pool.query(SQL_AGG, [bounds.start, bounds.end, limit]);
    const first = aggResult.rows[0];
    const totals = first
      ? {
          unique_spenders: Number(first.overall_spenders ?? 0),
          total_amount: Number(first.overall_amount ?? 0),
          total_transactions: Number(first.overall_transactions ?? 0),
        }
      : { unique_spenders: 0, total_amount: 0, total_transactions: 0 };

    const accountNumbers = aggResult.rows
      .map((r) => r.account_number)
      .filter((v): v is string => typeof v === "string" && v.length > 0);

    let nameMap = new Map<string, string>();
    if (accountNumbers.length > 0) {
      const nameResult = await pool.query(SQL_NAMES, [accountNumbers]);
      nameMap = new Map(
        nameResult.rows
          .filter((r) => r.name && String(r.name).trim().length > 0)
          .map((r) => [r.account_number as string, String(r.name).trim()]),
      );
    }

    const rows = aggResult.rows.map((r) => ({
      account_number: r.account_number,
      name: nameMap.get(r.account_number) ?? null,
      total_amount: Number(r.total_amount),
      transaction_count: Number(r.transaction_count),
    }));
    return NextResponse.json({ month, limit, totals, rows });
  } catch (err) {
    console.error("[/api/top-spender] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
