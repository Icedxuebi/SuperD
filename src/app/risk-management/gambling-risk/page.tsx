"use client";

import { useEffect, useMemo, useState } from "react";

type GamblingRow = {
  merchant_id: string;
  hit_count: number;
  total_amount: number;
  last_transfer_date: string | null;
  sample_names: string[] | null;
  merchant_no: string | null;
  merchant_name_en: string | null;
  merchant_name_th: string | null;
  company_name_en: string | null;
  company_name_th: string | null;
  merchant_state: string | null;
  merchant_enabled: boolean | null;
  merchant_close_date: string | null;
  partner_no: string | null;
};

type ApiResponse = { patterns: string[]; rows: GamblingRow[]; count: number };

type SortKey =
  | "merchant_no"
  | "name"
  | "partner_no"
  | "state"
  | "enabled"
  | "hit_count"
  | "total_amount"
  | "last_transfer";
type SortDir = "asc" | "desc";

const thbFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function nameOf(r: GamblingRow): string {
  return (
    r.merchant_name_en?.trim() ||
    r.company_name_en?.trim() ||
    r.company_name_th?.trim() ||
    r.merchant_name_th?.trim() ||
    "—"
  );
}

function isLive(r: GamblingRow): boolean {
  return r.merchant_state === "APPROVE" && !r.merchant_close_date;
}

