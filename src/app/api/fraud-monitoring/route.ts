import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// transaction_fraud_monitoring is documented as "Fraud alerts per transaction"
// in docs/dbinfo.md, with FK columns ptx_id → payment_transaction.id and
// transfer_transaction_id → transfer_transaction.id, but the rest of its
// columns are not catalogued.
//
// Strategy: introspect the schema at request time via information_schema,
// then build a SELECT * over tfm joined to payment_transaction /
// transfer_transaction / merchant_info / partner_info for context. We sniff
// for a date-typed column to drive the window filter and grouping; if none
// is found we fall back to using tfm.id ordering and skip the time-series
// chart on the page.

const COLUMNS_SQL = `
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'transaction_fraud_monitoring'
ORDER BY ordinal_position;
`;

type ColumnMeta = { column_name: string; data_type: string; udt_name: string };

function pickDateColumn(cols: ColumnMeta[]): string | null {
  // Prefer a clearly fraud-event-named column first, then any timestamp/date.
  const preferred = ["alert_date", "created_date", "create_date", "detected_date", "monitoring_date", "report_date"];
  const byName = cols.find((c) => preferred.includes(c.column_name.toLowerCase()));
  if (byName) return byName.column_name;
  return (
    cols.find((c) =>
      c.data_type.startsWith("timestamp") || c.data_type === "date",
    )?.column_name ?? null
  );
}

function pickColumn(cols: ColumnMeta[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const found = cols.find((c) => c.column_name.toLowerCase() === candidate.toLowerCase());
    if (found) return found.column_name;
  }
  return null;
}

function quoteIdent(name: string): string {
  // PG identifier quoting — escape internal quotes by doubling them. Defensive
  // even though information_schema names are already trustworthy.
  return `"${name.replace(/"/g, '""')}"`;
}

