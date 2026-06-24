import { NextResponse } from "next/server";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { getPool } from "@/lib/db";
import { groupForPartner, VAT_RATE } from "@/lib/finance/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Finance settlement report — pulled live from the read replica.
//
// A day's report combines two flows:
//   • PAYMENT  — payment_transaction rows whose settle_due = <day> (status 'S')
//   • TRANSFER — transfer_transaction rows whose transfer_date is on <day>
// Counts/amounts are the union of both. Verified against the daily exports
// (Transaction_All / Transaction_Transfer): for 2026-06-23 this reproduces
// 546,626 txn / 360,570,469.68 gross / 356,923,156.49 net to the cent.
//
// Performance notes (the replica has no FK indexes we can add):
//   • payment uses index pt_generate_summary(status, settle_due)        → ~1s
//   • transfer has NO (status, transfer_date) index, so we drive off the
//     indexed (create_date, status) with a ±2-day create_date window and then
//     filter exactly on transfer_date. A transfer's create_date is always the
//     same calendar day (±1) as its transfer_date, so the window is safe.
//     This turns a 109s seq-scan into ~0.5s.
//   • commission_fee_partner lives only in transaction_commission, which has
//     no ptx_id/transfer_id index → one unavoidable ~12s scan, done once for
//     both flows via a single hash-join pass.
// Past days are immutable once settled, so results are cached per date.
// ---------------------------------------------------------------------------

const QUERY_TIMEOUT_MS = 90_000;
const CACHE_MAX = 90;

type PartnerAgg = {
  partner_no: string;
  txn: number;
  gross: number;
  fee: number;
  net: number;
  bank_cost: number;
};

type CommissionRow = {
  pay_partner: number;
  trf_partner: number;
  pay_anypay: number;
  trf_anypay: number;
};

type FlowTotals = { txn: number; gross: number; fee: number; net: number };

type PartnerOut = {
  partner_no: string;
  group: string;
  txn: number;
  gross: number;
  fee: number;
  net: number;
};

type ReportResponse = {
  date: string;
  payment: FlowTotals;
  transfer: FlowTotals;
  summary: FlowTotals;
  agencyCommission: number;
  anypayShare: number;
  bankCost: number;
  totalCost: number;
  grossProfit: number;
  byPartner: PartnerOut[];
  byGroup: { group: string; txn: number; net: number }[];
  cached: boolean;
  elapsedMs: number;
};

// --- per-date cache (survives dev hot-reload like the pg pool does) ---------
type CacheEntry = { data: ReportResponse; at: number };
const globalForCache = globalThis as unknown as {
  __financeReportCache?: Map<string, CacheEntry>;
};
const cache = (globalForCache.__financeReportCache ??= new Map<string, CacheEntry>());

// Bank (acquirer) cost per transaction, keyed on the gateway channel
// (gateway_channel.merchant_id, reached via gwc_id). These mirror the
// 'cost in' / 'cost out' calculated columns in the finance Power BI model
// (2026 June.pbip) exactly — verified to reproduce 989,755.09 for 2026-06-23.
// Constants only (no user input), so inlining them in the CASE is safe.
const COST_IN_SQL = `CASE
         WHEN gc.merchant_id IN
           ('010555915430964','010555915430959','010555915430960',
            '010555915430962','010555915430963','010555915430967') THEN 2
         WHEN gc.merchant_id = '010555915430956' THEN 1
         WHEN gc.merchant_id IN ('010555915430961','010555915430968')
           THEN (CASE WHEN t.amount > 150 THEN 0.01 * t.amount ELSE 1.5 END)
         ELSE 0 END`;
const COST_OUT_SQL = `CASE WHEN gc.merchant_id = '010555915430956' THEN 5 ELSE 3.50 END`;

const PARTNER_AGG_HEAD = `
       COALESCE(pi.partner_no, '(unknown)')                       AS partner_no,
       count(*)::int                                              AS txn,
       (sum(t.amount))::float8                                    AS gross,
       (sum(t.fee))::float8                                       AS fee,
       (sum(t.amount) - sum(t.fee) * (1 + $2::numeric))::float8   AS net`;

const PAYMENT_SQL = `
  SELECT ${PARTNER_AGG_HEAD},
         (sum(${COST_IN_SQL}))::float8                            AS bank_cost
    FROM payment_transaction t
    LEFT JOIN merchant_info   mi ON mi.id = t.merchant_id
    LEFT JOIN partner_info    pi ON pi.id = mi.partner_id
    LEFT JOIN gateway_channel gc ON gc.id = t.gwc_id
   WHERE t.status = 'S' AND t.settle_due = $1::date
   GROUP BY 1`;

const TRANSFER_SQL = `
  SELECT ${PARTNER_AGG_HEAD},
         (sum(${COST_OUT_SQL}))::float8                           AS bank_cost
    FROM transfer_transaction t
    LEFT JOIN merchant_info   mi ON mi.id = t.merchant_id
    LEFT JOIN partner_info    pi ON pi.id = mi.partner_id
    LEFT JOIN gateway_channel gc ON gc.id = t.gwc_id
   WHERE t.status = 'S'
     AND t.create_date  >= $1::timestamp - INTERVAL '2 days'
     AND t.create_date  <  $1::timestamp + INTERVAL '2 days'
     AND t.transfer_date >= $1::timestamp
     AND t.transfer_date <  $1::timestamp + INTERVAL '1 day'
   GROUP BY 1`;

