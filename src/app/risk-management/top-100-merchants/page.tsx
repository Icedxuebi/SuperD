"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import FilterBar, { type FilterMode, type PeriodOption } from "@/components/FilterBar";
import SummaryCards from "@/components/SummaryCards";
import TopMerchantsBarChart from "@/components/TopMerchantsBarChart";
import type { MerchantRow } from "@/lib/top100-types";
import PartnerPieChart from "@/components/PartnerPieChart";
import TrendLineChart from "@/components/TrendLineChart";
import MerchantTable from "@/components/MerchantTable";
import StatsPanel, { type StatsResponse } from "@/components/StatsPanel";
import {
  formatReportDate,
  formatReportDateShort,
  formatWeekRange,
  formatMonth,
  weekStartOf,
  monthStartOf,
} from "@/lib/date-range";

interface Summary {
  totalMerchants: number;
  totalAmount: number;
  topMerchant: string | null;
  topMerchantAmount: number;
  uniquePartners: number;
  partnerBreakdown: Array<{ partner: string; amount: number }>;
}

interface MerchantsResponse {
  merchants: MerchantRow[];
  trend: Array<Record<string, string | number>>;
  top5Names: string[];
  dayCount: number;
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const r = new Date(d);
  r.setDate(d.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfWeekSunday(d: Date): Date {
  const s = startOfWeekMonday(d);
  const r = new Date(s);
  r.setDate(s.getDate() + 6);
  r.setHours(23, 59, 59, 999);
  return r;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function Top100MerchantsPage() {
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [mode, setMode] = useState<FilterMode>("date");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [statsFrom, setStatsFrom] = useState<string>("");
  const [statsTo, setStatsTo] = useState<string>("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [merchantsData, setMerchantsData] = useState<MerchantsResponse | null>(null);
  const [statsData, setStatsData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { from, to } = useMemo(() => {
    if (mode === "stats") return { from: statsFrom, to: statsTo };
    if (!selectedDate) return { from: "", to: "" };
    const [y, m, d] = selectedDate.split("-").map(Number);
    const anchor = new Date(y, m - 1, d);
    if (mode === "week")
      return { from: fmt(startOfWeekMonday(anchor)), to: fmt(endOfWeekSunday(anchor)) };
    if (mode === "month")
      return { from: fmt(startOfMonth(anchor)), to: fmt(endOfMonth(anchor)) };
    return { from: selectedDate, to: selectedDate };
  }, [mode, selectedDate, statsFrom, statsTo]);

  useEffect(() => {
    fetch("/api/top100/periods")
      .then((r) => r.json())
      .then((data: { periods: PeriodOption[] }) => {
        setPeriods(data.periods);
        if (data.periods.length) {
          if (!selectedDate) setSelectedDate(data.periods[0].dateStart);
          if (!statsTo || !statsFrom) {
            const sorted = [...data.periods].map((p) => p.dateStart).sort();
            const newest = sorted[sorted.length - 1];
            const oldest = sorted[0];
            const defaultFrom = sorted[Math.max(0, sorted.length - 7)] ?? oldest;
            if (!statsFrom) setStatsFrom(defaultFrom);
            if (!statsTo) setStatsTo(newest);
          }
        }
      })
      .catch((err) => setError(err.message));
  }, [selectedDate, statsFrom, statsTo]);

  const fetchData = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === "stats") {
        const res = await fetch(`/api/top100/stats?from=${from}&to=${to}`);
        if (!res.ok) throw new Error("Failed to load stats data");
        const data: StatsResponse = await res.json();
        setStatsData(data);
      } else {
        const [sumRes, merchRes] = await Promise.all([
          fetch(`/api/top100/summary?from=${from}&to=${to}`),
          fetch(`/api/top100/merchants?from=${from}&to=${to}`),
        ]);
        if (!sumRes.ok || !merchRes.ok) throw new Error("Failed to load dashboard data");
        const sumData: Summary = await sumRes.json();
        const merchData: MerchantsResponse = await merchRes.json();
        setSummary(sumData);
        setMerchantsData(merchData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [from, to, mode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleFilterChange(newMode: FilterMode, newDate: string) {
    setMode(newMode);
    if (newMode !== "stats") setSelectedDate(newDate);
  }

  function handleStatsRangeChange(newFrom: string, newTo: string) {
    setStatsFrom(newFrom);
    setStatsTo(newTo);
  }

  const noData =
    !loading &&
    ((mode !== "stats" && summary && summary.totalMerchants === 0) ||
      (mode === "stats" && statsData && statsData.merchants.length === 0));
  const showTrend =
    (mode === "week" || mode === "month") && merchantsData && merchantsData.dayCount > 1;

  if (periods.length === 0 && !loading) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <h1 className="text-3xl font-bold mb-3">No payment data in the last 90 days</h1>
        <p className="text-slate-600">
          The dashboard pulls from <code>payment_transaction</code> directly — there are no
          recent rows to summarise.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">
            Top Merchant Transaction
          </h1>
          <p className="text-slate-600">
            {mode === "stats"
              ? statsFrom && statsTo
                ? `Stats from ${formatReportDateShort(statsFrom)} to ${formatReportDateShort(statsTo)}`
                : "Pick a date range to analyze"
              : !selectedDate
              ? "Pick a date to begin"
              : mode === "date"
              ? `Showing data for ${formatReportDate(selectedDate)}`
              : mode === "week"
              ? `Showing week of ${formatWeekRange(weekStartOf(selectedDate))}`
              : `Showing ${formatMonth(monthStartOf(selectedDate))}`}
          </p>
        </div>
      </div>

      <FilterBar
        mode={mode}
        selectedDate={selectedDate}
        periods={periods}
        onChange={handleFilterChange}
        statsFrom={statsFrom}
        statsTo={statsTo}
        onStatsRangeChange={handleStatsRangeChange}
      />

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-center py-12 text-slate-500">Loading dashboard data...</div>
      )}

      {noData && !loading && (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">
          No data for this date range. Try a different filter.
        </div>
      )}

      {!loading && mode === "stats" && statsData && statsData.merchants.length > 0 && (
        <StatsPanel data={statsData} />
      )}

      {!loading && mode !== "stats" && summary && merchantsData && summary.totalMerchants > 0 && (
        <>
          <SummaryCards
            totalMerchants={summary.totalMerchants}
            totalAmount={summary.totalAmount}
            topMerchant={summary.topMerchant}
            topMerchantAmount={summary.topMerchantAmount}
            uniquePartners={summary.uniquePartners}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TopMerchantsBarChart merchants={merchantsData.merchants} />
            <PartnerPieChart partners={summary.partnerBreakdown} />
          </div>

          {showTrend && (
            <TrendLineChart
              trend={merchantsData.trend}
              top5Names={merchantsData.top5Names}
            />
          )}

          <MerchantTable merchants={merchantsData.merchants} />
        </>
      )}
    </div>
  );
}
