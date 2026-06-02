import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// blacklist_id_card holds blocked Thai citizen IDs (136K rows). The column
// name for the ID isn't documented, so we introspect information_schema and
// pick the most plausible candidate at request time. Same for the optional
// "reason" / "added at" columns.
//
// We join blacklist hits against:
//   - merchant_personal_info.citizen_id (the person attached to a merchant)
// Then roll up to merchant_info so the page can show MID / company / partner.
//
// Both joined tables are tiny (merchant_personal_info ~1.5K rows,
// blacklist_id_card ~136K), so this is a safe live query.

const COLUMNS_SQL = `
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'blacklist_id_card'
ORDER BY ordinal_position;
`;

type ColumnMeta = { column_name: string; data_type: string; udt_name: string };

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function pickColumn(cols: ColumnMeta[], candidates: string[]): string | null {
  for (const c of candidates) {
    const found = cols.find(
      (col) => col.column_name.toLowerCase() === c.toLowerCase(),
    );
    if (found) return found.column_name;
  }
  return null;
}

function pickByPattern(cols: ColumnMeta[], pattern: RegExp): string | null {
  const found = cols.find((c) => pattern.test(c.column_name.toLowerCase()));
  return found?.column_name ?? null;
}

export async function GET() {
  try {
    const pool = getPool();
    const colsRes = await pool.query<ColumnMeta>(COLUMNS_SQL);
    const cols = colsRes.rows;

    if (cols.length === 0) {
      return NextResponse.json(
        { error: "Table `blacklist_id_card` not found in public schema." },
        { status: 500 },
      );
    }

    // The ID column — most likely names first; fall back to anything matching
    // /(citizen|id_card|card_no|card_number|national)/.
    const idCol =
      pickColumn(cols, [
        "id_card",
        "id_card_no",
        "card_no",
        "card_number",
        "citizen_id",
        "national_id",
        "value",
      ]) ?? pickByPattern(cols, /(citizen|id.?card|card.?no|national)/);

    if (!idCol) {
      return NextResponse.json(
        {
          error:
            "Could not identify the ID column on blacklist_id_card. Columns found: " +
            cols.map((c) => c.column_name).join(", "),
          schema: cols.map((c) => c.column_name),
        },
        { status: 500 },
      );
    }

    const reasonCol =
      pickColumn(cols, ["reason", "remark", "note", "description", "source"]);
    const addedCol =
      pickColumn(cols, [
        "created_date",
        "create_date",
        "added_date",
        "blocked_date",
        "block_date",
      ]) ?? pickByPattern(cols, /(date|time)$/);
    const enabledCol = pickColumn(cols, ["enabled", "active", "is_active"]);

    // Match key = trimmed digits-only of the blacklist ID equals the trimmed
    // citizen_id on merchant_personal_info. The data is supposed to be Thai
    // 13-digit IDs, but we defensively REGEXP-strip non-digits so a hyphenated
    // form still matches its raw counterpart.
    const SQL = `
      WITH bl AS (
        SELECT
          b.${quoteIdent(idCol)}::text                                            AS raw_id,
          REGEXP_REPLACE(COALESCE(b.${quoteIdent(idCol)}::text, ''), '[^0-9]', '', 'g')  AS clean_id
          ${reasonCol ? `, b.${quoteIdent(reasonCol)}::text AS reason` : ", NULL::text AS reason"}
          ${addedCol ? `, b.${quoteIdent(addedCol)}::text AS added_at` : ", NULL::text AS added_at"}
          ${enabledCol ? `, b.${quoteIdent(enabledCol)} AS enabled` : ", TRUE AS enabled"}
        FROM blacklist_id_card b
        ${enabledCol ? `WHERE b.${quoteIdent(enabledCol)} IS NOT FALSE` : ""}
      ),
      ppl AS (
        SELECT
          mpi.id                                                              AS personal_id,
          mpi.merchant_id,
          mpi.full_name_th,
          mpi.full_name_en,
          mpi.citizen_id,
          REGEXP_REPLACE(COALESCE(mpi.citizen_id, ''), '[^0-9]', '', 'g')      AS clean_id,
          mpi.is_authorize,
          mpi.is_director,
          mpi.is_contact_person
        FROM merchant_personal_info mpi
        WHERE mpi.citizen_id IS NOT NULL
          AND TRIM(mpi.citizen_id) <> ''
      )
      SELECT
        ppl.personal_id,
        ppl.merchant_id,
        ppl.citizen_id,
        ppl.full_name_th,
        ppl.full_name_en,
        ppl.is_authorize,
        ppl.is_director,
        ppl.is_contact_person,
        mi.merchant_no,
        mi.company_name_en,
        mi.company_name_th,
        mi.person_type,
        mi.state                                                              AS merchant_state,
        mi.enabled                                                            AS merchant_enabled,
        mi.close_date::text                                                   AS merchant_close_date,
        pi.partner_no,
        bl.raw_id                                                             AS blacklist_id,
        bl.reason                                                             AS blacklist_reason,
        bl.added_at                                                           AS blacklist_added_at
      FROM bl
      JOIN ppl ON ppl.clean_id = bl.clean_id AND length(bl.clean_id) > 0
      LEFT JOIN merchant_info mi ON mi.id = ppl.merchant_id
      LEFT JOIN partner_info  pi ON pi.id = mi.partner_id
      ORDER BY mi.state = 'APPROVE' DESC,
               mi.enabled DESC NULLS LAST,
               mi.merchant_no ASC NULLS LAST;
    `;

    const SUMMARY_SQL = `
      WITH bl AS (
        SELECT REGEXP_REPLACE(COALESCE(b.${quoteIdent(idCol)}::text, ''), '[^0-9]', '', 'g') AS clean_id
        FROM blacklist_id_card b
        ${enabledCol ? `WHERE b.${quoteIdent(enabledCol)} IS NOT FALSE` : ""}
      ),
      ppl AS (
        SELECT
          mpi.merchant_id,
          REGEXP_REPLACE(COALESCE(mpi.citizen_id, ''), '[^0-9]', '', 'g') AS clean_id
        FROM merchant_personal_info mpi
        WHERE mpi.citizen_id IS NOT NULL
          AND TRIM(mpi.citizen_id) <> ''
      ),
      hit AS (
        SELECT DISTINCT ppl.merchant_id
        FROM bl
        JOIN ppl ON ppl.clean_id = bl.clean_id AND length(bl.clean_id) > 0
      )
      SELECT
        (SELECT COUNT(*)::int FROM bl) AS blacklist_size,
        (SELECT COUNT(*)::int FROM ppl) AS persons_total,
        COUNT(DISTINCT hit.merchant_id)::int AS merchants_hit,
        COUNT(DISTINCT hit.merchant_id) FILTER (
          WHERE EXISTS (SELECT 1 FROM merchant_info mi
                        WHERE mi.id = hit.merchant_id AND mi.state = 'APPROVE'
                          AND mi.close_date IS NULL)
        )::int AS live_merchants_hit
      FROM hit;
    `;

    const [rowsRes, summaryRes] = await Promise.all([
      pool.query(SQL),
      pool.query(SUMMARY_SQL),
    ]);

    return NextResponse.json({
      schema: {
        columns: cols.map((c) => c.column_name),
        idColumn: idCol,
        reasonColumn: reasonCol,
        addedColumn: addedCol,
        enabledColumn: enabledCol,
      },
      summary: summaryRes.rows[0] ?? {
        blacklist_size: 0,
        persons_total: 0,
        merchants_hit: 0,
        live_merchants_hit: 0,
      },
      rows: rowsRes.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/blacklist-hits]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
