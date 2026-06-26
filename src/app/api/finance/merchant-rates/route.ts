import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Per-channel rate sheet for OPEN merchants (mi.close_date IS NULL — same
// "open" definition the Merchant-Status-by-AE page uses).
//
// A merchant can accept three channels, distinguished by
// merchant_setting_rate.payment_type:
//   Q   = QR Cash      QC = QR Credit      EDC = EDC (card terminal)
// merchant_setting_rate holds rate rows per (merchant, payment_type) and is what
// the live merchant actually uses, so ALL displayed rates come from it. We only
// consider CURRENTLY-ACTIVE rows — enabled = true AND not expired (end_date in
// the future or null) — so expired/disabled history is never shown or compared;
// among the active rows the live one is is_default (then most-recent). A channel
// with no active row reads as "not configured" rather than surfacing a stale rate.
//   • QR Cash %/฿  and  Withdraw own/other      come from the active Q setting
//   • QR Credit %/฿                             from the active QC setting
//   • EDC %/฿                                   from the active EDC setting
//
// merchant_rate is a separate (legacy/effective) table that only covers QR Cash
// (+ transfer/withdraw). It is NOT displayed — it is used solely for the QR Cash
// match: whether merchant_rate still agrees with the active Q setting on the 8
// percent/per-txn values. A divergence flags merchant_rate as out of sync.
//
// All rate values cast to float8 so pg returns numbers, not numeric-as-string.
// The default row per (merchant, payment_type) is picked once via DISTINCT ON
// in the dflt CTE (single scan of the small setting table). Only merchants that
// have a merchant_rate row are listed (INNER JOIN).
// ---------------------------------------------------------------------------

const SQL = `
WITH dflt AS (
  SELECT DISTINCT ON (merchant_id, payment_type)
         merchant_id, payment_type,
         rate_percent, rate_per_time,
         rate_transfer_percent, rate_transfer_per_time,
         rate_withdraw_to_merchant_percent, rate_withdraw_to_merchant_per_time,
         rate_withdraw_to_other_percent, rate_withdraw_to_other_per_time
    FROM merchant_setting_rate
   WHERE enabled IS TRUE                          -- exclude disabled rows
     AND (end_date IS NULL OR end_date > now())   -- exclude expired rows
   ORDER BY merchant_id, payment_type,
            is_default DESC NULLS LAST, start_date DESC NULLS LAST, id DESC
)
SELECT
  mi.id::text                                                                AS id,
  mi.merchant_no                                                              AS merchant_no,
  COALESCE(NULLIF(TRIM(mi.company_name_en), ''), NULLIF(TRIM(mi.merchant_name_en), '')) AS name_en,
  pi.partner_no                                                              AS partner_no,

  -- QR Cash + Withdraw — DISPLAY from the active Q merchant_setting_rate row
  -- (this is what the live merchant actually uses).
  q.rate_percent::float8                                                     AS qr_percent,
  q.rate_per_time::float8                                                    AS qr_time,
  q.rate_withdraw_to_merchant_percent::float8                                AS wd_own_percent,
  q.rate_withdraw_to_merchant_per_time::float8                               AS wd_own_time,
  q.rate_withdraw_to_other_percent::float8                                   AS wd_other_percent,
  q.rate_withdraw_to_other_per_time::float8                                  AS wd_other_time,
  q.rate_transfer_percent::float8                                            AS q_tf_percent,
  q.rate_transfer_per_time::float8                                           AS q_tf_time,
  (q.merchant_id IS NOT NULL)                                                AS has_q_setting,

  -- QR Credit (QC setting)
  qc.rate_percent::float8                                                    AS qc_percent,
  qc.rate_per_time::float8                                                   AS qc_time,
  (qc.merchant_id IS NOT NULL)                                               AS has_qc,

  -- EDC (EDC setting)
  edc.rate_percent::float8                                                   AS edc_percent,
  edc.rate_per_time::float8                                                  AS edc_time,
  (edc.merchant_id IS NOT NULL)                                              AS has_edc,

  -- merchant_rate (the other table) — only for the QR Cash match/diff
  mr.rate_qr_cash_percent::float8                                            AS mr_qr_percent,
  mr.rate_qr_cash_time::float8                                               AS mr_qr_time,
  mr.rate_transfer_percent::float8                                           AS mr_tf_percent,
  mr.rate_transfer_time::float8                                              AS mr_tf_time,
  mr.rate_withdraw_to_merchant_percent::float8                               AS mr_wm_percent,
  mr.rate_withdraw_to_merchant_time::float8                                  AS mr_wm_time,
  mr.rate_withdraw_to_other_percent::float8                                  AS mr_wo_percent,
  mr.rate_withdraw_to_other_time::float8                                     AS mr_wo_time
FROM merchant_info mi
JOIN merchant_rate mr ON mr.merchant_id = mi.id
LEFT JOIN partner_info pi ON pi.id = mi.partner_id
LEFT JOIN dflt q   ON q.merchant_id   = mi.id AND q.payment_type   = 'Q'
LEFT JOIN dflt qc  ON qc.merchant_id  = mi.id AND qc.payment_type  = 'QC'
LEFT JOIN dflt edc ON edc.merchant_id = mi.id AND edc.payment_type = 'EDC'
WHERE mi.close_date IS NULL
ORDER BY pi.partner_no ASC NULLS LAST, mi.merchant_no ASC
`;

type RawRow = {
  id: string;
  merchant_no: string | null;
  name_en: string | null;
  partner_no: string | null;
  // Displayed values — active Q merchant_setting_rate row
  qr_percent: number | null;
  qr_time: number | null;
  wd_own_percent: number | null;
  wd_own_time: number | null;
  wd_other_percent: number | null;
  wd_other_time: number | null;
  q_tf_percent: number | null;
  q_tf_time: number | null;
  has_q_setting: boolean;
  // QR Credit / EDC settings
  qc_percent: number | null;
  qc_time: number | null;
  has_qc: boolean;
  edc_percent: number | null;
  edc_time: number | null;
  has_edc: boolean;
  // merchant_rate (the other table) — for the match/diff only
  mr_qr_percent: number | null;
  mr_qr_time: number | null;
  mr_tf_percent: number | null;
  mr_tf_time: number | null;
  mr_wm_percent: number | null;
  mr_wm_time: number | null;
  mr_wo_percent: number | null;
  mr_wo_time: number | null;
};

type QrCashMatch = "yes" | "no" | "none";

// The fields whose merchant_rate (live) vs merchant_setting_rate (Q) values
// drive the QR Cash match — surfaced so the UI can show a field-by-field diff.
const RATE_KEYS = [
  "qrPercent",
  "qrTime",
  "tfPercent",
  "tfTime",
  "wdOwnPercent",
  "wdOwnTime",
  "wdOtherPercent",
  "wdOtherTime",
] as const;
type RateKey = (typeof RATE_KEYS)[number];
type RateValues = Record<RateKey, number | null>;
export type QrCashCompare = {
  hasSetting: boolean;
  rate: RateValues; // merchant_rate table
  setting: RateValues; // active Q merchant_setting_rate (what the page displays)
};

export type MerchantRateRow = {
  id: string;
  merchant_no: string | null;
  name_en: string | null;
  partner_no: string | null;
  qr_percent: number | null;
  qr_time: number | null;
  qc_percent: number | null;
  qc_time: number | null;
  edc_percent: number | null;
  edc_time: number | null;
  wd_own_percent: number | null;
  wd_own_time: number | null;
  wd_other_percent: number | null;
  wd_other_time: number | null;
  hasQc: boolean;
  hasEdc: boolean;
  qrCashMatch: QrCashMatch;
  qrCashCompare: QrCashCompare;
};

function toNum(v: number | string | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function numEq(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 1e-9;
}

// The live merchant_rate QR-cash schedule and its QR-cash (Q) setting, keyed so
// the UI can render a field-by-field comparison.
function buildCompare(r: RawRow): QrCashCompare {
  return {
    hasSetting: r.has_q_setting,
    rate: {
      // merchant_rate table
      qrPercent: toNum(r.mr_qr_percent),
      qrTime: toNum(r.mr_qr_time),
      tfPercent: toNum(r.mr_tf_percent),
      tfTime: toNum(r.mr_tf_time),
      wdOwnPercent: toNum(r.mr_wm_percent),
      wdOwnTime: toNum(r.mr_wm_time),
      wdOtherPercent: toNum(r.mr_wo_percent),
      wdOtherTime: toNum(r.mr_wo_time),
    },
    setting: {
      // active Q merchant_setting_rate — same values the page displays
      qrPercent: toNum(r.qr_percent),
      qrTime: toNum(r.qr_time),
      tfPercent: toNum(r.q_tf_percent),
      tfTime: toNum(r.q_tf_time),
      wdOwnPercent: toNum(r.wd_own_percent),
      wdOwnTime: toNum(r.wd_own_time),
      wdOtherPercent: toNum(r.wd_other_percent),
      wdOtherTime: toNum(r.wd_other_time),
    },
  };
}

// Does the live merchant_rate QR-cash schedule match the QR-cash (Q) setting?
function matchFromCompare(c: QrCashCompare): QrCashMatch {
  if (!c.hasSetting) return "none";
  return RATE_KEYS.every((k) => numEq(c.rate[k], c.setting[k])) ? "yes" : "no";
}

export async function GET() {
  try {
    const pool = getPool();
    const result = await pool.query<RawRow>(SQL);

    const rows: MerchantRateRow[] = result.rows.map((r) => {
      const qrCashCompare = buildCompare(r);
      return {
        id: r.id,
        merchant_no: r.merchant_no,
        name_en: r.name_en,
        partner_no: r.partner_no,
        qr_percent: toNum(r.qr_percent),
        qr_time: toNum(r.qr_time),
        qc_percent: toNum(r.qc_percent),
        qc_time: toNum(r.qc_time),
        edc_percent: toNum(r.edc_percent),
        edc_time: toNum(r.edc_time),
        wd_own_percent: toNum(r.wd_own_percent),
        wd_own_time: toNum(r.wd_own_time),
        wd_other_percent: toNum(r.wd_other_percent),
        wd_other_time: toNum(r.wd_other_time),
        hasQc: r.has_qc,
        hasEdc: r.has_edc,
        qrCashMatch: matchFromCompare(qrCashCompare),
        qrCashCompare,
      };
    });

    const totals = rows.reduce(
      (acc, r) => {
        if (r.qrCashMatch === "yes") acc.matched += 1;
        else if (r.qrCashMatch === "no") acc.mismatched += 1;
        else acc.noSetting += 1;
        if (r.hasQc) acc.withQrCredit += 1;
        if (r.hasEdc) acc.withEdc += 1;
        return acc;
      },
      { matched: 0, mismatched: 0, noSetting: 0, withQrCredit: 0, withEdc: 0 },
    );

    return NextResponse.json({
      rows,
      totals: { ...totals, total: rows.length },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/finance/merchant-rates]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
