import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 100;

// Allowlist of sortable columns → real SQL expressions.
// Keys are the names the client sends; values are safe SQL fragments
// that get spliced into ORDER BY (so no user input ever reaches the
// SQL string).
const SORT_COLUMNS: Record<string, string> = {
  merchant_no: "mi.merchant_no",
  partner_no: "pi.partner_no",
  merchant_name_en: "mi.merchant_name_en",
  email: "email",
  state: "mi.state",
  status: "status",
  auto_reject_detail: "mi.auto_reject_detail",
  approved_date: "mi.manager_approve_date",
  store_closure_date: "mi.close_date",
  store_closure_reason: "mi.close_remark",
};

// Derived Active/Inactive/Close status, over APPROVED merchants only. The two
// inputs are the merchant flag (merchant_info.enabled) and whether the merchant
// has ≥1 enabled users row ("user enabled"):
//   Active   → state = 'APPROVE' AND user enabled     AND merchant enabled.
//   Inactive → state = 'APPROVE' AND user enabled     AND merchant NOT enabled.
//   Close    → state = 'APPROVE' AND user NOT enabled AND merchant NOT enabled.
// Everything else is NULL, rendered as an em-dash: the onboarding pipeline /
// rejected / sandbox / null-state rows (no APPROVE), and the leftover approved
// combination — user NOT enabled AND merchant enabled — which the rules leave
// undefined. close_date is deliberately not consulted.
// The same merchant rule is shared by /api/merchant-status-by-ae (which drops
// the leftover, like this route) and /api/partner-merchant-risk (which keeps
// the leftover under an "Other" bucket).
const USER_ENABLED = `EXISTS (SELECT 1 FROM users u WHERE u.merchant_id = mi.id AND u.enabled IS TRUE)`;
const USER_DISABLED = `NOT EXISTS (SELECT 1 FROM users u WHERE u.merchant_id = mi.id AND u.enabled IS TRUE)`;
const ACTIVE_PREDICATE = `
    mi.state = 'APPROVE'
    AND ${USER_ENABLED}
    AND mi.enabled IS TRUE`;
const INACTIVE_PREDICATE = `
    mi.state = 'APPROVE'
    AND ${USER_ENABLED}
    AND mi.enabled IS FALSE`;
const CLOSE_PREDICATE = `
    mi.state = 'APPROVE'
    AND ${USER_DISABLED}
    AND mi.enabled IS FALSE`;

function buildSql(orderBy: string, dir: "ASC" | "DESC"): string {
  return `
    SELECT
        mi.merchant_no,
        pi.partner_no,
        mi.merchant_name_en,
        (
            SELECT u.username
            FROM users u
            WHERE u.merchant_id = mi.id
            ORDER BY u.username
            LIMIT 1
        )                                    AS email,
        mi.state,
        CASE
            WHEN ${ACTIVE_PREDICATE}   THEN 'Active'
            WHEN ${INACTIVE_PREDICATE} THEN 'Inactive'
            WHEN ${CLOSE_PREDICATE}    THEN 'Close'
            ELSE NULL
        END                                  AS status,
        mi.auto_reject_detail                AS auto_reject_detail,
        mi.manager_approve_date              AS approved_date,
        mi.close_date                        AS store_closure_date,
        mi.close_remark                      AS store_closure_reason,
        COUNT(*) OVER ()                     AS total
    FROM merchant_info mi
    LEFT JOIN partner_info pi ON pi.id = mi.partner_id
    WHERE ($1::text = ''
        OR mi.merchant_no    ILIKE $1
        OR mi.merchant_name_en ILIKE $1
        OR pi.partner_no     ILIKE $1)
      AND ($4::text = ''
        OR ($4 = '__NULL__' AND mi.state IS NULL)
        OR mi.state = $4)
      AND ($5::text = ''
        OR ($5 = 'ACTIVE'   AND ${ACTIVE_PREDICATE})
        OR ($5 = 'INACTIVE' AND ${INACTIVE_PREDICATE})
        OR ($5 = 'CLOSE'    AND ${CLOSE_PREDICATE}))
    ORDER BY ${orderBy} ${dir} NULLS LAST, mi.merchant_no ASC
    LIMIT $2 OFFSET $3;
  `;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qRaw = url.searchParams.get("q") ?? "";
  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const pageSizeRaw = Number(url.searchParams.get("pageSize") ?? "10");
  const sortByRaw = url.searchParams.get("sortBy") ?? "merchant_no";
  const sortDirRaw = (url.searchParams.get("sortDir") ?? "asc").toLowerCase();
  const stateRaw = (url.searchParams.get("state") ?? "").trim();
  const statusUpper = (url.searchParams.get("status") ?? "").trim().toUpperCase();
  const statusRaw =
    statusUpper === "ACTIVE" || statusUpper === "INACTIVE" || statusUpper === "CLOSE"
      ? statusUpper
      : "";

  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1
      ? Math.min(Math.floor(pageSizeRaw), MAX_PAGE_SIZE)
      : 10;
  const offset = (page - 1) * pageSize;
  const q = qRaw.trim();
  const qLike = q === "" ? "" : `%${q}%`;

  const orderBy = SORT_COLUMNS[sortByRaw] ?? SORT_COLUMNS.merchant_no;
  const dir: "ASC" | "DESC" = sortDirRaw === "desc" ? "DESC" : "ASC";

  try {
    const pool = getPool();
    const result = await pool.query(buildSql(orderBy, dir), [
      qLike,
      pageSize,
      offset,
      stateRaw,
      statusRaw,
    ]);
    const total = result.rows.length > 0 ? Number(result.rows[0].total) : 0;
    const rows = result.rows.map(({ total: _t, ...rest }) => rest);
    return NextResponse.json({ rows, total, page, pageSize, sortBy: sortByRaw, sortDir: dir.toLowerCase(), state: stateRaw, status: statusRaw });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/merchants]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
