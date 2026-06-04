"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Schema = {
  columns: string[];
  dateColumn: string | null;
  ruleColumn: string | null;
  severityColumn: string | null;
  merchantColumn: string | null;
  ptxColumn: string | null;
  transferColumn: string | null;
};

type Summary = {
  alerts: number;
  merchants_alerted: number;
  payments_alerted: number;
  transfers_alerted: number;
  payment_amount_at_risk: number;
  transfer_amount_at_risk: number;
};

type DailyRow = { day: string; alerts: number };

type RuleRow = { rule: string; alerts: number };

type TopMerchantRow = {
  merchant_id: string | null;
  merchant_no: string | null;
  merchant_name: string | null;
  partner_no: string | null;
  alerts: number;
};

type RecentRow = Record<string, unknown> & {
  id?: string | number | null;
  _merchant_no?: string | null;
  _merchant_company?: string | null;
  _partner_no?: string | null;
  _pt_amount?: string | number | null;
  _pt_payment_date?: string | null;
  _pt_pay_type?: string | null;
  _tt_amount?: string | number | null;
  _tt_transfer_date?: string | null;
  _tt_status?: string | null;
};

type ApiResponse = {
  from: string;
  to: string;
  schema: Schema;
  summary: Summary;
  daily: DailyRow[];
  byRule: RuleRow[];
  topMerchants: TopMerchantRow[];
  recent: RecentRow[];
};

const WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Last 24 hours" },
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
];

const COLORS = ["#A4262C", "#d4a017", "#475569", "#2563eb", "#0891b2", "#059669", "#7c3aed", "#db2777", "#ea580c", "#1e293b", "#94a3b8", "#c03d44"];

