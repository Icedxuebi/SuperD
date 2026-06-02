"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLOR_ACTIVE = "#059669"; // emerald-600
const COLOR_INACTIVE = "#A4262C"; // brand red

type PartnerRow = {
  partner_no: string;
  active: number;
  inactive: number;
  total: number;
};

type ApiResponse = {
  partners: PartnerRow[];
  totals: { active: number; inactive: number; total: number };
};

type SortKey = "active" | "inactive" | "total" | "rate" | "partner_no";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "active", label: "Active (most)" },
  { value: "inactive", label: "Inactive (most)" },
  { value: "rate", label: "Active rate (highest)" },
  { value: "total", label: "Total merchants" },
  { value: "partner_no", label: "Partner number" },
];

const TOP_N_OPTIONS = [10, 25, 50, 100, 9999];

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export default function MerchantStatusByAePage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [todayLabel, setTodayLabel] = useState("");

  useEffect(() => {
    const d = new Date();
    setTodayLabel(
      `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
    );
  }, []);

  const [sortKey, setSortKey] = useState<SortKey>("active");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [topN, setTopN] = useState<number>(10);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/merchant-status-by-ae`)
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
  }, []);

  const sortedPartners = useMemo(() => {
    if (!data) return [];
    const arr = [...data.partners];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "active":
          return dir * (a.active - b.active);
        case "inactive":
          return dir * (a.inactive - b.inactive);
        case "total":
          return dir * (a.total - b.total);
        case "rate":
          return dir * (a.active / Math.max(a.total, 1) - b.active / Math.max(b.total, 1));
        case "partner_no":
          return dir * a.partner_no.localeCompare(b.partner_no);
      }
    });
    return arr;
  }, [data, sortKey, sortDir]);

  const chartData = useMemo(
    () => sortedPartners.slice(0, topN),
    [sortedPartners, topN],
  );

  const topAe = useMemo(() => {
    if (!data || data.partners.length === 0) return null;
    return [...data.partners].sort((a, b) => b.active - a.active)[0];
  }, [data]);

  const top3Active = useMemo(() => {
    if (!data) return [];
    return [...data.partners]
      .filter((p) => p.active > 0)
      .sort((a, b) => b.active - a.active)
      .slice(0, 3);
  }, [data]);

  const top3Inactive = useMemo(() => {
    if (!data) return [];
    return [...data.partners]
      .filter((p) => p.inactive > 0)
      .sort((a, b) => b.inactive - a.inactive)
      .slice(0, 5);
  }, [data]);

  const activeRate =
    data && data.totals.total > 0 ? data.totals.active / data.totals.total : 0;

  function exportExcel() {
    if (sortedPartners.length === 0) return;
    const rows = sortedPartners.map((p) => ({
      Partner: p.partner_no,
      Active: p.active,
      Inactive: p.inactive,
      Total: p.total,
      "Active %": p.total > 0 ? p.active / p.total : 0,
    }));
    if (data) {
      rows.push({
        Partner: "Total",
        Active: data.totals.active,
        Inactive: data.totals.inactive,
        Total: data.totals.total,
        "Active %": activeRate,
      });
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    // Format the Active % column as a percentage.
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 4 })];
      if (cell) cell.z = "0.0%";
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Breakdown by AE");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `MerchantStatusByAE_${stamp}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Merchant Status by AE</h1>
        <p className="text-slate-600">
          Merchant status by partner at{" "}
          <span className="font-medium text-slate-700">{todayLabel || "—"}</span>
        </p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Sort by</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors min-w-[200px]"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Direction</span>
          <div className="inline-flex gap-1 bg-slate-100 rounded-lg p-1">
            {(["desc", "asc"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setSortDir(d)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  sortDir === d
                    ? "bg-white shadow-sm text-brand-700"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {d === "desc" ? "High → Low" : "Low → High"}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Show in chart</span>
          <select
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
          >
            {TOP_N_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 9999 ? "All partners" : `Top ${n}`}
              </option>
            ))}
          </select>
        </label>

        {loading && (
          <div className="ml-auto text-sm text-slate-500 flex items-center gap-1.5">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              accent="bg-emerald-500"
              iconBg="bg-emerald-50 text-emerald-600"
              icon={
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              }
              label="Active"
              value={data.totals.active.toLocaleString()}
              sub={`${formatPct(activeRate)} of approved merchants`}
            />
            <KpiCard
              accent="bg-slate-500"
              iconBg="bg-slate-100 text-slate-700"
              icon={
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 8v4M12 16h.01M5 19h14a2 2 0 001.74-3l-7-12a2 2 0 00-3.48 0l-7 12A2 2 0 005 19z" />
                </svg>
              }
              label="Inactive"
              value={data.totals.inactive.toLocaleString()}
              sub={`${formatPct(1 - activeRate)} of approved merchants`}
            />
            <KpiCard
              accent="bg-brand-600"
              iconBg="bg-brand-50 text-brand-600"
              icon={
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M9 11a4 4 0 100-8 4 4 0 000 8zm6 0a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
              }
              label="Approved merchants"
              value={data.totals.total.toLocaleString()}
              sub={`Across ${data.partners.length} partner${data.partners.length === 1 ? "" : "s"}`}
            />
            <KpiCard
              accent="bg-accent-500"
              iconBg="bg-accent-50 text-accent-600"
              icon={
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 21h8m-4-4v4M6 4h12v4a6 6 0 01-12 0V4z" />
                  <path d="M18 6h2a2 2 0 010 4h-2M6 6H4a2 2 0 000 4h2" />
                </svg>
              }
              label="Top AE"
              value={topAe?.partner_no ?? "—"}
              sub={topAe ? `${topAe.active} active · ${topAe.inactive} inactive` : undefined}
            />
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
              <h3 className="text-lg font-semibold text-slate-800">
                Active vs Inactive per AE
                <span className="text-sm font-normal text-slate-500 ml-2">
                  {topN === 9999
                    ? `${chartData.length} partners`
                    : `Top ${Math.min(topN, chartData.length)} of ${data.partners.length}`}
                </span>
              </h3>
            </div>
            <div style={{ width: "100%", height: Math.max(280, chartData.length * 30 + 60) }}>
              <ResponsiveContainer>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 5, right: 96, left: 20, bottom: 5 }}
                  barCategoryGap={6}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" stroke="#64748b" fontSize={12} />
                  <YAxis
                    type="category"
                    dataKey="partner_no"
                    stroke="#64748b"
                    fontSize={11}
                    width={90}
                    tick={{ textAnchor: "end" }}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                    formatter={(value: number, name) => [
                      value.toLocaleString(),
                      name === "active" ? "Active" : "Inactive",
                    ]}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    iconType="circle"
                    formatter={(v) => (v === "active" ? "Active" : "Inactive")}
                  />
                  <Bar dataKey="active" stackId="a" fill={COLOR_ACTIVE} radius={[0, 0, 0, 0]}>
                    <LabelList
                      dataKey="active"
                      position="insideRight"
                      fill="#ffffff"
                      fontSize={10}
                      fontWeight={600}
                      formatter={(v: number) => (v > 0 ? v.toLocaleString() : "")}
                    />
                  </Bar>
                  <Bar dataKey="inactive" stackId="a" fill="#A4262C" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="inactive"
                      position="center"
                      fill="#ffffff"
                      fontSize={10}
                      fontWeight={600}
                      formatter={(v: number) => (v > 0 ? v.toLocaleString() : "")}
                    />
                    <LabelList dataKey="total" content={TotalLabel} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-block w-1 h-5 rounded-full bg-accent-500" />
                <h3 className="text-lg font-semibold text-slate-800">Active vs Inactive</h3>
              </div>
              <div style={{ width: "100%", height: 280 }} className="relative">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Active", value: data.totals.active, fill: COLOR_ACTIVE },
                        { name: "Inactive", value: data.totals.inactive, fill: COLOR_INACTIVE },
                      ]}
                      dataKey="value"
                      innerRadius={70}
                      outerRadius={110}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      <Cell fill={COLOR_ACTIVE} />
                      <Cell fill={COLOR_INACTIVE} />
                    </Pie>
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                      formatter={(value: number, name) => [value.toLocaleString(), name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-3xl font-bold text-slate-900 tabular-nums">
                    {formatPct(activeRate)}
                  </div>
                  <div className="text-xs text-slate-500 uppercase tracking-wide">Active rate</div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-center gap-6 text-sm">
                <LegendDot color={COLOR_ACTIVE} label="Active" value={data.totals.active} />
                <LegendDot color={COLOR_INACTIVE} label="Inactive" value={data.totals.inactive} />
              </div>
            </div>

            <div className="lg:col-span-2 bg-white border border-slate-200/80 rounded-xl p-5 shadow-card space-y-6">
              <TopAeList
                title="Top Active"
                rows={top3Active}
                metric="active"
                barColor={COLOR_ACTIVE}
              />
              <TopAeList
                title="Top Inactive"
                rows={top3Inactive}
                metric="inactive"
                barColor={COLOR_INACTIVE}
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h3 className="text-lg font-semibold text-slate-800">
                  Breakdown by AE
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    {sortedPartners.length} partner{sortedPartners.length === 1 ? "" : "s"}
                  </span>
                </h3>
              </div>
              <button
                type="button"
                onClick={exportExcel}
                disabled={sortedPartners.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
                title={
                  sortedPartners.length === 0
                    ? "No rows to export"
                    : `Export ${sortedPartners.length.toLocaleString()} partner${sortedPartners.length === 1 ? "" : "s"}`
                }
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
            </div>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-slate-600 border-b border-slate-200">
                    <SortHeader k="partner_no" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggle(setSortKey, setSortDir, sortKey, sortDir, k)}>
                      Partner
                    </SortHeader>
                    <SortHeader k="active" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggle(setSortKey, setSortDir, sortKey, sortDir, k)} numeric>
                      Active
                    </SortHeader>
                    <SortHeader k="inactive" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggle(setSortKey, setSortDir, sortKey, sortDir, k)} numeric>
                      Inactive
                    </SortHeader>
                    <SortHeader k="total" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggle(setSortKey, setSortDir, sortKey, sortDir, k)} numeric>
                      Total
                    </SortHeader>
                    <SortHeader k="rate" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggle(setSortKey, setSortDir, sortKey, sortDir, k)} numeric>
                      Active %
                    </SortHeader>
                    <th className="px-4 py-2.5 font-semibold text-slate-600 w-48">
                      Distribution
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPartners.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-500">
                        No approved merchants for this date.
                      </td>
                    </tr>
                  )}
                  {sortedPartners.map((p) => {
                    const rate = p.total > 0 ? p.active / p.total : 0;
                    return (
                      <tr key={p.partner_no} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-xs font-medium text-slate-800 whitespace-nowrap">
                          {p.partner_no}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-medium tabular-nums text-emerald-700">
                          {p.active.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-medium tabular-nums text-slate-600">
                          {p.inactive.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-medium tabular-nums text-slate-800">
                          {p.total.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-700">
                          {formatPct(rate)}
                        </td>
                        <td className="px-4 py-2">
                          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${rate * 100}%` }}
                              title={`Active: ${p.active} (${formatPct(rate)})`}
                            />
                            <div
                              className="h-full bg-slate-300"
                              style={{ width: `${(1 - rate) * 100}%` }}
                              title={`Inactive: ${p.inactive} (${formatPct(1 - rate)})`}
                            />
                          </div>
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

// Renders the stacked-bar total as a single, non-wrapping SVG <text> to the
// right of the bar. (recharts' default label Text wraps words to fit the bar
// width, which splits "Total = 35" across three lines on thin segments.)
function TotalLabel(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
}) {
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const width = Number(props.width ?? 0);
  const height = Number(props.height ?? 0);
  const total = Number(props.value ?? 0);
  return (
    <text
      x={x + width + 8}
      y={y + height / 2}
      fill="#475569"
      fontSize={11}
      fontWeight={600}
      textAnchor="start"
      dominantBaseline="central"
    >
      {`Total = ${total.toLocaleString()}`}
    </text>
  );
}

function TopAeList({
  title,
  rows,
  metric,
  barColor,
}: {
  title: string;
  rows: PartnerRow[];
  metric: "active" | "inactive";
  barColor: string;
}) {
  const max = rows.reduce((m, p) => Math.max(m, p[metric]), 0);
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
        <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-sm">
          No {metric} merchants for any AE.
        </div>
      ) : (
        <ol className="space-y-2">
          {rows.map((p, i) => {
            const value = p[metric];
            const width = max > 0 ? (value / max) * 100 : 0;
            return (
              <li key={p.partner_no} className="flex items-center gap-3">
                <span className="flex-none w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold flex items-center justify-center tabular-nums">
                  {i + 1}
                </span>
                <span className="flex-none w-20 font-mono text-xs font-medium text-slate-800">
                  {p.partner_no}
                </span>
                <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${width}%`, backgroundColor: barColor }}
                  />
                </div>
                <span className="flex-none w-16 text-right font-mono text-sm font-semibold tabular-nums text-slate-800">
                  {value.toLocaleString()}
                </span>
                <span className="flex-none w-14 text-right font-mono text-xs tabular-nums text-slate-400">
                  {formatPct(p.total > 0 ? value / p.total : 0)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function toggle(
  setKey: (k: SortKey) => void,
  setDir: (d: SortDir) => void,
  currentKey: SortKey,
  currentDir: SortDir,
  k: SortKey,
) {
  if (currentKey === k) {
    setDir(currentDir === "asc" ? "desc" : "asc");
  } else {
    setKey(k);
    setDir(k === "partner_no" ? "asc" : "desc");
  }
}

function SortHeader({
  k,
  sortKey,
  sortDir,
  onSort,
  children,
  numeric,
}: {
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
  numeric?: boolean;
}) {
  const arrow = sortKey !== k ? "" : sortDir === "asc" ? " ↑" : " ↓";
  return (
    <th
      onClick={() => onSort(k)}
      className={`px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap ${
        numeric ? "text-right" : ""
      }`}
    >
      {children}
      <span className="text-brand-600">{arrow}</span>
    </th>
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

function LegendDot({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 text-slate-700">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      <span className="font-mono font-medium tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}