const COMMISSION_SQL = `
  WITH pay AS (
    SELECT id FROM payment_transaction
     WHERE status = 'S' AND settle_due = $1::date
  ),
  trf AS (
    SELECT id FROM transfer_transaction
     WHERE status = 'S'
       AND create_date  >= $1::timestamp - INTERVAL '2 days'
       AND create_date  <  $1::timestamp + INTERVAL '2 days'
       AND transfer_date >= $1::timestamp
       AND transfer_date <  $1::timestamp + INTERVAL '1 day'
  )
  SELECT
    COALESCE(sum(tc.commission_fee_partner) FILTER (WHERE p.id IS NOT NULL), 0)::float8 AS pay_partner,
    COALESCE(sum(tc.commission_fee_partner) FILTER (WHERE t.id IS NOT NULL), 0)::float8 AS trf_partner,
    COALESCE(sum(tc.commission_fee_anypay)  FILTER (WHERE p.id IS NOT NULL), 0)::float8 AS pay_anypay,
    COALESCE(sum(tc.commission_fee_anypay)  FILTER (WHERE t.id IS NOT NULL), 0)::float8 AS trf_anypay
  FROM transaction_commission tc
  LEFT JOIN pay p ON p.id = tc.ptx_id
  LEFT JOIN trf t ON t.id = tc.transfer_id
  WHERE p.id IS NOT NULL OR t.id IS NOT NULL`;

// Run one read query with a scoped statement_timeout so a stray scan can't pin
// a pooled connection forever. SET LOCAL is transaction-scoped, so it resets on
// release.
async function timedQuery<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}`);
    const res = await client.query<T>(sql, params);
    await client.query("COMMIT");
    return res.rows;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

function totalsOf(rows: PartnerAgg[]): FlowTotals {
  return rows.reduce<FlowTotals>(
    (acc, r) => ({
      txn: acc.txn + r.txn,
      gross: acc.gross + r.gross,
      fee: acc.fee + r.fee,
      net: acc.net + r.net,
    }),
    { txn: 0, gross: 0, fee: 0, net: 0 },
  );
}

function bangkokYesterday(): string {
  // DB stores Bangkok wall-clock; "today" in BKK = UTC+7. Latest fully settled
  // day is yesterday.
  const bkkNow = new Date(Date.now() + 7 * 3_600_000);
  bkkNow.setUTCDate(bkkNow.getUTCDate() - 1);
  return bkkNow.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? bangkokYesterday();
  const refresh = url.searchParams.get("refresh") === "1";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Invalid date — expected YYYY-MM-DD." },
      { status: 400 },
    );
  }

  if (!refresh) {
    const hit = cache.get(date);
    if (hit) {
      return NextResponse.json({ ...hit.data, cached: true });
    }
  }

  const startedAt = Date.now();
  try {
    const pool = getPool();
    const [paymentRows, transferRows, commissionRows] = await Promise.all([
      timedQuery<PartnerAgg>(pool, PAYMENT_SQL, [date, VAT_RATE]),
      timedQuery<PartnerAgg>(pool, TRANSFER_SQL, [date, VAT_RATE]),
      timedQuery<CommissionRow>(pool, COMMISSION_SQL, [date]),
    ]);

    // Merge payment + transfer per partner.
    const byPartnerMap = new Map<string, PartnerOut>();
    const merge = (rows: PartnerAgg[]) => {
      for (const r of rows) {
        const cur =
          byPartnerMap.get(r.partner_no) ??
          {
            partner_no: r.partner_no,
            group: groupForPartner(r.partner_no),
            txn: 0,
            gross: 0,
            fee: 0,
            net: 0,
          };
        cur.txn += r.txn;
        cur.gross += r.gross;
        cur.fee += r.fee;
        cur.net += r.net;
        byPartnerMap.set(r.partner_no, cur);
      }
    };
    merge(paymentRows);
    merge(transferRows);

    const byPartner = [...byPartnerMap.values()].sort((a, b) => b.net - a.net);

    const groupMap = new Map<string, { group: string; txn: number; net: number }>();
    for (const p of byPartner) {
      const g = groupMap.get(p.group) ?? { group: p.group, txn: 0, net: 0 };
      g.txn += p.txn;
      g.net += p.net;
      groupMap.set(p.group, g);
    }
    const byGroup = [...groupMap.values()].sort((a, b) => b.net - a.net);

    const payment = totalsOf(paymentRows);
    const transfer = totalsOf(transferRows);
    const summary: FlowTotals = {
      txn: payment.txn + transfer.txn,
      gross: payment.gross + transfer.gross,
      fee: payment.fee + transfer.fee,
      net: payment.net + transfer.net,
    };

    const c = commissionRows[0] ?? {
      pay_partner: 0,
      trf_partner: 0,
      pay_anypay: 0,
      trf_anypay: 0,
    };

    const agencyCommission = c.pay_partner + c.trf_partner;
    const bankCost =
      paymentRows.reduce((a, r) => a + r.bank_cost, 0) +
      transferRows.reduce((a, r) => a + r.bank_cost, 0);
    const totalCost = bankCost + agencyCommission;
    const grossProfit = summary.fee - totalCost;

    const data: ReportResponse = {
      date,
      payment,
      transfer,
      summary,
      agencyCommission,
      anypayShare: c.pay_anypay + c.trf_anypay,
      bankCost,
      totalCost,
      grossProfit,
      byPartner,
      byGroup,
      cached: false,
      elapsedMs: Date.now() - startedAt,
    };

    cache.set(date, { data, at: Date.now() });
    if (cache.size > CACHE_MAX) {
      // drop the oldest entry
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/finance/report]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
