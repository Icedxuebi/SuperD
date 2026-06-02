import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Three small period tables drive the KYC/KYM/CDD review cycle:
//   - merchant_kym_period           (~1,366 rows)  — at the merchant level
//   - merchant_personal_kyc_period  (~1,282 rows)  — per merchant person
//   - merchant_personal_cdd_period  (~1,342 rows)  — per merchant person
//
// The columns are not documented in docs/dbinfo.md beyond the description:
// "Multi-period compliance review cycle ... operation, risk, and manager
// sign-off columns per period". We introspect information_schema for each
// table at request time, then build a query that returns all native columns
// plus joined merchant context (under "_"-prefixed alias names).
//
// The page receives the raw rows + the discovered schemas and renders a
// unified view. Identifying which role columns are present is done client
// side so we don't have to re-deploy the API when a column is added.

const COLUMNS_SQL = `
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = $1
ORDER BY ordinal_position;
`;

type ColumnMeta = { column_name: string; data_type: string; udt_name: string };

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function has(cols: ColumnMeta[], name: string): boolean {
  return cols.some((c) => c.column_name.toLowerCase() === name.toLowerCase());
}

async function fetchForm(
  pool: ReturnType<typeof getPool>,
  table: string,
  form: "KYM" | "KYC" | "CDD",
) {
  const colsRes = await pool.query<ColumnMeta>(COLUMNS_SQL, [table]);
  const cols = colsRes.rows;
  if (cols.length === 0) {
    return { form, table, columns: [] as string[], rows: [] as Record<string, unknown>[] };
  }

  const hasMerchant = has(cols, "merchant_id");
  const hasPersonal = has(cols, "merchant_personal_id");

  // Build the merchant-context joins depending on which FK is present. KYM is
  // typically per-merchant; KYC/CDD are typically per-person.
  let mainJoin = "";
  if (hasMerchant) {
    mainJoin = `
      LEFT JOIN merchant_info mi ON mi.id = t.merchant_id
      LEFT JOIN partner_info  pi ON pi.id = mi.partner_id
    `;
  } else if (hasPersonal) {
    mainJoin = `
      LEFT JOIN merchant_personal_info mpi ON mpi.id = t.merchant_personal_id
      LEFT JOIN merchant_info mi ON mi.id = mpi.merchant_id
      LEFT JOIN partner_info  pi ON pi.id = mi.partner_id
    `;
  }

  const personalSelect = hasPersonal
    ? `mpi.full_name_th AS "_person_th", mpi.full_name_en AS "_person_en",`
    : "";

  // Filtering rules (applied only when we have a merchant_info join):
  //   1. Closed merchants — once close_date is set, the merchant is off-platform.
  //   2. Fully-approved merchants on KYM/KYC — merchant_info.state = 'APPROVE'
  //      means onboarding has finished and the KYM/KYC has already passed,
  //      so they don't need to appear in the review tracker. CDD is a
  //      recurring obligation and keeps showing approved merchants.
  // IS DISTINCT FROM treats NULL as not-equal so orphan rows (no merchant
  // join) pass through unchanged.
  const conditions: string[] = [];
  if (mainJoin) {
    conditions.push("mi.close_date IS NULL");
    if (form === "KYM" || form === "KYC") {
      conditions.push("mi.state IS DISTINCT FROM 'APPROVE'");
    }
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Display name falls back through: registered company name → merchant /
  // trade name → null. For prospects still in PRE_APPROVE_* / BUSINESS_APPROVE
  // the company_name_* columns are usually blank but merchant_name_* (brand
  // name) is populated — without this coalesce the page shows blank cells.
  const SQL = `
    SELECT
      t.*,
      mi.id                                           AS "_merchant_id",
      mi.merchant_no                                  AS "_merchant_no",
      COALESCE(
        mi.company_name_en, mi.company_name_th,
        mi.merchant_name_en, mi.merchant_name_th
      )                                                AS "_merchant_company",
      mi.state                                        AS "_merchant_state",
      mi.enabled                                      AS "_merchant_enabled",
      mi.close_date::text                             AS "_merchant_close_date",
      pi.partner_no                                   AS "_partner_no",
      ${personalSelect}
      '${form}' :: text                               AS "_form"
    FROM ${quoteIdent(table)} t
    ${mainJoin}
    ${whereClause}
    ORDER BY t.id DESC
  `;

  const rowsRes = await pool.query(SQL);

  return {
    form,
    table,
    columns: cols.map((c) => c.column_name),
    rows: rowsRes.rows as Record<string, unknown>[],
  };
}

export async function GET() {
  try {
    const pool = getPool();
    const [kym, kyc, cdd] = await Promise.all([
      fetchForm(pool, "merchant_kym_period", "KYM"),
      fetchForm(pool, "merchant_personal_kyc_period", "KYC"),
      fetchForm(pool, "merchant_personal_cdd_period", "CDD"),
    ]);

    const total = kym.rows.length + kyc.rows.length + cdd.rows.length;

    return NextResponse.json({
      summary: {
        kym_rows: kym.rows.length,
        kyc_rows: kyc.rows.length,
        cdd_rows: cdd.rows.length,
        total_rows: total,
      },
      forms: { kym, kyc, cdd },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/kyc-cdd-review]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
