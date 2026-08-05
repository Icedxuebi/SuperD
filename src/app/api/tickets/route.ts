import { NextResponse } from "next/server";
import { getPool, getTicketPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
// Whole table is <10k rows, so one export request can always cover everything.
const EXPORT_LIMIT = 20_000;

// Whitelist — the request's sortBy never reaches SQL directly.
const SORT_COLUMNS: Record<string, string> = {
  id: "ci.id",
  contract_no: "ci.contract_no",
  status: "ci.status",
  main_section: "md_main.name_en",
  sub_section: "md_sub.name_en",
  owner_role: "md_sub.role",
  create_by: "ci.create_by",
  create_date: "ci.create_date",
  update_by: "ci.update_by",
  success_date: "ci.success_date",
  resolve_days: "(ci.success_date - ci.create_date)",
  attachments: "af.n",
};

const FROM_AND_JOINS = `
FROM case_info ci
LEFT JOIN master_data md_main
       ON md_main.id = ci.main_id AND md_main.key1 = 'MAIN_SECTION'
LEFT JOIN master_data md_sub
       ON md_sub.id = ci.sub_id
`;

// Role names and attachment counts, pre-aggregated once and hash-joined, rather
// than a per-row LATERAL. The LATERAL form has to run the case_info_file
// aggregate for every candidate row *before* ORDER BY/LIMIT can discard them —
// 9.5k sequential scans of an 8k-row table, which measured 6.6s per request
// against 38ms for this shape. Neither table has an index on the join column.
const ROW_ONLY_JOINS = `
LEFT JOIN (
    SELECT master_data_id, string_agg(DISTINCT role, ', ') AS roles
      FROM role_config
     GROUP BY master_data_id
) rcf ON rcf.master_data_id = ci.sub_id
LEFT JOIN (
    SELECT case_info_id, COUNT(*)::int AS n
      FROM case_info_file
     WHERE COALESCE(enabled, TRUE)
     GROUP BY case_info_id
) af ON af.case_info_id = ci.id
`;

type Filters = { conds: string[]; params: unknown[] };

function buildFilters(sp: URLSearchParams): Filters {
  const conds: string[] = [];
  const params: unknown[] = [];
  // Registers a value and returns its positional placeholder.
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  const q = (sp.get("q") ?? "").trim();
  if (q) {
    // One placeholder reused across the OR arms — capture it, don't re-call p().
    const like = p(`%${q}%`);
    conds.push(
      `(ci.contract_no ILIKE ${like}
        OR ci.create_by ILIKE ${like}
        OR ci.update_by ILIKE ${like}
        OR ci.detail    ILIKE ${like}
        OR ci.id::text  LIKE ${like})`,
    );
  }

  const status = (sp.get("status") ?? "").trim();
  if (status) conds.push(`ci.status = ${p(status)}`);

  const mainId = (sp.get("mainId") ?? "").trim();
  if (mainId) conds.push(`ci.main_id = ${p(mainId)}::bigint`);

  const subId = (sp.get("subId") ?? "").trim();
  if (subId) conds.push(`ci.sub_id = ${p(subId)}::bigint`);

  // Role ownership is not stored on the ticket — it is derived through the
  // ticket's sub-section (docs/ticketdb.md), and one sub-section can be handled
  // by several roles, so this is an EXISTS rather than an equality test.
  const role = (sp.get("role") ?? "").trim();
  if (role) {
    // Alias rc0, not rcf — the row query already binds rcf at the outer level.
    conds.push(
      `EXISTS (SELECT 1 FROM role_config rc0
                WHERE rc0.master_data_id = ci.sub_id AND rc0.role = ${p(role)})`,
    );
  }

  const from = (sp.get("from") ?? "").trim();
  if (from) conds.push(`ci.create_date >= ${p(from)}::date`);

  const to = (sp.get("to") ?? "").trim();
  // Inclusive of the whole end day.
  if (to) conds.push(`ci.create_date < (${p(to)}::date + 1)`);

  return { conds, params };
}

function whereClause(conds: string[]): string {
  return conds.length ? `WHERE ${conds.join("\n  AND ")}` : "";
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const full = sp.get("full") === "1";

  const sortBy = SORT_COLUMNS[sp.get("sortBy") ?? ""] ? sp.get("sortBy")! : "create_date";
  const sortDir = sp.get("sortDir") === "asc" ? "ASC" : "DESC";

  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(sp.get("pageSize")) || DEFAULT_PAGE_SIZE),
  );
  const page = Math.max(1, Number(sp.get("page")) || 1);

  const { conds, params } = buildFilters(sp);
  const where = whereClause(conds);

  // Ordered by the requested column, then by id so equal keys keep a stable
  // page boundary (NULLs — e.g. unresolved tickets have no success_date —
  // always sort last regardless of direction).
  const rowsSql = `
SELECT
    ci.id::text                                 AS id,
    ci.contract_no                              AS contract_no,
    ci.merchant_id::text                        AS merchant_id,
    ci.status                                   AS status,
    ci.detail                                   AS detail,
    ci.create_by                                AS create_by,
    ci.create_date                              AS create_date,
    ci.update_by                                AS update_by,
    ci.update_date                              AS update_date,
    ci.success_date                             AS success_date,
    ci.main_id::text                            AS main_id,
    md_main.name_en                             AS main_section,
    md_main.name_th                             AS main_section_th,
    ci.sub_id::text                             AS sub_id,
    md_sub.name_en                              AS sub_section,
    md_sub.name_th                              AS sub_section_th,
    md_sub.role                                 AS owner_role,
    md_sub.email_to                             AS owner_email,
    rcf.roles                                   AS handler_roles,
    af.n                                        AS attachments,
    (EXTRACT(EPOCH FROM (ci.success_date - ci.create_date)) / 86400)::float8 AS resolve_days
${FROM_AND_JOINS}
${ROW_ONLY_JOINS}
${where}
ORDER BY ${SORT_COLUMNS[sortBy]} ${sortDir} NULLS LAST, ci.id DESC
LIMIT ${full ? EXPORT_LIMIT : pageSize}${full ? "" : ` OFFSET ${(page - 1) * pageSize}`}
`;

  // Same filters as the table, so the KPI row always describes what is on screen.
  const statsSql = `
SELECT
    COUNT(*)::int                                        AS total,
    COUNT(*) FILTER (WHERE ci.status = 'CREATE')::int    AS open,
    COUNT(*) FILTER (WHERE ci.status = 'APPROVE')::int   AS approve,
    COUNT(*) FILTER (WHERE ci.status = 'REJECT')::int    AS reject,
    COUNT(DISTINCT ci.contract_no)::int                  AS merchants,
    AVG(EXTRACT(EPOCH FROM (ci.success_date - ci.create_date)) / 86400)::float8 AS avg_resolve_days,
    (percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (ci.success_date - ci.create_date)) / 86400
    ))::float8                                           AS median_resolve_days
${FROM_AND_JOINS}
${where}
`;

  const byTypeSql = `
SELECT
    md_main.name_en                                   AS section,
    md_sub.name_en                                    AS name,
    md_sub.role                                       AS role,
    COUNT(*)::int                                     AS n,
    COUNT(*) FILTER (WHERE ci.status = 'CREATE')::int AS open
${FROM_AND_JOINS}
${where}
GROUP BY md_main.name_en, md_sub.name_en, md_sub.role
ORDER BY n DESC
`;

  // Filter dropdown options. `SUB_SECTION_<n>` hangs off MAIN_SECTION id <n>,
  // so the type list can be narrowed to the chosen section in the UI.
  const facetMainSql = `
SELECT id::text AS id, name_en, name_th
  FROM master_data
 WHERE key1 = 'MAIN_SECTION' AND enabled
 ORDER BY key2
`;
  const facetSubSql = `
SELECT id::text                                        AS id,
       substring(key1 from 'SUB_SECTION_([0-9]+)')::int AS main_id,
       name_en, name_th, role, email_to, attach_file
  FROM master_data
 WHERE key1 ~ '^SUB_SECTION_[0-9]+$' AND enabled
 ORDER BY main_id, key2
`;

  try {
    const ticketPool = getTicketPool();

    const [rowsRes, statsRes, byTypeRes, mainRes, subRes] = await Promise.all([
      ticketPool.query(rowsSql, params),
      ticketPool.query(statsSql, params),
      ticketPool.query(byTypeSql, params),
      ticketPool.query(facetMainSql),
      ticketPool.query(facetSubSql),
    ]);

    const rows = rowsRes.rows as Record<string, unknown>[];
    const ids = rows.map((r) => r.id as string);

    // Child rows for the expandable panel — skipped for exports, which are flat.
    let details: Record<string, unknown>[] = [];
    let files: Record<string, unknown>[] = [];
    if (!full && ids.length > 0) {
      const [detailRes, fileRes] = await Promise.all([
        ticketPool.query(
          `SELECT case_info_id::text AS case_info_id, key, value1, value2
             FROM case_info_detail
            WHERE case_info_id = ANY($1::bigint[])
            ORDER BY id`,
          [ids],
        ),
        ticketPool.query(
          `SELECT case_info_id::text AS case_info_id, file_name, file_name_original,
                  file_path, file_type, create_date
             FROM case_info_file
            WHERE case_info_id = ANY($1::bigint[]) AND COALESCE(enabled, TRUE)
            ORDER BY id`,
          [ids],
        ),
      ]);
      details = detailRes.rows;
      files = fileRes.rows;
    }

    // Cross-database merchant enrichment (docs/ticketdb.md: no SQL join is
    // possible between the two instances). Best-effort — if the main DB is
    // unreachable the ticket list still renders, just without merchant names.
    const merchants: Record<string, { name: string | null; state: string | null }> = {};
    let merchantLookupError: string | null = null;
    if (rows.length > 0) {
      const mids = [...new Set(rows.map((r) => r.contract_no).filter(Boolean))] as string[];
      // 15 tickets carry no contract_no but do carry merchant_id, so match on both.
      const internalIds = [
        ...new Set(rows.filter((r) => !r.contract_no).map((r) => r.merchant_id).filter(Boolean)),
      ] as string[];
      if (mids.length > 0 || internalIds.length > 0) {
        try {
          const res = await getPool().query(
            `SELECT id::text AS id, merchant_no, merchant_name_en, state
               FROM merchant_info
              WHERE merchant_no = ANY($1::text[]) OR id = ANY($2::bigint[])`,
            [mids, internalIds],
          );
          for (const m of res.rows) {
            const entry = { name: m.merchant_name_en ?? null, state: m.state ?? null };
            if (m.merchant_no) merchants[m.merchant_no] = entry;
            if (m.id) merchants[`#${m.id}`] = entry;
          }
        } catch (err) {
          merchantLookupError = err instanceof Error ? err.message : "Merchant lookup failed";
          console.error("[/api/tickets] merchant enrichment", err);
        }
      }
    }

    // total: for a page request re-count under the same filters; for an export
    // the row set is already everything, so stats.total is authoritative.
    const stats = statsRes.rows[0] ?? {};

    return NextResponse.json({
      rows,
      details,
      files,
      merchants,
      merchantLookupError,
      total: stats.total ?? 0,
      page,
      pageSize,
      sortBy,
      sortDir: sortDir === "ASC" ? "asc" : "desc",
      stats,
      byType: byTypeRes.rows,
      facets: { mainSections: mainRes.rows, subSections: subRes.rows },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/tickets]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