function parseDate(s: string | null, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s + "T00:00:00");
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function fmtTs(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    defaultFrom.setHours(0, 0, 0, 0);

    let from = parseDate(url.searchParams.get("from"), defaultFrom);
    let to = parseDate(url.searchParams.get("to"), now);

    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > ninetyDaysMs) {
      from = new Date(to.getTime() - ninetyDaysMs);
    }
    if (from >= to) {
      return NextResponse.json(
        { error: "Invalid date range — 'from' must be earlier than 'to'." },
        { status: 400 },
      );
    }

    const fromStr = fmtTs(from);
    const toStr = fmtTs(to);

    const pool = getPool();
    const colsRes = await pool.query<ColumnMeta>(COLUMNS_SQL);
    const cols = colsRes.rows;

    if (cols.length === 0) {
      return NextResponse.json({
        error:
          "Table `transaction_fraud_monitoring` not found in public schema. " +
          "Check the schema name or the table existence.",
      }, { status: 500 });
    }

    const dateCol = pickDateColumn(cols);
    const ruleCol = pickColumn(cols, ["rule_name", "rule", "rule_id", "type", "category", "monitoring_type"]);
    const severityCol = pickColumn(cols, ["severity", "level", "risk_level", "score"]);
    const merchantCol = pickColumn(cols, ["merchant_id"]);
    const ptxCol = pickColumn(cols, ["ptx_id"]);
    const transferCol = pickColumn(cols, ["transfer_transaction_id", "transfer_id"]);

    const tfmDateExpr = dateCol ? `tfm.${quoteIdent(dateCol)}` : null;
    const tfmRuleExpr = ruleCol ? `tfm.${quoteIdent(ruleCol)}` : null;

    // Window filter — if we have a date column, use it; otherwise we return
    // the most-recent N rows ordered by id, ignoring the from/to params.
    const whereWindow = tfmDateExpr
      ? `WHERE ${tfmDateExpr} >= $1::timestamp AND ${tfmDateExpr} < $2::timestamp`
      : "";
    const windowParams = tfmDateExpr ? [fromStr, toStr] : [];

    // Merchant resolution falls through tfm.merchant_id → pt.merchant_id →
    // tt.merchant_id depending on which FK populated the alert row.
    const merchantJoinExpr = `COALESCE(${[
      merchantCol ? `tfm.${quoteIdent(merchantCol)}` : null,
      ptxCol ? `pt.merchant_id` : null,
      transferCol ? `tt.merchant_id` : null,
    ]
      .filter(Boolean)
      .join(", ")})`;

    const joins = `
      ${ptxCol ? `LEFT JOIN payment_transaction pt ON pt.id = tfm.${quoteIdent(ptxCol)}` : ""}
      ${transferCol ? `LEFT JOIN transfer_transaction tt ON tt.id = tfm.${quoteIdent(transferCol)}` : ""}
      LEFT JOIN merchant_info mi ON mi.id = ${merchantJoinExpr}
      LEFT JOIN partner_info  pi ON pi.id = mi.partner_id
    `;

    const summarySQL = `
      SELECT
        COUNT(*)::int                                                  AS alerts,
        COUNT(DISTINCT mi.id)::int                                     AS merchants_alerted
        ${ptxCol ? `, COUNT(DISTINCT tfm.${quoteIdent(ptxCol)})::int AS payments_alerted` : ""}
        ${transferCol ? `, COUNT(DISTINCT tfm.${quoteIdent(transferCol)})::int AS transfers_alerted` : ""}
        ${ptxCol ? `, COALESCE(SUM(pt.amount), 0)::numeric AS payment_amount_at_risk` : ""}
        ${transferCol ? `, COALESCE(SUM(tt.amount), 0)::numeric AS transfer_amount_at_risk` : ""}
      FROM transaction_fraud_monitoring tfm
      ${joins}
      ${whereWindow}
    `;

    const dailySQL = tfmDateExpr
      ? `
        SELECT
          date_trunc('day', ${tfmDateExpr})::date::text AS day,
          COUNT(*)::int                                  AS alerts
        FROM transaction_fraud_monitoring tfm
        ${whereWindow}
        GROUP BY 1
        ORDER BY 1 ASC
      `
      : null;

    const topMerchantsSQL = `
      SELECT
        mi.id                       AS merchant_id,
        mi.merchant_no,
        mi.merchant_name_en         AS merchant_name,
        pi.partner_no,
        COUNT(*)::int               AS alerts
      FROM transaction_fraud_monitoring tfm
      ${joins}
      ${whereWindow}
        ${whereWindow ? "AND" : "WHERE"} mi.id IS NOT NULL
      GROUP BY mi.id, mi.merchant_no, mi.merchant_name_en, pi.partner_no
      ORDER BY alerts DESC
      LIMIT 25
    `;

    const byRuleSQL = tfmRuleExpr
      ? `
        SELECT
          COALESCE(${tfmRuleExpr}::text, '(null)') AS rule,
          COUNT(*)::int                            AS alerts
        FROM transaction_fraud_monitoring tfm
        ${whereWindow}
        GROUP BY COALESCE(${tfmRuleExpr}::text, '(null)')
        ORDER BY alerts DESC
        LIMIT 15
      `
      : null;

    // Recent feed — return ALL tfm columns plus joined merchant context. Cap
    // at 500 so the API payload stays reasonable on noisy days.
    const recentSQL = `
      SELECT
        tfm.*,
        mi.merchant_no                                  AS _merchant_no,
        COALESCE(mi.company_name_en, mi.company_name_th) AS _merchant_company,
        pi.partner_no                                   AS _partner_no
        ${ptxCol ? `, pt.amount::numeric AS _pt_amount, pt.payment_date::text AS _pt_payment_date, pt.pay_type AS _pt_pay_type` : ""}
        ${transferCol ? `, tt.amount::numeric AS _tt_amount, tt.transfer_date::text AS _tt_transfer_date, tt.status AS _tt_status` : ""}
      FROM transaction_fraud_monitoring tfm
      ${joins}
      ${whereWindow}
      ORDER BY ${tfmDateExpr ?? "tfm.id"} DESC
      LIMIT 500
    `;

    const queries: Promise<{ rows: Record<string, unknown>[] }>[] = [
      pool.query(summarySQL, windowParams),
      pool.query(topMerchantsSQL, windowParams),
      pool.query(recentSQL, windowParams),
    ];
    if (dailySQL) queries.push(pool.query(dailySQL, windowParams));
    if (byRuleSQL) queries.push(pool.query(byRuleSQL, windowParams));

    const results = await Promise.all(queries);
    const [summaryRes, topMerchantsRes, recentRes, ...rest] = results;
    const dailyRes = dailySQL ? rest.shift() : undefined;
    const byRuleRes = byRuleSQL ? rest.shift() : undefined;

    function num(v: unknown): number {
      if (v === null || v === undefined) return 0;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    }

    const sum = summaryRes.rows[0] ?? {};
    const summary = {
      alerts: num(sum.alerts),
      merchants_alerted: num(sum.merchants_alerted),
      payments_alerted: ptxCol ? num(sum.payments_alerted) : 0,
      transfers_alerted: transferCol ? num(sum.transfers_alerted) : 0,
      payment_amount_at_risk: ptxCol ? num(sum.payment_amount_at_risk) : 0,
      transfer_amount_at_risk: transferCol ? num(sum.transfer_amount_at_risk) : 0,
    };

    return NextResponse.json({
      from: fromStr,
      to: toStr,
      schema: {
        columns: cols.map((c) => c.column_name),
        dateColumn: dateCol,
        ruleColumn: ruleCol,
        severityColumn: severityCol,
        merchantColumn: merchantCol,
        ptxColumn: ptxCol,
        transferColumn: transferCol,
      },
      summary,
      daily: dailyRes?.rows ?? [],
      byRule: byRuleRes?.rows ?? [],
      topMerchants: topMerchantsRes.rows.map((r) => ({
        merchant_id: r.merchant_id ?? null,
        merchant_no: r.merchant_no ?? null,
        merchant_name: r.merchant_name ?? null,
        partner_no: r.partner_no ?? null,
        alerts: num(r.alerts),
      })),
      recent: recentRes.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/fraud-monitoring]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
