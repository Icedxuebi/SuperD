import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 100;

// This route screens every merchant's OWN tax ID against blacklist_id_card and
// returns only the merchants that hit (one row per merchant, with the distinct
// reject_type list they appear under). "Tax ID" follows docs/dbinfo.md:
//   COALESCE(merchant_info.company_tax_id, merchant_personal_info.citizen_id)
// — companies use the corporate tax ID, individuals use the authorized person's
// citizen ID. IDs are digits-normalized on both sides before matching.
//
// Performance note: blacklist_id_card is ~265K rows with no index on a cleaned
// ID, so we pre-aggregate it by cleaned ID ONCE in the `bl` CTE (one seq scan)
// and hash-join that against the ~1.6K merchants. A per-merchant correlated
// scan of the blacklist is ~430M regex ops and times out — do not inline it.

// Allowlist of sortable columns → output-alias SQL fragments spliced into
// ORDER BY (no user input reaches the query string).
const SORT_COLUMNS: Record<string, string> = {
  merchant_no: "h.merchant_no",
  partner_no: "h.partner_no",
  merchant_name: "h.display_name",
  tax_id: "h.tax_id",
  state: "h.state",
  status: "status",
  reject_types: "h.reject_types",
  first_listed: "h.first_listed",
  bl_rows: "h.bl_rows",
  close_date: "h.close_date",
  close_remark: "h.close_remark",
};

// Derived Active/Inactive/Close status, identical to /api/merchants (which see
// for the full rationale): computed over APPROVED merchants only, from the
// merchant flag (merchant_info.enabled) and whether ≥1 users row is enabled.
// Non-approved merchants (applicants, rejected, null-state) carry a null status
// and are reachable via the State filter instead.
const USER_ENABLED = `EXISTS (SELECT 1 FROM users u WHERE u.merchant_id = h.merchant_id AND u.enabled IS TRUE)`;
const USER_DISABLED = `NOT EXISTS (SELECT 1 FROM users u WHERE u.merchant_id = h.merchant_id AND u.enabled IS TRUE)`;
const ACTIVE_PREDICATE = `h.state = 'APPROVE' AND ${USER_ENABLED} AND h.enabled IS TRUE`;
const INACTIVE_PREDICATE = `h.state = 'APPROVE' AND ${USER_ENABLED} AND h.enabled IS FALSE`;
const CLOSE_PREDICATE = `h.state = 'APPROVE' AND ${USER_DISABLED} AND h.enabled IS FALSE`;

function buildSql(orderBy: string, dir: "ASC" | "DESC"): string {
  return `
    WITH bl AS (
      SELECT
        REGEXP_REPLACE(COALESCE(id_card, ''), '[^0-9]', '', 'g')                       AS clean_id,
        string_agg(DISTINCT reject_type, ', ' ORDER BY reject_type)                    AS reject_types,
        MIN(create_date)::text                                                         AS first_listed,
        (array_agg(full_name_th ORDER BY id) FILTER (WHERE full_name_th IS NOT NULL))[1] AS bl_name_th,
        (array_agg(full_name_en ORDER BY id) FILTER (WHERE full_name_en IS NOT NULL))[1] AS bl_name_en,
        COUNT(*)::int                                                                  AS bl_rows
      FROM blacklist_id_card
      WHERE REGEXP_REPLACE(COALESCE(id_card, ''), '[^0-9]', '', 'g') <> ''
      GROUP BY 1
    ),
    base AS (
      SELECT
        mi.id                              AS merchant_id,
        mi.merchant_no,
        mi.person_type,
        mi.state,
        mi.enabled,
        mi.close_date,
        mi.close_remark,
        pi.partner_no,
        COALESCE(
          NULLIF(TRIM(mi.company_name_en), ''),
          NULLIF(TRIM(mi.company_name_th), ''),
          NULLIF(TRIM(mi.merchant_name_en), ''),
          NULLIF(TRIM(mi.merchant_name_th), '')
        )                                  AS display_name,
        COALESCE(
          NULLIF(TRIM(mi.company_tax_id), ''),
          NULLIF(TRIM((
            SELECT mpi.citizen_id FROM merchant_personal_info mpi
            WHERE mpi.merchant_id = mi.id AND COALESCE(TRIM(mpi.citizen_id), '') <> ''
            ORDER BY mpi.is_authorize DESC NULLS LAST, mpi.id ASC LIMIT 1
          )), '')
        )                                  AS tax_id
      FROM merchant_info mi
      LEFT JOIN partner_info pi ON pi.id = mi.partner_id
    ),
    h AS (
      SELECT
        base.merchant_id, base.merchant_no, base.partner_no, base.display_name,
        base.person_type, base.state, base.enabled, base.close_date, base.close_remark,
        base.tax_id,
        bl.reject_types, bl.first_listed, COALESCE(bl.bl_name_th, bl.bl_name_en) AS blacklist_name,
        bl.bl_rows
      FROM base
      JOIN bl ON bl.clean_id = REGEXP_REPLACE(COALESCE(base.tax_id, ''), '[^0-9]', '', 'g')
      WHERE REGEXP_REPLACE(COALESCE(base.tax_id, ''), '[^0-9]', '', 'g') <> ''
    )
    SELECT
      h.merchant_id,
      h.merchant_no,
      h.partner_no,
      h.display_name,
      h.person_type,
      h.tax_id,
      h.state,
      CASE
        WHEN ${ACTIVE_PREDICATE}   THEN 'Active'
        WHEN ${INACTIVE_PREDICATE} THEN 'Inactive'
        WHEN ${CLOSE_PREDICATE}    THEN 'Close'
        ELSE NULL
      END                                  AS status,
      h.close_date::text                   AS close_date,
      h.close_remark,
      h.reject_types,
      h.first_listed,
      h.blacklist_name,
      h.bl_rows,
      COUNT(*) OVER ()                      AS total
    FROM h
    WHERE ($1::text = ''
        OR h.merchant_no  ILIKE $1
        OR h.display_name ILIKE $1
        OR h.partner_no   ILIKE $1
        OR h.tax_id       ILIKE $1)
      AND ($4::text = ''
        OR ($4 = '__NULL__' AND h.state IS NULL)
        OR h.state = $4)
      AND ($5::text = ''
        OR ($5 = 'ACTIVE'   AND ${ACTIVE_PREDICATE})
        OR ($5 = 'INACTIVE' AND ${INACTIVE_PREDICATE})
        OR ($5 = 'CLOSE'    AND ${CLOSE_PREDICATE}))
    ORDER BY ${orderBy} ${dir} NULLS LAST, h.merchant_no ASC
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
    return NextResponse.json({
      rows,
      total,
      page,
      pageSize,
      sortBy: sortByRaw,
      sortDir: dir.toLowerCase(),
      state: stateRaw,
      status: statusRaw,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/blacklist-merchant]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
