"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Row = {
  account_number: string | null;
  name: string | null;
  total_amount: number;
  transaction_count: number;
};

type Totals = {
  unique_spenders: number;
  total_amount: number;
  total_transactions: number;
};

type ApiResponse = {
  month: string;
  limit: number;
  totals: Totals;
  rows: Row[];
};

type SortKey = "rank" | "account_number" | "name" | "total_amount" | "transaction_count";
type SortDir = "asc" | "desc";

const LIMIT_OPTIONS = [50, 100, 250, 500] as const;
type LimitN = (typeof LIMIT_OPTIONS)[number];

const thbFmt = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const intFmt = new Intl.NumberFormat("en-US");

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return thbFmt.format(v);
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return intFmt.format(v);
}

function fmtPercent(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

function defaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default function TopSpenderPage() {
  const [month, setMonth] = useState<string>(defaultMonth());
  const [limit, setLimit] = useState<LimitN>(100);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setQ("");
    fetch(`/api/top-spender?month=${month}&limit=${limit}`)
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
  }, [month, limit]);

  const ranked = useMemo(() => {
    if (!data) return [];
    return data.rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? ranked.filter((r) => {
          const hay = [r.account_number, r.name]
            .filter((v): v is string => typeof v === "string" && v.length > 0)
            .join("  ")
            .toLowerCase();
          return hay.includes(needle);
        })
      : ranked.slice();

    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "rank":
          cmp = a.rank - b.rank;
          break;
        case "account_number":
          cmp = (a.account_number ?? "").localeCompare(b.account_number ?? "", undefined, {
            numeric: true,
          });
          break;
        case "name":
          cmp = (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
          break;
        case "total_amount":
          cmp = a.total_amount - b.total_amount;
          break;
        case "transaction_count":
          cmp = a.transaction_count - b.transaction_count;
          break;
      }
      return cmp * dir;
    });
    return list;
  }, [ranked, q, sortBy, sortDir]);

  function onSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      const numeric: SortKey[] = ["total_amount", "transaction_count"];
      setSortDir(numeric.includes(key) ? "desc" : "asc");
    }
  }

  function arrow(key: SortKey) {
    if (sortBy !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  function exportExcel() {
    if (!data || filtered.length === 0) return;
    const sheetData = filtered.map((r) => ({
      Rank: r.rank,
      "Bank Account Number": r.account_number ?? "",
      "Bank Account Name": r.name ?? "",
      "Total Amount": r.total_amount,
      Transactions: r.transaction_count,
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData, {
      header: ["Rank", "Bank Account Number", "Bank Account Name", "Total Amount", "Transactions"],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Top ${data.limit} ${data.month}`);
    XLSX.writeFile(wb, `TopSpender-${data.month}.xlsx`);
  }

  const chartData = useMemo(() => {
    return ranked.slice(0, 10).map((r) => ({
      // Tooltip / label key — keep short for the axis
      label: r.account_number ?? "—",
      name: r.name ?? "",
      total: r.total_amount,
    }));
  }, [ranked]);

  const top1Share = useMemo(() => {
    if (!data || !ranked[0] || data.totals.total_amount <= 0) return 0;
    return (ranked[0].total_amount / data.totals.total_amount) * 100;
  }, [data, ranked]);

  const top10Share = useMemo(() => {
    if (!data || data.totals.total_amount <= 0) return 0;
    const sumTop10 = ranked.slice(0, 10).reduce((s, r) => s + r.total_amount, 0);
    return (sumTop10 / data.totals.total_amount) * 100;
  }, [data, ranked]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Top Spender</h1>
        <p className="text-slate-600">
          Top Spender in the selected month.
        </p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors font-mono"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Show top</span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) as LimitN)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors min-w-[120px]"
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <span className="text-xs font-medium text-slate-600">Search</span>
          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by account number or name…"
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
            />
          </div>
        </label>

        <button
          type="button"
          onClick={() => setQ("")}
          disabled={q === ""}
          className="px-4 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
        >
          Clear
        </button>

        <button
          type="button"
          onClick={exportExcel}
          disabled={!data || filtered.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M7 10l5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          Export Excel
        </button>

        {loading && (
          <div className="ml-auto text-sm text-slate-500 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Aggregating {monthLabel(month)}… (~15 s for a full month)
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Total amount paid" value={fmtMoney(data.totals.total_amount)} accent />
            <Stat label="Total transactions" value={fmtInt(data.totals.total_transactions)} />
            <Stat label="Unique spenders" value={fmtInt(data.totals.unique_spenders)} />
            <Stat
              label="Top 10 share"
              value={fmtPercent(top10Share)}
              subtitle={`Top 1 = ${fmtPercent(top1Share)}`}
            />
          </div>

          {chartData.length > 0 && (
            <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h2 className="text-lg font-semibold text-slate-800">
                  Top 10 spenders — {monthLabel(month)}
                </h2>
              </div>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fontFamily: "monospace", fill: "#475569" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fontFamily: "monospace", fill: "#475569" }}
                      tickFormatter={(v: number) => {
                        if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
                        if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
                        return String(v);
                      }}
                    />
                    <Tooltip
                      cursor={{ fill: "#fef2f3" }}
                      formatter={(v: number) => fmtMoney(v)}
                      labelFormatter={(label: string) => {
                        const r = chartData.find((c) => c.label === label);
                        return r?.name ? `${label} — ${r.name}` : label;
                      }}
                      contentStyle={{
                        backgroundColor: "white",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="total" fill="#A4262C" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h3 className="text-lg font-semibold text-slate-800">
                  Top {data.limit} — {monthLabel(month)}
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    {filtered.length.toLocaleString()}
                    {filtered.length !== data.rows.length
                      ? ` of ${data.rows.length.toLocaleString()}`
                      : ""}
                  </span>
                </h3>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[640px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-slate-600 border-b border-slate-200">
                    <Th label="#" col="rank" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                    <Th
                      label="Bank Account Number"
                      col="account_number"
                      sortBy={sortBy}
                      arrow={arrow}
                      onSort={onSort}
                    />
                    <Th label="Bank Account Name" col="name" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                    <Th
                      label="Total Amount"
                      col="total_amount"
                      sortBy={sortBy}
                      arrow={arrow}
                      onSort={onSort}
                      right
                    />
                    <Th
                      label="Transactions"
                      col="transaction_count"
                      sortBy={sortBy}
                      arrow={arrow}
                      onSort={onSort}
                      right
                    />
                    <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap text-slate-600">
                      Share
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-500">
                        {data.rows.length === 0
                          ? `No successful payments found in ${monthLabel(month)}.`
                          : "No rows match this search."}
                      </td>
                    </tr>
                  )}
                  {filtered.map((r) => {
                    const share =
                      data.totals.total_amount > 0
                        ? (r.total_amount / data.totals.total_amount) * 100
                        : 0;
                    return (
                      <tr
                        key={`${r.account_number ?? "x"}-${r.rank}`}
                        className="border-b border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-4 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">
                          {r.rank}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                          {r.account_number ? (
                            <Link
                              href={`/risk-management/spender-history?account=${r.account_number}`}
                              className="text-brand-600 hover:text-brand-700 hover:underline"
                            >
                              {r.account_number}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-800">{r.name ?? "—"}</td>
                        <td className="px-4 py-2 text-right font-mono whitespace-nowrap">
                          {fmtMoney(r.total_amount)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono whitespace-nowrap">
                          {fmtInt(r.transaction_count)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs whitespace-nowrap text-slate-500">
                          {fmtPercent(share)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  subtitle,
  accent = false,
}: {
  label: string;
  value: string;
  subtitle?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex items-start gap-3">
      <span className={`inline-block w-1 h-10 rounded-full ${accent ? "bg-brand-600" : "bg-slate-700"}`} />
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div className="text-2xl font-bold font-mono text-slate-900 break-words">{value}</div>
        {subtitle && (
          <div className="text-xs font-mono text-slate-500 mt-0.5">{subtitle}</div>
        )}
      </div>
    </div>
  );
}

function Th({
  label,
  col,
  sortBy,
  arrow,
  onSort,
  right = false,
}: {
  label: string;
  col: SortKey;
  sortBy: SortKey;
  arrow: (k: SortKey) => string;
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap ${
        right ? "text-right" : ""
      }`}
      aria-sort={sortBy === col ? "ascending" : "none"}
    >
      {label}
      <span className="text-brand-600">{arrow(col)}</span>
    </th>
  );
}
