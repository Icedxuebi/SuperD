"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

// Per-channel rate sheet for open merchants (mi.close_date IS NULL). Each row
// shows the merchant's rate for QR Cash, QR Credit and EDC, a shared Withdraw
// rate, and whether the live QR-cash schedule still matches its setting. Data
// is live from /api/finance/merchant-rates.

type QrCashMatch = "yes" | "no" | "none";

type RateKey =
  | "qrPercent"
  | "qrTime"
  | "tfPercent"
  | "tfTime"
  | "wdOwnPercent"
  | "wdOwnTime"
  | "wdOtherPercent"
  | "wdOtherTime";
type RateValues = Record<RateKey, number | null>;
type QrCashCompare = {
  hasSetting: boolean;
  rate: RateValues; // merchant_rate (live)
  setting: RateValues; // merchant_setting_rate (Q)
};

type MerchantRateRow = {
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

// How each compared field is labelled in the drill-down modal.
const RATE_FIELDS: { key: RateKey; group: string; metric: string }[] = [
  { key: "qrPercent", group: "QR Cash", metric: "Rate %" },
  { key: "qrTime", group: "QR Cash", metric: "Per-txn ฿" },
  { key: "tfPercent", group: "Transfer", metric: "Rate %" },
  { key: "tfTime", group: "Transfer", metric: "Per-txn ฿" },
  { key: "wdOwnPercent", group: "Withdraw → own", metric: "Rate %" },
  { key: "wdOwnTime", group: "Withdraw → own", metric: "Per-txn ฿" },
  { key: "wdOtherPercent", group: "Withdraw → other", metric: "Rate %" },
  { key: "wdOtherTime", group: "Withdraw → other", metric: "Per-txn ฿" },
];

const numEq = (a: number | null, b: number | null) => {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 1e-9;
};

type ApiResponse = {
  rows: MerchantRateRow[];
  totals: {
    matched: number;
    mismatched: number;
    noSetting: number;
    withQrCredit: number;
    withEdc: number;
    total: number;
  };
};

type StatusFilter = "all" | "yes" | "no" | "none";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "yes", label: "QR Cash matched" },
  { value: "no", label: "QR Cash mismatched" },
  { value: "none", label: "No QR Cash setting" },
];

// ---- formatters -----------------------------------------------------------

const fmtRate = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 3 });
const fmtPct = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—");

// Pre-approval merchants have no MID yet — fall back to #<id> (app convention).
const midOf = (r: MerchantRateRow) => r.merchant_no ?? `#${r.id}`;

// ===========================================================================