function shortTs(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 16).replace("T", " ");
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function exportCsv(rows: GamblingRow[]) {
  if (rows.length === 0) return;
  const header = [
    "MID",
    "Merchant Name",
    "Partner",
    "State",
    "Enabled",
    "Flagged transfers",
    "Total amount (THB)",
    "Last transfer",
    "Matched account names",
  ];
  const body = rows.map((r) => [
    r.merchant_no ?? "",
    nameOf(r) === "—" ? "" : nameOf(r),
    r.partner_no ?? "",
    r.merchant_state ?? "",
    r.merchant_enabled ? "Yes" : "No",
    String(r.hit_count),
    r.total_amount.toFixed(2),
    r.last_transfer_date ?? "",
    (r.sample_names ?? []).join(" | "),
  ]);
  const csv =
    "﻿" +
    [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `GamblingRisk_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GamblingRiskPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<"all" | "live" | "closed">("live");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("hit_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/gambling-risk`)
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

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let arr = data.rows;
    if (filter === "live") {
      arr = arr.filter((r) => isLive(r));
    } else if (filter === "closed") {
      arr = arr.filter((r) => !isLive(r));
    }
    if (q) {
      arr = arr.filter(
        (r) =>
          (r.merchant_no ?? "").toLowerCase().includes(q) ||
          (r.merchant_name_en ?? "").toLowerCase().includes(q) ||
          (r.merchant_name_th ?? "").toLowerCase().includes(q) ||
          (r.company_name_en ?? "").toLowerCase().includes(q) ||
          (r.company_name_th ?? "").toLowerCase().includes(q) ||
          (r.partner_no ?? "").toLowerCase().includes(q) ||
          (r.sample_names ?? []).some((n) => n.toLowerCase().includes(q)),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    arr = [...arr].sort((a, b) => {
      switch (sortKey) {
        case "merchant_no":
          return dir * (a.merchant_no ?? "").localeCompare(b.merchant_no ?? "");
        case "name":
          return dir * nameOf(a).localeCompare(nameOf(b));
        case "partner_no":
          return dir * (a.partner_no ?? "").localeCompare(b.partner_no ?? "");
        case "state":
          return dir * (a.merchant_state ?? "").localeCompare(b.merchant_state ?? "");
        case "enabled":
          return dir * (Number(a.merchant_enabled) - Number(b.merchant_enabled));
        case "hit_count":
          return dir * (a.hit_count - b.hit_count);
        case "total_amount":
          return dir * (a.total_amount - b.total_amount);
        case "last_transfer":
          return dir * (a.last_transfer_date ?? "").localeCompare(b.last_transfer_date ?? "");
      }
    });
    return arr;
  }, [data, filter, search, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "merchant_no" || k === "name" || k === "partner_no" ? "asc" : "desc");
    }
  }

  const kpis = useMemo(() => {
    const rows = data?.rows ?? [];
    const liveCount = rows.filter((r) => isLive(r)).length;
    const scopeTransfers = filteredRows.reduce((s, r) => s + r.hit_count, 0);
    const scopeAmount = filteredRows.reduce((s, r) => s + r.total_amount, 0);
    return {
      liveCount,
      total: rows.length,
      scopeTransfers,
      scopeAmount,
    };
  }, [data, filteredRows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Gambling Risk</h1>
        <p className="text-slate-600">
          Merchants whose outbound payouts in{" "}
          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
            transfer_transaction
          </span>{" "}
          go to destination accounts whose name reads like a gambling-site handle —{" "}
          <span className="font-medium">VIP</span> / <span className="font-medium">เครดิต</span>{" "}
          / <span className="font-medium">โบนัส</span>. This is a full scan of ~12.8M transfers,
          so the report can take ~30s to load.
        </p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Merchant scope</span>
          <div className="inline-flex gap-1 bg-slate-100 rounded-lg p-1">
            {(["live", "closed", "all"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
                  filter === k
                    ? "bg-white shadow-sm text-brand-700"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {k === "live" ? "Live only" : k === "closed" ? "Closed / pending" : "All"}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="ml-auto text-sm text-slate-500 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Scanning transfers… this can take ~30s
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
              accent="bg-brand-600"
              iconBg="bg-brand-50 text-brand-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.74-3l-7-12a2 2 0 00-3.48 0l-7 12A2 2 0 005 19z" />
                </svg>
              }
              label="Flagged merchants (live)"
              value={kpis.liveCount.toLocaleString()}
              sub="Still live — need review / closing"
            />
            <KpiCard
              accent="bg-slate-700"
              iconBg="bg-slate-100 text-slate-700"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M9 11a4 4 0 100-8 4 4 0 000 8zm6 0a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
              }
              label="Total flagged merchants"
              value={kpis.total.toLocaleString()}
              sub="Across all states incl. closed/pending"
            />
            <KpiCard
              accent="bg-accent-500"
              iconBg="bg-accent-50 text-accent-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v18h18" />
                  <path d="M7 14l4-4 3 3 4-5" />
                </svg>
              }
              label="Flagged transfers (scope)"
              value={kpis.scopeTransfers.toLocaleString()}
              sub={`${filter === "live" ? "Live" : filter === "closed" ? "Closed / pending" : "All"} merchants`}
            />
            <KpiCard
              accent="bg-brand-400"
              iconBg="bg-brand-50 text-brand-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1v22" />
                  <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                </svg>
              }
              label="Flagged amount (scope)"
              value={`฿${thbFmt.format(kpis.scopeAmount)}`}
              sub="Sum of flagged transfer amounts"
            />
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h3 className="text-lg font-semibold text-slate-800">
                  Flagged merchants
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    {filteredRows.length.toLocaleString()} of {data.rows.length.toLocaleString()}
                  </span>
                </h3>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="search"
                  placeholder="Search MID, name, partner, account name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-sm w-80 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => exportCsv(filteredRows)}
                  disabled={filteredRows.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M12 15V3" />
                  </svg>
                  Export CSV
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-slate-600 border-b border-slate-200">
                    <SortHeader k="merchant_no" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      MID
                    </SortHeader>
                    <SortHeader k="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Merchant Name
                    </SortHeader>
                    <SortHeader k="partner_no" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Partner
                    </SortHeader>
                    <SortHeader k="state" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      State
                    </SortHeader>
                    <SortHeader k="enabled" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Enabled
                    </SortHeader>
                    <SortHeader k="hit_count" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right">
                      Flagged transfers
                    </SortHeader>
                    <SortHeader k="total_amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right">
                      Total amount (THB)
                    </SortHeader>
                    <SortHeader k="last_transfer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Last transfer
                    </SortHeader>
                    <th className="px-4 py-2.5 font-semibold">Matched account names</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-slate-500">
                        No flagged merchants for these filters.
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((r) => {
                    const name = nameOf(r);
                    const matched = (r.sample_names ?? []).join(", ");
                    return (
                      <tr key={r.merchant_id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-xs font-medium whitespace-nowrap">
                          {r.merchant_no ? (
                            <a
                              href={`/application-support/merchant-lookup/${r.merchant_no}`}
                              className="text-brand-600 hover:text-brand-700 hover:underline"
                            >
                              {r.merchant_no}
                            </a>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-800 max-w-xs truncate" title={name}>
                          {name}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">
                          {r.partner_no ?? "—"}
                        </td>
                        <td className="px-4 py-2">
                          <StatePill state={r.merchant_state} closed={!!r.merchant_close_date} />
                        </td>
                        <td className="px-4 py-2">
                          {r.merchant_enabled == null ? (
                            <span className="text-slate-400">—</span>
                          ) : r.merchant_enabled ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Yes
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                              No
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-800 text-right whitespace-nowrap">
                          {r.hit_count.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-800 text-right whitespace-nowrap">
                          {thbFmt.format(r.total_amount)}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {shortTs(r.last_transfer_date)}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-600 max-w-[260px] truncate" title={matched}>
                          {matched || "—"}
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

function StatePill({ state, closed }: { state: string | null; closed: boolean }) {
  if (closed) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
        Closed
      </span>
    );
  }
  if (!state) {
    return <span className="text-slate-400">—</span>;
  }
  const tone =
    state === "APPROVE"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : state === "REJECT"
        ? "bg-red-50 text-red-700 border-red-200"
        : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${tone}`}>
      {state === "APPROVE" ? "Live" : state}
    </span>
  );
}

function SortHeader({
  k,
  sortKey,
  sortDir,
  onSort,
  children,
  align,
}: {
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const arrow = sortKey !== k ? "" : sortDir === "asc" ? " ↑" : " ↓";
  return (
    <th
      onClick={() => onSort(k)}
      className={`px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap ${
        align === "right" ? "text-right" : ""
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
