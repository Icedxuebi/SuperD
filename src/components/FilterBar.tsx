"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatReportDate,
  formatWeekRange,
  formatMonth,
  weekStartOf,
  monthStartOf,
} from "@/lib/date-range";

export type FilterMode = "date" | "week" | "month" | "stats";

export interface PeriodOption {
  id: number;
  dateStart: string;
  dateEnd: string;
}

interface Props {
  mode: FilterMode;
  selectedDate: string;
  periods: PeriodOption[];
  onChange: (mode: FilterMode, selectedDate: string) => void;
  statsFrom: string;
  statsTo: string;
  onStatsRangeChange: (from: string, to: string) => void;
}

export default function FilterBar({
  mode,
  selectedDate,
  periods,
  onChange,
  statsFrom,
  statsTo,
  onStatsRangeChange,
}: Props) {
  const [localDate, setLocalDate] = useState(selectedDate);

  useEffect(() => setLocalDate(selectedDate), [selectedDate]);

  const availableWeeks = useMemo(() => {
    const set = new Set<string>();
    for (const p of periods) set.add(weekStartOf(p.dateStart));
    return Array.from(set).sort().reverse();
  }, [periods]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const p of periods) set.add(monthStartOf(p.dateStart));
    return Array.from(set).sort().reverse();
  }, [periods]);

  const currentWeekStart = selectedDate ? weekStartOf(selectedDate) : "";
  const currentMonthStart = selectedDate ? monthStartOf(selectedDate) : "";

  const { minDate, maxDate } = useMemo(() => {
    if (periods.length === 0) return { minDate: "", maxDate: "" };
    const sorted = [...periods].map((p) => p.dateStart).sort();
    return { minDate: sorted[0], maxDate: sorted[sorted.length - 1] };
  }, [periods]);

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-center gap-4">
      <div className="inline-flex gap-1 bg-slate-100 rounded-lg p-1">
        {(["date", "week", "month", "stats"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onChange(m, localDate)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              mode === m
                ? "bg-white shadow-sm text-brand-700"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {m === "date"
              ? "By Date"
              : m === "week"
              ? "By Week"
              : m === "month"
              ? "By Month"
              : "Stats"}
          </button>
        ))}
      </div>

      {mode === "date" && (
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Report:</label>
          <select
            value={localDate}
            onChange={(e) => {
              setLocalDate(e.target.value);
              onChange("date", e.target.value);
            }}
            className="px-3 py-1.5 border border-slate-300 rounded-md text-sm bg-white hover:border-slate-400 transition-colors min-w-[180px]"
          >
            {periods.length === 0 && <option value="">No data uploaded yet</option>}
            {periods.map((p) => (
              <option key={p.id} value={p.dateStart}>
                {formatReportDate(p.dateStart)}
              </option>
            ))}
          </select>
        </div>
      )}

      {mode === "week" && (
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Week:</label>
          <select
            value={currentWeekStart}
            onChange={(e) => {
              setLocalDate(e.target.value);
              onChange("week", e.target.value);
            }}
            className="px-3 py-1.5 border border-slate-300 rounded-md text-sm bg-white hover:border-slate-400 transition-colors min-w-[220px]"
          >
            {availableWeeks.length === 0 && <option value="">No data uploaded yet</option>}
            {availableWeeks.map((ws) => (
              <option key={ws} value={ws}>
                {formatWeekRange(ws)}
              </option>
            ))}
          </select>
        </div>
      )}

      {mode === "month" && (
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Month:</label>
          <select
            value={currentMonthStart}
            onChange={(e) => {
              setLocalDate(e.target.value);
              onChange("month", e.target.value);
            }}
            className="px-3 py-1.5 border border-slate-300 rounded-md text-sm bg-white hover:border-slate-400 transition-colors min-w-[180px]"
          >
            {availableMonths.length === 0 && <option value="">No data uploaded yet</option>}
            {availableMonths.map((ms) => (
              <option key={ms} value={ms}>
                {formatMonth(ms)}
              </option>
            ))}
          </select>
        </div>
      )}

      {mode === "stats" && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm font-medium text-slate-600">From:</label>
          <input
            type="date"
            value={statsFrom}
            min={minDate || undefined}
            max={maxDate || undefined}
            onChange={(e) => onStatsRangeChange(e.target.value, statsTo)}
            className="px-3 py-1.5 border border-slate-300 rounded-md text-sm bg-white hover:border-slate-400 transition-colors"
          />
          <label className="text-sm font-medium text-slate-600">To:</label>
          <input
            type="date"
            value={statsTo}
            min={statsFrom || minDate || undefined}
            max={maxDate || undefined}
            onChange={(e) => onStatsRangeChange(statsFrom, e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-md text-sm bg-white hover:border-slate-400 transition-colors"
          />
        </div>
      )}

      <div className="ml-auto text-sm text-slate-500 flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
        {periods.length} report{periods.length === 1 ? "" : "s"} available
      </div>
    </div>
  );
}
