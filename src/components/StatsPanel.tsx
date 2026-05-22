"use client";

import { useCallback, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { formatReportDateShort } from "@/lib/date-range";

export interface StatsMerchant {
  mid: string;
  merchantName: string;
  partner: string | null;
  top5Count: number;
  top10Count: number;
  top25Count: number;
  daysAppeared: number;
  totalAmount: number;
  bestRank: number;
}

export interface StatsResponse {
  from: string;
  to: string;
  dayCount: number;
  merchants: StatsMerchant[];
  topPerformers: {
    top5: { mid: string; merchantName: string; count: number } | null;
    top10: { mid: string; merchantName: string; count: number } | null;
    top25: { mid: string; merchantName: string; count: number } | null;
  };
}

type SortKey =
  | "merchantName"
  | "top5Count"
  | "top10Count"
  | "top25Count"
  | "daysAppeared"
  | "totalAmount"
  | "bestRank";

const COLOR_TOP5 = "#A4262C";
const COLOR_TOP10 = "#d4a017";
const COLOR_TOP25 = "#475569";

export default function StatsPanel({ data }: { data: StatsResponse }) {
  const [sortKey, setSortKey] = useState<SortKey>("top5Count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

  const chartData = useMemo(
    () =>
      data.merchants.slice(0, 10).map((m) => ({
        name: m.merchantName,
        mid: m.mid,
        // Show counts as "exclusive" tiers in the stack so the bar height
        // equals the top-25 count (not double/triple-counted).
        inTop5: m.top5Count,
        inTop6to10: Math.max(0, m.top10Count - m.top5Count),
        inTop11to25: Math.max(0, m.top25Count - m.top10Count),
      })),
    [data.merchants]
  );

  const filteredSorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? data.merchants.filter(
          (m) =>
            m.merchantName.toLowerCase().includes(term) ||
            m.mid.toLowerCase().includes(term) ||
            (m.partner ?? "").toLowerCase().includes(term)
        )
      : data.merchants;
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "merchantName":
          cmp = a.merchantName.localeCompare(b.merchantName);
          break;
        case "bestRank":
          cmp = a.bestRank - b.bestRank;
          break;
        case "top5Count":
          cmp = a.top5Count - b.top5Count;
          break;
        case "top10Count":
          cmp = a.top10Count - b.top10Count;
          break;
        case "top25Count":
          cmp = a.top25Count - b.top25Count;
          break;
        case "daysAppeared":
          cmp = a.daysAppeared - b.daysAppeared;
          break;
        case "totalAmount":
          cmp = a.totalAmount - b.totalAmount;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [data.merchants, search, sortKey, sortDir]);

  const handleExport = useCallback(() => {
    const rows = filteredSorted.map((m) => ({
      Merchant: m.merchantName,
      MID: m.mid,
      Partner: m.partner ?? "",
      "Best rank": m.bestRank,
      "Top 5": m.top5Count,
      "Top 10": m.top10Count,
      "Top 25": m.top25Count,
      Days: m.daysAppeared,
      "Total amount (THB)": Number(m.totalAmount.toFixed(2)),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 36 },
      { wch: 16 },
      { wch: 18 },
      { wch: 10 },
      { wch: 8 },
      { wch: 8 },
      { wch: 8 },
      { wch: 8 },
      { wch: 18 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leaderboard");
    XLSX.writeFile(wb, `leaderboard-${data.from}-to-${data.to}.xlsx`);
  }, [filteredSorted, data.from, data.to]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "merchantName" || k === "bestRank" ? "asc" : "desc");
    }
  }

  function arrow(k: SortKey) {
    if (sortKey !== k) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          label="Reports analyzed"
          value={data.dayCount.toString()}
          sub={`${formatReportDateShort(data.from)} → ${formatReportDateShort(data.to)}`}
          accent="brand"
        />
        <PerformerCard
          label="Most Top-5 appearances"
          performer={data.topPerformers.top5}
          dayCount={data.dayCount}
          color={COLOR_TOP5}
        />
        <PerformerCard
          label="Most Top-10 appearances"
          performer={data.topPerformers.top10}
          dayCount={data.dayCount}
          color={COLOR_TOP10}
        />
        <PerformerCard
          label="Most Top-25 appearances"
          performer={data.topPerformers.top25}
          dayCount={data.dayCount}
          color={COLOR_TOP25}
        />
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
          <h3 className="text-lg font-semibold text-slate-800">
            Top 10 Merchants — Tier appearances across {data.dayCount} report
            {data.dayCount === 1 ? "" : "s"}
          </h3>
        </div>
        <div style={{ width: "100%", height: 420 }}>
          <ResponsiveContainer>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                type="number"
                stroke="#64748b"
                fontSize={12}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="#64748b"
                fontSize={11}
                width={140}
                tick={{ textAnchor: "end" }}
              />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                formatter={(v: number, name: string) => [v, name]}
                labelFormatter={(label: string) => {
                  const row = chartData.find((d) => d.name === label);
                  return `${label} (${row?.mid})`;
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="inTop5"
                name="In Top 5"
                stackId="tier"
                fill={COLOR_TOP5}
              />
              <Bar
                dataKey="inTop6to10"
                name="Rank 6–10"
                stackId="tier"
                fill={COLOR_TOP10}
              />
              <Bar
                dataKey="inTop11to25"
                name="Rank 11–25"
                stackId="tier"
                fill={COLOR_TOP25}
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Bars stack each merchant&apos;s appearances by rank tier. Total bar
          length equals their Top-25 count.
        </p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
            <h3 className="text-lg font-semibold text-slate-800">
              Leaderboard ({data.merchants.length} merchants)
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              placeholder="Search merchant, MID, or partner..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-md text-sm w-64 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
            />
            <button
              type="button"
              onClick={handleExport}
              disabled={filteredSorted.length === 0}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm whitespace-nowrap"
              title="Download the current leaderboard as Excel"
            >
              Export Excel
            </button>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[600px]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="text-left text-slate-600 border-b border-slate-200">
                <Th onClick={() => toggleSort("merchantName")}>
                  Merchant{arrow("merchantName")}
                </Th>
                <Th>Partner</Th>
                <Th
                  onClick={() => toggleSort("bestRank")}
                  className="text-right"
                >
                  Best rank{arrow("bestRank")}
                </Th>
                <Th
                  onClick={() => toggleSort("top5Count")}
                  className="text-right"
                >
                  Top 5{arrow("top5Count")}
                </Th>
                <Th
                  onClick={() => toggleSort("top10Count")}
                  className="text-right"
                >
                  Top 10{arrow("top10Count")}
                </Th>
                <Th
                  onClick={() => toggleSort("top25Count")}
                  className="text-right"
                >
                  Top 25{arrow("top25Count")}
                </Th>
                <Th
                  onClick={() => toggleSort("daysAppeared")}
                  className="text-right"
                >
                  Days{arrow("daysAppeared")}
                </Th>
                <Th
                  onClick={() => toggleSort("totalAmount")}
                  className="text-right"
                >
                  Total amount{arrow("totalAmount")}
                </Th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((m) => (
                <tr
                  key={m.mid}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800">
                      {m.merchantName}
                    </div>
                    <div className="font-mono text-xs text-slate-500">
                      {m.mid}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {m.partner ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    #{m.bestRank}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <TierPill count={m.top5Count} total={data.dayCount} color={COLOR_TOP5} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <TierPill count={m.top10Count} total={data.dayCount} color={COLOR_TOP10} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <TierPill count={m.top25Count} total={data.dayCount} color={COLOR_TOP25} />
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {m.daysAppeared}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-medium">
                    {m.totalAmount.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              ))}
              {filteredSorted.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No merchants match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "brand";
}) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-block w-1 h-4 rounded-full ${
            accent === "brand" ? "bg-brand-600" : "bg-slate-400"
          }`}
        />
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function PerformerCard({
  label,
  performer,
  dayCount,
  color,
}: {
  label: string;
  performer: { mid: string; merchantName: string; count: number } | null;
  dayCount: number;
  color: string;
}) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-block w-1 h-4 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </div>
      </div>
      {performer ? (
        <>
          <div className="text-base font-semibold text-slate-900 line-clamp-1">
            {performer.merchantName}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {performer.count} of {dayCount} report{dayCount === 1 ? "" : "s"}
          </div>
        </>
      ) : (
        <div className="text-sm text-slate-500">No data</div>
      )}
    </div>
  );
}

function TierPill({
  count,
  total,
  color,
}: {
  count: number;
  total: number;
  color: string;
}) {
  if (count === 0) return <span className="text-slate-400 font-mono">0</span>;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-mono font-medium"
      style={{
        backgroundColor: `${color}15`,
        color,
      }}
      title={`${pct}% of reports`}
    >
      {count}
      <span className="text-[10px] opacity-70">({pct}%)</span>
    </span>
  );
}

function Th({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-2.5 font-semibold ${
        onClick ? "cursor-pointer select-none hover:text-slate-900" : ""
      } ${className}`}
    >
      {children}
    </th>
  );
}
