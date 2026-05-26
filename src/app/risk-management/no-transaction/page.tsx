"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Row = {
  merchant_no: string | null;
  merchant_name: string | null;
  state: string | null;
  enabled: boolean | null;
  partner_no: string | null;
  last_success_date: string | null;
};

type SortKey =
  | "merchant_no"
  | "merchant_name"
  | "state"
  | "enabled"
  | "partner_no"
  | "last_success_date";

type SortDir = "asc" | "desc";

type Days = 75 | 90 | 120;

const DAY_OPTIONS: Days[] = [75, 90, 120];

function StateBadge({ state }: { state: string | null }) {
  if (!state) return <span className="text-slate-400">—</span>;
  const color =
    state === "APPROVE"
      ? "bg-emerald-100 text-emerald-700"
      : state === "REJECT"
        ? "bg-red-100 text-red-700"
        : state.startsWith("PRE_") || state === "REGISTER"
          ? "bg-amber-100 text-amber-700"
          : state === "BUSINESS_APPROVE"
            ? "bg-brand-100 text-brand-700"
            : "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${color}`}
    >
      {state.toLowerCase()}
    </span>
  );
}

function YesNoPill({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  return value ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-100 text-emerald-700">
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600">
      No
    </span>
  );
}

function daysSince(date: string | null | undefined): number | null {
  if (!date) return null;
  const cleaned = String(date).replace("T", " ").replace("Z", "").slice(0, 19);
  const ms = Date.parse(cleaned.replace(" ", "T") + "+07:00");
  if (!Number.isFinite(ms)) return null;
  const diffMs = Date.now() - ms;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function lastTransactionLabel(date: string | null | undefined): string {
  const d = daysSince(date);
  if (d === null) return "Never";
  if (d === 0) return "Today";
  if (d === 1) return "1 day ago";
  return `${d.toLocaleString()} days ago`;
}

export default function NoTransactionPage() {
  const [days, setDays] = useState<Days>(75);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("last_success_date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/no-transaction?days=${days}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Query failed (${res.status})`);
        return body;
      })
      .then((body) => {
        if (!cancelled) setRows(body.rows as Row[]);
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
  }, [days]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    const list = needle
      ? rows.filter((r) => {
          const hay = [
            r.merchant_no,
            r.merchant_name,
            r.state,
            r.partner_no,
            r.last_success_date,
          ]
            .filter((v): v is string => typeof v === "string" && v.length > 0)
            .join("  ")
            .toLowerCase();
          return hay.includes(needle);
        })
      : rows.slice();

    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "merchant_no":
          cmp = (a.merchant_no ?? "").localeCompare(b.merchant_no ?? "", undefined, { numeric: true });
          break;
        case "merchant_name":
          cmp = (a.merchant_name ?? "").localeCompare(b.merchant_name ?? "", undefined, { sensitivity: "base" });
          break;
        case "state":
          cmp = (a.state ?? "").localeCompare(b.state ?? "");
          break;
        case "enabled":
          cmp = Number(a.enabled ?? false) - Number(b.enabled ?? false);
          break;
        case "partner_no":
          cmp = (a.partner_no ?? "").localeCompare(b.partner_no ?? "", undefined, { numeric: true });
          break;
        case "last_success_date": {
          // Nulls (never) sort to the top in ASC (oldest / never first), bottom in DESC.
          const an = a.last_success_date == null;
          const bn = b.last_success_date == null;
          if (an && bn) cmp = 0;
          else if (an) cmp = -1;
          else if (bn) cmp = 1;
          else cmp = (a.last_success_date ?? "").localeCompare(b.last_success_date ?? "");
          break;
        }
      }
      return cmp * dir;
    });
    return list;
  }, [rows, q, sortBy, sortDir]);

  function onSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(key === "last_success_date" ? "asc" : "asc");
    }
  }

  function arrow(key: SortKey) {
    if (sortBy !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  function exportExcel() {
    if (filtered.length === 0) return;
    const sheetData = filtered.map((r) => ({
      MID: r.merchant_no ?? "",
      "Merchant name": r.merchant_name ?? "",
      State: r.state ? r.state.toLowerCase() : "",
      Enabled: r.enabled ?? false,
      "Partner Code": r.partner_no ?? "",
      "Last transaction": lastTransactionLabel(r.last_success_date),
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData, {
      header: [
        "MID",
        "Merchant name",
        "State",
        "Enabled",
        "Partner Code",
        "Last transaction",
      ],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `No Tx ${days}d`);
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `NoTransaction-${days}days-${stamp}.xlsx`);
  }

  const total = rows?.length ?? 0;
  const shown = filtered.length;
  const neverCount = rows?.filter((r) => !r.last_success_date).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">No Transaction 90 / 120</h1>
        <p className="text-slate-600">
          Live merchants (close date not set) that have not had a successful payment in the selected
          window.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryStat label={`Inactive in past ${days} days`} value={total} />
        <SummaryStat label="Never transacted" value={neverCount} />
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Window</span>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as Days)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors min-w-[140px]"
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 flex-1 min-w-[260px]">
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
              placeholder="Search by MID, merchant name, partner code, state…"
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
          disabled={shown === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
          title={
            shown === 0
              ? "No rows to export"
              : `Export ${shown.toLocaleString()} row${shown === 1 ? "" : "s"}`
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

      <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
            <h3 className="text-lg font-semibold text-slate-800">
              Inactive merchants
              <span className="text-sm font-normal text-slate-500 ml-2">
                {shown.toLocaleString()}
                {shown !== total ? ` of ${total.toLocaleString()}` : ""}
              </span>
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[640px]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="text-left text-slate-600 border-b border-slate-200">
                <Th label="MID" col="merchant_no" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                <Th
                  label="Merchant name"
                  col="merchant_name"
                  sortBy={sortBy}
                  arrow={arrow}
                  onSort={onSort}
                />
                <Th label="State" col="state" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                <Th label="Enabled" col="enabled" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                <Th
                  label="Partner Code"
                  col="partner_no"
                  sortBy={sortBy}
                  arrow={arrow}
                  onSort={onSort}
                />
                <Th
                  label="Last transaction"
                  col="last_success_date"
                  sortBy={sortBy}
                  arrow={arrow}
                  onSort={onSort}
                />
              </tr>
            </thead>
            <tbody>
              {!rows && loading && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {rows && shown === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    {total === 0
                      ? `No merchants are inactive in the past ${days} days.`
                      : "No rows match this search."}
                  </td>
                </tr>
              )}
              {filtered.map((r, i) => {
                const isNever = !r.last_success_date;
                return (
                  <tr
                    key={`${r.merchant_no ?? "x"}-${i}`}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-4 py-2 font-mono text-xs text-slate-800 whitespace-nowrap">
                      {r.merchant_no ? (
                        <Link
                          href={`/application-support/merchant-lookup/${r.merchant_no}`}
                          className="text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          {r.merchant_no}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-800">{r.merchant_name ?? "—"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <StateBadge state={r.state} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <YesNoPill value={r.enabled} />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                      {r.partner_no ?? "—"}
                    </td>
                    <td
                      className={`px-4 py-2 whitespace-nowrap font-mono text-xs ${
                        isNever ? "text-red-600" : "text-slate-700"
                      }`}
                      title={r.last_success_date ?? "No successful payment on record"}
                    >
                      {lastTransactionLabel(r.last_success_date)}
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

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex items-center gap-3">
      <span className="inline-block w-1 h-10 rounded-full bg-brand-600" />
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div className="text-2xl font-bold font-mono text-slate-900">{value.toLocaleString()}</div>
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
}: {
  label: string;
  col: SortKey;
  sortBy: SortKey;
  arrow: (k: SortKey) => string;
  onSort: (k: SortKey) => void;
}) {
  return (
    <th
      onClick={() => onSort(col)}
      className="px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap"
      aria-sort={sortBy === col ? "ascending" : "none"}
    >
      {label}
      <span className="text-brand-600">{arrow(col)}</span>
    </th>
  );
}
