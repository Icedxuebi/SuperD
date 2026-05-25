"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Row = {
  merchant_no: string | null;
  merchant_name: string | null;
  state: string | null;
  remark: string | null;
  close_date: string | null;
  close_remark: string | null;
  full_name_th: string | null;
  full_name_en: string | null;
  tax_id?: string | null;
  phone_number?: string | null;
};

type SortKey =
  | "merchant_no"
  | "merchant_name"
  | "state"
  | "remark"
  | "close_date"
  | "close_remark"
  | "full_name"
  | "value";

type SortDir = "asc" | "desc";

export type DuplicateFinderMode = "tax_id" | "phone_number";

const MODE_LABEL: Record<DuplicateFinderMode, string> = {
  tax_id: "Citizen ID",
  phone_number: "Phone Number",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return String(value).replace("T", " ").replace("Z", "").slice(0, 10);
}

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
      {state}
    </span>
  );
}

function fullName(r: Row): string {
  return r.full_name_th?.trim() || r.full_name_en?.trim() || "";
}

function rowValue(r: Row, mode: DuplicateFinderMode): string {
  return (mode === "tax_id" ? r.tax_id : r.phone_number) ?? "";
}

export function DuplicateFinder({
  mode,
  apiPath,
  title,
  subtitle,
  exportFilename,
}: {
  mode: DuplicateFinderMode;
  apiPath: string;
  title: string;
  subtitle: string;
  exportFilename: string;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(apiPath)
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
  }, [apiPath]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    const list = needle
      ? rows.filter((r) => {
          const hay = [
            r.merchant_no,
            r.merchant_name,
            r.state,
            r.remark,
            r.close_remark,
            r.close_date,
            fullName(r),
            rowValue(r, mode),
          ]
            .filter((v): v is string => typeof v === "string" && v.length > 0)
            .join("  ")
            .toLowerCase();
          return hay.includes(needle);
        })
      : rows.slice();

    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let av: string;
      let bv: string;
      switch (sortBy) {
        case "merchant_no":
          av = a.merchant_no ?? "";
          bv = b.merchant_no ?? "";
          break;
        case "merchant_name":
          av = a.merchant_name ?? "";
          bv = b.merchant_name ?? "";
          break;
        case "state":
          av = a.state ?? "";
          bv = b.state ?? "";
          break;
        case "remark":
          av = a.remark ?? "";
          bv = b.remark ?? "";
          break;
        case "close_date":
          av = a.close_date ?? "";
          bv = b.close_date ?? "";
          break;
        case "close_remark":
          av = a.close_remark ?? "";
          bv = b.close_remark ?? "";
          break;
        case "full_name":
          av = fullName(a);
          bv = fullName(b);
          break;
        case "value":
        default:
          av = rowValue(a, mode);
          bv = rowValue(b, mode);
          break;
      }
      return av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
    return list;
  }, [rows, q, sortBy, sortDir, mode]);

  const groupCount = useMemo(() => {
    if (!rows) return 0;
    const seen = new Set<string>();
    for (const r of rows) {
      const v = rowValue(r, mode);
      if (v) seen.add(v);
    }
    return seen.size;
  }, [rows, mode]);

  function onSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  }

  function arrow(key: SortKey) {
    if (sortBy !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  function exportExcel() {
    if (filtered.length === 0) return;
    const valueLabel = MODE_LABEL[mode];
    const sheetData = filtered.map((r) => ({
      MID: r.merchant_no ?? "",
      Merchant: r.merchant_name ?? "",
      State: r.state ?? "",
      Remark: r.remark ?? "",
      "Close Date": formatDate(r.close_date),
      "Close Remark": r.close_remark ?? "",
      Fullname: fullName(r),
      [valueLabel]: rowValue(r, mode),
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData, {
      header: [
        "MID",
        "Merchant",
        "State",
        "Remark",
        "Close Date",
        "Close Remark",
        "Fullname",
        valueLabel,
      ],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Duplicates");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `${exportFilename}-${stamp}.xlsx`);
  }

  const total = rows?.length ?? 0;
  const shownCount = filtered.length;
  const valueLabel = MODE_LABEL[mode];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">{title}</h1>
        <p className="text-slate-600">{subtitle}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryStat label={`Duplicate ${valueLabel}s`} value={groupCount} />
        <SummaryStat label="Merchants involved" value={total} />
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
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
              placeholder={`Search by MID, merchant, fullname, ${valueLabel.toLowerCase()}…`}
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
          disabled={shownCount === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
          title={
            shownCount === 0
              ? "No rows to export"
              : `Export ${shownCount.toLocaleString()} row${shownCount === 1 ? "" : "s"}`
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
              Results
              <span className="text-sm font-normal text-slate-500 ml-2">
                {shownCount.toLocaleString()}
                {shownCount !== total ? ` of ${total.toLocaleString()}` : ""} merchant
                {shownCount === 1 ? "" : "s"}
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
                  label="Merchant"
                  col="merchant_name"
                  sortBy={sortBy}
                  arrow={arrow}
                  onSort={onSort}
                />
                <Th label="State" col="state" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                <Th label="Remark" col="remark" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                <Th
                  label="Close Date"
                  col="close_date"
                  sortBy={sortBy}
                  arrow={arrow}
                  onSort={onSort}
                />
                <Th
                  label="Close Remark"
                  col="close_remark"
                  sortBy={sortBy}
                  arrow={arrow}
                  onSort={onSort}
                />
                <Th
                  label="Fullname"
                  col="full_name"
                  sortBy={sortBy}
                  arrow={arrow}
                  onSort={onSort}
                />
                <Th label={valueLabel} col="value" sortBy={sortBy} arrow={arrow} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {!rows && loading && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {rows && shownCount === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500">
                    {total === 0 ? "No duplicates found." : "No rows match this search."}
                  </td>
                </tr>
              )}
              {filtered.map((r, i) => {
                const prev = i > 0 ? filtered[i - 1] : null;
                const isGroupStart = !prev || rowValue(prev, mode) !== rowValue(r, mode);
                return (
                  <tr
                    key={`${r.merchant_no ?? "x"}-${rowValue(r, mode)}-${i}`}
                    className={`border-b border-slate-100 hover:bg-slate-50 ${
                      isGroupStart && i > 0 ? "border-t-2 border-t-slate-200" : ""
                    }`}
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
                    <td
                      className="px-4 py-2 text-slate-700 max-w-xs truncate"
                      title={r.remark ?? ""}
                    >
                      {r.remark ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                      {formatDate(r.close_date)}
                    </td>
                    <td
                      className="px-4 py-2 text-slate-700 max-w-sm break-words"
                      title={r.close_remark ?? ""}
                    >
                      {r.close_remark ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                      {fullName(r) || "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-slate-800">
                      {rowValue(r, mode) || "—"}
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