function startOfDay(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtTHB(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

function shortTs(s: string | null | undefined): string {
  if (!s) return "—";
  return String(s).slice(0, 19).replace("T", " ");
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  // Long strings (raw bank payloads, descriptions) get truncated in the cell;
  // the tooltip shows the full value.
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

export default function FraudMonitoringPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [windowDays, setWindowDays] = useState(30);
  const [from, setFrom] = useState(() => startOfDay(30));
  const [to, setTo] = useState(() => today());
  const [search, setSearch] = useState("");

  useEffect(() => {
    setFrom(startOfDay(windowDays));
    setTo(today());
  }, [windowDays]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from, to });
    fetch(`/api/fraud-monitoring?${qs}`)
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
  }, [from, to]);

  const totalAtRisk = useMemo(() => {
    if (!data) return 0;
    return data.summary.payment_amount_at_risk + data.summary.transfer_amount_at_risk;
  }, [data]);

  // Build the table columns from the schema + context fields. Native tfm
  // columns come first (most relevant for the analyst), then the synthetic
  // context columns (prefixed with _ in the API).
  const tableColumns = useMemo<string[]>(() => {
    if (!data) return [];
    const native = data.schema.columns;
    const context = ["_merchant_no", "_merchant_company", "_partner_no", "_pt_amount", "_pt_payment_date", "_pt_pay_type", "_tt_amount", "_tt_transfer_date", "_tt_status"];
    const present = new Set(
      data.recent.length > 0
        ? Object.keys(data.recent[0])
        : [...native, ...context],
    );
    return [...native, ...context].filter((c) => present.has(c));
  }, [data]);

  const filteredRecent = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.recent;
    return data.recent.filter((row) => {
      return Object.values(row).some((v) =>
        v !== null && v !== undefined && String(v).toLowerCase().includes(q),
      );
    });
  }, [data, search]);

  function exportExcel() {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    if (data.daily.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(data.daily),
        "Daily",
      );
    }
    if (data.byRule.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(data.byRule),
        "By rule",
      );
    }
    if (data.topMerchants.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          data.topMerchants.map((r) => ({
            MID: r.merchant_no ?? "",
            "Merchant Name": r.merchant_name ?? "",
            Partner: r.partner_no ?? "",
            Alerts: r.alerts,
          })),
        ),
        "Top merchants",
      );
    }
    if (filteredRecent.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          filteredRecent.map((r) => {
            const out: Record<string, unknown> = {};
            for (const c of tableColumns) out[c] = r[c];
            return out;
          }),
        ),
        "Recent alerts",
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `FraudMonitoring_${stamp}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Fraud Monitoring Feed</h1>
        <p className="text-slate-600">
          Alerts from{" "}
          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">transaction_fraud_monitoring</span>
          {" "}joined to the underlying payment / transfer / merchant.
        </p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Window</span>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors min-w-[180px]"
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
          />
        </label>

        <button
          type="button"
          onClick={exportExcel}
          disabled={!data}
          className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M7 10l5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          Export Excel
        </button>

        {loading && (
          <div className="text-sm text-slate-500 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Loading…
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {data && (
        <>
          {!data.schema.dateColumn && (
            <div className="p-3 rounded-md border border-amber-200 bg-amber-50 text-sm text-amber-800">
              No date-typed column found on <span className="font-mono text-xs">transaction_fraud_monitoring</span>.
              Date-window filtering and the daily-trend chart are disabled — feed shows the 500 most recent rows by id.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              accent="bg-brand-600"
              iconBg="bg-brand-50 text-brand-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.74-3l-7-12a2 2 0 00-3.48 0l-7 12A2 2 0 005 19z" />
                </svg>
              }
              label="Alerts"
              value={data.summary.alerts.toLocaleString()}
              sub={data.schema.dateColumn ? `In window` : "Most recent 500 (no date column)"}
            />
            <KpiCard
              accent="bg-accent-500"
              iconBg="bg-accent-50 text-accent-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M9 11a4 4 0 100-8 4 4 0 000 8zm6 0a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
              }
              label="Merchants alerted"
              value={data.summary.merchants_alerted.toLocaleString()}
            />
            <KpiCard
              accent="bg-slate-700"
              iconBg="bg-slate-100 text-slate-700"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16v16H4z" />
                  <path d="M4 9h16M9 4v16" />
                </svg>
              }
              label="Transactions involved"
              value={(data.summary.payments_alerted + data.summary.transfers_alerted).toLocaleString()}
              sub={`${data.summary.payments_alerted.toLocaleString()} payments · ${data.summary.transfers_alerted.toLocaleString()} transfers`}
            />
            <KpiCard
              accent="bg-brand-600"
              iconBg="bg-brand-50 text-brand-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 7H9.5a2.5 2.5 0 000 5h5a2.5 2.5 0 010 5H7" />
                </svg>
              }
              label="Amount at risk"
              value={`฿ ${fmtTHB(totalAtRisk)}`}
              sub={`฿ ${fmtTHB(data.summary.payment_amount_at_risk)} payments`}
            />
          </div>

          {data.daily.length > 0 && (
            <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h3 className="text-lg font-semibold text-slate-800">
                  Daily alert volume
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    Grouped by{" "}
                    <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                      {data.schema.dateColumn}
                    </span>
                  </span>
                </h3>
              </div>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <AreaChart data={data.daily} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="alertGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#A4262C" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="#A4262C" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" stroke="#64748b" fontSize={11} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis stroke="#64748b" fontSize={11} tickFormatter={fmtCompact} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                      formatter={(value: number) => [value.toLocaleString(), "Alerts"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="alerts"
                      stroke="#A4262C"
                      fill="url(#alertGrad)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-block w-1 h-5 rounded-full bg-accent-500" />
                <h3 className="text-lg font-semibold text-slate-800">
                  By rule
                  {data.schema.ruleColumn && (
                    <span className="text-sm font-normal text-slate-500 ml-2">
                      From{" "}
                      <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                        {data.schema.ruleColumn}
                      </span>
                    </span>
                  )}
                </h3>
              </div>
              {data.byRule.length === 0 ? (
                <div className="text-center py-10 text-slate-500 text-sm">
                  {data.schema.ruleColumn
                    ? "No alerts in this window."
                    : "No rule/type column on transaction_fraud_monitoring."}
                </div>
              ) : (
                <div style={{ width: "100%", height: Math.max(260, data.byRule.length * 30 + 40) }}>
                  <ResponsiveContainer>
                    <BarChart data={data.byRule} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis type="number" stroke="#64748b" fontSize={11} tickFormatter={fmtCompact} />
                      <YAxis
                        type="category"
                        dataKey="rule"
                        stroke="#64748b"
                        fontSize={11}
                        width={150}
                        tick={{ textAnchor: "end" }}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                        formatter={(value: number) => [value.toLocaleString(), "Alerts"]}
                      />
                      <Bar dataKey="alerts" radius={[0, 4, 4, 0]}>
                        {data.byRule.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h3 className="text-lg font-semibold text-slate-800">Top alerted merchants</h3>
              </div>
              {data.topMerchants.length === 0 ? (
                <div className="text-center py-10 text-slate-500 text-sm">No merchants alerted.</div>
              ) : (
                <ol className="space-y-2 max-h-[400px] overflow-y-auto">
                  {data.topMerchants.slice(0, 12).map((r, i) => {
                    const max = data.topMerchants[0]?.alerts ?? 1;
                    const width = max > 0 ? (r.alerts / max) * 100 : 0;
                    const merchantName = r.merchant_name || "—";
                    return (
                      <li key={r.merchant_id ?? `m-${i}`} className="flex items-center gap-3">
                        <span className="flex-none w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold flex items-center justify-center tabular-nums">
                          {i + 1}
                        </span>
                        <span className="flex-none w-32 font-mono text-xs font-medium text-slate-800 truncate">
                          {r.merchant_no ? (
                            <a
                              href={`/application-support/merchant-lookup/${r.merchant_no}`}
                              className="text-brand-600 hover:text-brand-700 hover:underline"
                            >
                              {r.merchant_no}
                            </a>
                          ) : (
                            "—"
                          )}
                        </span>
                        <span className="flex-1 text-xs text-slate-600 truncate" title={merchantName}>
                          {merchantName}
                        </span>
                        <div className="flex-none w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-600" style={{ width: `${width}%` }} />
                        </div>
                        <span className="flex-none w-14 text-right font-mono text-sm font-semibold tabular-nums text-slate-900">
                          {r.alerts.toLocaleString()}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h3 className="text-lg font-semibold text-slate-800">
                  Recent alerts
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    {filteredRecent.length.toLocaleString()} of {data.recent.length.toLocaleString()}
                    {data.recent.length === 500 && " (capped at 500)"}
                  </span>
                </h3>
              </div>
              <input
                type="search"
                placeholder="Search any column…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-md text-sm w-72 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
              />
            </div>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-slate-600 border-b border-slate-200">
                    {tableColumns.map((c) => (
                      <th
                        key={c}
                        className={`px-3 py-2.5 font-semibold whitespace-nowrap ${
                          c.startsWith("_") ? "text-brand-700" : ""
                        }`}
                      >
                        {c.startsWith("_") ? c.slice(1).replace(/_/g, " ") : c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRecent.length === 0 && (
                    <tr>
                      <td colSpan={Math.max(tableColumns.length, 1)} className="text-center py-12 text-slate-500">
                        No alerts in this window.
                      </td>
                    </tr>
                  )}
                  {filteredRecent.map((r, idx) => (
                    <tr key={String(r.id ?? idx)} className="border-b border-slate-100 hover:bg-slate-50">
                      {tableColumns.map((c) => {
                        const raw = r[c];
                        const isMid = c === "_merchant_no" && raw;
                        const isMoney = (c === "_pt_amount" || c === "_tt_amount") && raw !== null && raw !== undefined;
                        const isDate = c === "_pt_payment_date" || c === "_tt_transfer_date";
                        return (
                          <td
                            key={c}
                            className={`px-3 py-2 align-top text-xs ${
                              c.startsWith("_") ? "font-medium" : ""
                            } ${isMoney ? "text-right font-mono tabular-nums" : ""}`}
                            title={raw === null || raw === undefined ? "" : String(raw)}
                          >
                            {isMid ? (
                              <a
                                href={`/application-support/merchant-lookup/${String(raw)}`}
                                className="font-mono text-brand-600 hover:text-brand-700 hover:underline"
                              >
                                {String(raw)}
                              </a>
                            ) : isMoney ? (
                              fmtTHB(num(raw))
                            ) : isDate ? (
                              <span className="font-mono">{shortTs(String(raw ?? ""))}</span>
                            ) : (
                              renderCell(raw)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  accent,
  iconBg,
  icon,
  label,
  value,
  sub,
}: {
  accent: string;
  iconBg: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="relative bg-white border border-slate-200/80 rounded-xl p-5 shadow-card hover:shadow-cardHover transition-shadow overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${accent}`} aria-hidden />
      <div className="flex items-start justify-between">
        <div className="text-sm font-medium text-slate-500">{label}</div>
        <div className={`p-2 rounded-lg ${iconBg}`}>{icon}</div>
      </div>
      <div className="mt-3 text-2xl font-bold text-slate-900 truncate">{value}</div>
      {sub && <div className="text-sm text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