export default function MerchantRatesPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<MerchantRateRow | null>(null);

  function load() {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/finance/merchant-rates`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Query failed (${res.status})`);
        return body as ApiResponse;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    const cleanup = load();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (status !== "all" && r.qrCashMatch !== status) return false;
      if (!q) return true;
      return (
        midOf(r).toLowerCase().includes(q) ||
        (r.name_en ?? "").toLowerCase().includes(q) ||
        (r.partner_no ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, query, status]);

  const matchedPct =
    data && data.totals.total > 0 ? data.totals.matched / data.totals.total : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">Merchant Rates</h1>
          <p className="text-slate-600">
            Per-channel rates (QR Cash, QR Credit, EDC) and withdraw rate for every open merchant —
            the active{" "}
            <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              merchant_setting_rate
            </span>{" "}
            row each merchant actually uses. The QR Cash match flags where{" "}
            <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              merchant_rate
            </span>{" "}
            is out of sync with that setting. Only show the info if that row enabled = "true"
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Re-run the query"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M23 4v6h-6" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="bg-white border border-slate-200/80 rounded-xl p-12 text-center text-slate-500 shadow-card">
          <div className="inline-flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Loading merchant rates from the read replica…
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard accent="bg-brand-600" label="Open merchants" value={data.totals.total.toLocaleString()} sub="with a rate row" />
            <KpiCard accent="bg-emerald-500" label="QR Cash match" value={data.totals.matched.toLocaleString()} sub={`${fmtPct(matchedPct)} of merchants`} />
            <KpiCard accent="bg-accent-500" label="QR Cash mismatched" value={data.totals.mismatched.toLocaleString()} sub="live ≠ setting" />
            <KpiCard accent="bg-slate-500" label="QR Credit enabled" value={data.totals.withQrCredit.toLocaleString()} sub={`${data.totals.withEdc.toLocaleString()} with EDC`} />
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <span className="text-xs font-medium text-slate-600">Search</span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="MID, merchant name, or AE…"
                className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">QR Cash match</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => exportExcel(filtered)}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
              title={filtered.length === 0 ? "No rows to export" : `Export ${filtered.length.toLocaleString()} rows`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M7 10l5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
              Export Excel
            </button>
          </div>

          <RatesTable rows={filtered} total={data.rows.length} onSelect={setSelected} />
        </>
      )}

      {selected && <RateCompareModal row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ---- table ----------------------------------------------------------------

function RatesTable({
  rows,
  total,
  onSelect,
}: {
  rows: MerchantRateRow[];
  total: number;
  onSelect: (r: MerchantRateRow) => void;
}) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
      <div className="flex items-center gap-2 p-5 border-b border-slate-200">
        <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
        <h3 className="text-lg font-semibold text-slate-800">
          Rate sheet
          <span className="text-sm font-normal text-slate-500 ml-2">
            {rows.length.toLocaleString()}
            {rows.length !== total ? ` of ${total.toLocaleString()}` : ""} merchant
            {rows.length === 1 ? "" : "s"}
          </span>
        </h3>
        <span className="ml-auto text-xs text-slate-400">% = rate · ฿ = per-txn min · — = not configured</span>
      </div>
      <div className="overflow-x-auto max-h-[640px]">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr className="text-slate-600 border-b border-slate-200">
              <th rowSpan={2} className="px-4 py-2 font-semibold text-left align-bottom">Merchant ID</th>
              <th rowSpan={2} className="px-4 py-2 font-semibold text-left align-bottom">Merchant name (EN)</th>
              <th rowSpan={2} className="px-4 py-2 font-semibold text-left align-bottom">AE</th>
              <th colSpan={2} className="px-4 py-2 font-semibold text-center border-l border-slate-200">QR Cash</th>
              <th colSpan={2} className="px-4 py-2 font-semibold text-center border-l border-slate-200">QR Credit</th>
              <th colSpan={2} className="px-4 py-2 font-semibold text-center border-l border-slate-200">EDC</th>
              <th colSpan={4} className="px-4 py-2 font-semibold text-center border-l border-slate-200">Withdraw</th>
              <th rowSpan={2} className="px-4 py-2 font-semibold text-center align-bottom border-l border-slate-200">QR Cash match</th>
            </tr>
            <tr className="text-slate-500 border-b border-slate-200 text-xs">
              <Sub2 a="%" b="฿" />
              <Sub2 a="%" b="฿" />
              <Sub2 a="%" b="฿" />
              <th className="px-3 py-1.5 font-medium text-right border-l border-slate-200">own %</th>
              <th className="px-3 py-1.5 font-medium text-right">own ฿</th>
              <th className="px-3 py-1.5 font-medium text-right">other %</th>
              <th className="px-3 py-1.5 font-medium text-right">other ฿</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={14} className="text-center py-12 text-slate-500">
                  No merchants match the current filter.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs font-medium text-slate-800">{midOf(r)}</td>
                <td className="px-4 py-2 text-slate-700 max-w-[220px] truncate" title={r.name_en ?? undefined}>
                  {r.name_en ?? "—"}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-700">{r.partner_no ?? "—"}</td>

                <RateCell first value={fmtRate(r.qr_percent)} />
                <RateCell value={fmtRate(r.qr_time)} />

                <RateCell first value={fmtRate(r.qc_percent)} muted={!r.hasQc} />
                <RateCell value={fmtRate(r.qc_time)} muted={!r.hasQc} />

                <RateCell first value={fmtRate(r.edc_percent)} muted={!r.hasEdc} />
                <RateCell value={fmtRate(r.edc_time)} muted={!r.hasEdc} />

                <RateCell first value={fmtRate(r.wd_own_percent)} />
                <RateCell value={fmtRate(r.wd_own_time)} />
                <RateCell value={fmtRate(r.wd_other_percent)} />
                <RateCell value={fmtRate(r.wd_other_time)} />

                <td className="px-4 py-2 text-center border-l border-slate-100">
                  <MatchBadge value={r.qrCashMatch} onClick={() => onSelect(r)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Sub2({ a, b }: { a: string; b: string }) {
  return (
    <>
      <th className="px-3 py-1.5 font-medium text-right border-l border-slate-200">{a}</th>
      <th className="px-3 py-1.5 font-medium text-right">{b}</th>
    </>
  );
}

function RateCell({ value, first, muted }: { value: string; first?: boolean; muted?: boolean }) {
  return (
    <td
      className={`px-3 py-2 text-right font-mono tabular-nums ${muted ? "text-slate-300" : "text-slate-800"} ${
        first ? "border-l border-slate-100" : ""
      }`}
    >
      {value}
    </td>
  );
}

function MatchBadge({ value, onClick }: { value: QrCashMatch; onClick: () => void }) {
  const styles: Record<QrCashMatch, { cls: string; label: string }> = {
    yes: {
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 focus:ring-emerald-300",
      label: "Match",
    },
    no: {
      cls: "bg-brand-50 text-brand-700 border-brand-200 hover:bg-brand-100 focus:ring-brand-300",
      label: "Mismatch",
    },
    none: {
      cls: "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200 focus:ring-slate-300",
      label: "No setting",
    },
  };
  const { cls, label } = styles[value];
  return (
    <button
      type="button"
      onClick={onClick}
      title="View merchant_rate vs merchant_setting_rate"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border cursor-pointer transition-colors focus:outline-none focus:ring-2 ${cls}`}
    >
      {label}
      <svg viewBox="0 0 24 24" className="h-3 w-3 opacity-70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
  );
}

// ---- comparison modal -----------------------------------------------------

function RateCompareModal({ row, onClose }: { row: MerchantRateRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cmp = row.qrCashCompare;
  const diffCount = cmp.hasSetting
    ? RATE_FIELDS.filter((f) => !numEq(cmp.rate[f.key], cmp.setting[f.key])).length
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-block w-1 h-5 rounded-full bg-brand-600 flex-none" />
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-slate-800">QR Cash rate comparison</h3>
              <p className="text-sm text-slate-500 truncate">
                <span className="font-mono">{midOf(row)}</span>
                {row.name_en ? ` · ${row.name_en}` : ""} · {row.partner_no ?? "—"} ·{" "}
                <span className="font-mono">id {row.id}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-none p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 pt-4">
          {!cmp.hasSetting ? (
            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-600">
              No QR Cash (<span className="font-mono">Q</span>) setting row exists for this merchant —
              showing the live <span className="font-mono">merchant_rate</span> only, nothing to compare.
            </div>
          ) : diffCount === 0 ? (
            <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
              All {RATE_FIELDS.length} values match — <span className="font-mono">merchant_rate</span> and{" "}
              <span className="font-mono">merchant_setting_rate</span> are in sync.
            </div>
          ) : (
            <div className="rounded-md bg-brand-50 border border-brand-200 px-3 py-2 text-sm text-brand-700">
              {diffCount} of {RATE_FIELDS.length} value{diffCount === 1 ? "" : "s"} differ — highlighted below.
            </div>
          )}
        </div>

        <div className="overflow-auto p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="px-3 py-2 font-semibold">Field</th>
                <th className="px-3 py-2 font-semibold text-right">merchant_rate</th>
                <th className="px-3 py-2 font-semibold text-right">merchant_setting_rate</th>
                <th className="px-3 py-2 font-semibold text-center w-10" aria-label="Match" />
              </tr>
            </thead>
            <tbody>
              {RATE_FIELDS.map((f) => {
                const rate = cmp.rate[f.key];
                const setting = cmp.hasSetting ? cmp.setting[f.key] : null;
                const isDiff = cmp.hasSetting && !numEq(rate, setting);
                return (
                  <tr
                    key={f.key}
                    className={`border-b border-slate-100 ${isDiff ? "bg-brand-50/60" : ""}`}
                  >
                    <td className="px-3 py-2 text-slate-700">
                      <span className="font-medium text-slate-800">{f.group}</span>{" "}
                      <span className="text-slate-400">{f.metric}</span>
                    </td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${isDiff ? "text-brand-700 font-semibold" : "text-slate-800"}`}>
                      {fmtRate(rate)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${isDiff ? "text-brand-700 font-semibold" : "text-slate-800"}`}>
                      {cmp.hasSetting ? fmtRate(setting) : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {!cmp.hasSetting ? (
                        <span className="text-slate-300">—</span>
                      ) : isDiff ? (
                        <span className="text-brand-600 font-semibold" title="Differs">≠</span>
                      ) : (
                        <span className="text-emerald-600" title="Matches">✓</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ accent, label, value, sub }: { accent: string; label: string; value: string; sub?: string }) {
  return (
    <div className="relative bg-white border border-slate-200/80 rounded-xl p-5 shadow-card overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${accent}`} aria-hidden />
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
      {sub && <div className="text-sm text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

// ---- Excel export ---------------------------------------------------------

function exportExcel(rows: MerchantRateRow[]) {
  if (rows.length === 0) return;
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      "Merchant ID": midOf(r),
      "Merchant name (EN)": r.name_en ?? "",
      AE: r.partner_no ?? "",
      "QR Cash %": r.qr_percent,
      "QR Cash per-txn": r.qr_time,
      "QR Credit %": r.qc_percent,
      "QR Credit per-txn": r.qc_time,
      "EDC %": r.edc_percent,
      "EDC per-txn": r.edc_time,
      "Withdraw own %": r.wd_own_percent,
      "Withdraw own per-txn": r.wd_own_time,
      "Withdraw other %": r.wd_other_percent,
      "Withdraw other per-txn": r.wd_other_time,
    })),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Merchant Rates");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `MerchantRates_${stamp}.xlsx`);
}
