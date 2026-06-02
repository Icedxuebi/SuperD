"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Schema = {
  columns: string[];
  idColumn: string | null;
  reasonColumn: string | null;
  addedColumn: string | null;
  enabledColumn: string | null;
};

type Summary = {
  blacklist_size: number;
  persons_total: number;
  merchants_hit: number;
  live_merchants_hit: number;
};

type HitRow = {
  personal_id: string;
  merchant_id: string | null;
  citizen_id: string | null;
  full_name_th: string | null;
  full_name_en: string | null;
  is_authorize: boolean | null;
  is_director: boolean | null;
  is_contact_person: boolean | null;
  merchant_no: string | null;
  company_name_en: string | null;
  company_name_th: string | null;
  person_type: string | null;
  merchant_state: string | null;
  merchant_enabled: boolean | null;
  merchant_close_date: string | null;
  partner_no: string | null;
  blacklist_id: string;
  blacklist_reason: string | null;
  blacklist_added_at: string | null;
};

type ApiResponse = {
  schema: Schema;
  summary: Summary;
  rows: HitRow[];
};

type SortKey =
  | "merchant_no"
  | "company"
  | "person"
  | "role"
  | "state"
  | "partner_no"
  | "added";
type SortDir = "asc" | "desc";

function maskID(s: string | null): string {
  if (!s) return "—";
  const digits = s.replace(/\D/g, "");
  if (digits.length < 5) return s;
  return digits.slice(0, 1) + "-" + "•".repeat(4) + "-" + digits.slice(-4);
}

function shortTs(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 16).replace("T", " ");
}

function roleOf(r: HitRow): string[] {
  const roles: string[] = [];
  if (r.is_authorize) roles.push("Authorize");
  if (r.is_director) roles.push("Director");
  if (r.is_contact_person) roles.push("Contact");
  return roles;
}

export default function BlacklistHitsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<"all" | "live" | "closed">("live");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("merchant_no");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/blacklist-hits`)
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
      arr = arr.filter(
        (r) => r.merchant_state === "APPROVE" && !r.merchant_close_date,
      );
    } else if (filter === "closed") {
      arr = arr.filter(
        (r) => r.merchant_state !== "APPROVE" || r.merchant_close_date,
      );
    }
    if (q) {
      arr = arr.filter(
        (r) =>
          (r.merchant_no ?? "").toLowerCase().includes(q) ||
          (r.company_name_en ?? "").toLowerCase().includes(q) ||
          (r.company_name_th ?? "").toLowerCase().includes(q) ||
          (r.full_name_en ?? "").toLowerCase().includes(q) ||
          (r.full_name_th ?? "").toLowerCase().includes(q) ||
          (r.partner_no ?? "").toLowerCase().includes(q) ||
          (r.citizen_id ?? "").includes(q.replace(/\D/g, "")),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    arr = [...arr].sort((a, b) => {
      switch (sortKey) {
        case "merchant_no":
          return dir * (a.merchant_no ?? "").localeCompare(b.merchant_no ?? "");
        case "company":
          return (
            dir *
            (a.company_name_en ?? a.company_name_th ?? "").localeCompare(
              b.company_name_en ?? b.company_name_th ?? "",
            )
          );
        case "person":
          return (
            dir *
            (a.full_name_th ?? a.full_name_en ?? "").localeCompare(
              b.full_name_th ?? b.full_name_en ?? "",
            )
          );
        case "role":
          return dir * roleOf(a).join(",").localeCompare(roleOf(b).join(","));
        case "state":
          return dir * (a.merchant_state ?? "").localeCompare(b.merchant_state ?? "");
        case "partner_no":
          return dir * (a.partner_no ?? "").localeCompare(b.partner_no ?? "");
        case "added":
          return dir * (a.blacklist_added_at ?? "").localeCompare(b.blacklist_added_at ?? "");
      }
    });
    return arr;
  }, [data, filter, search, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  function exportExcel() {
    if (filteredRows.length === 0) return;
    const rows = filteredRows.map((r) => ({
      MID: r.merchant_no ?? "",
      "Company (EN)": r.company_name_en ?? "",
      "Company (TH)": r.company_name_th ?? "",
      Partner: r.partner_no ?? "",
      "Merchant state": r.merchant_state ?? "",
      "Merchant enabled": r.merchant_enabled ? "Yes" : "No",
      "Person (EN)": r.full_name_en ?? "",
      "Person (TH)": r.full_name_th ?? "",
      "Citizen ID": r.citizen_id ?? "",
      Roles: roleOf(r).join(", ") || "—",
      "Blacklist reason": r.blacklist_reason ?? "",
      "Blacklist added": shortTs(r.blacklist_added_at),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Blacklist hits");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `BlacklistHits_${stamp}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Blacklist Hit Report</h1>
        <p className="text-slate-600">
          Merchants whose director / authorized signer / contact person has a citizen ID
          in{" "}
          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
            blacklist_id_card
          </span>
          .
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

        <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Reveal full citizen ID
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
              accent="bg-brand-600"
              iconBg="bg-brand-50 text-brand-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.74-3l-7-12a2 2 0 00-3.48 0l-7 12A2 2 0 005 19z" />
                </svg>
              }
              label="Merchants hit (live)"
              value={data.summary.live_merchants_hit.toLocaleString()}
              sub={`${data.summary.merchants_hit.toLocaleString()} total incl. closed/pending`}
            />
            <KpiCard
              accent="bg-accent-500"
              iconBg="bg-accent-50 text-accent-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M9 11a4 4 0 100-8 4 4 0 000 8zm6 0a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
              }
              label="Persons matched"
              value={data.rows.length.toLocaleString()}
              sub={`Across ${data.summary.persons_total.toLocaleString()} merchant persons on file`}
            />
            <KpiCard
              accent="bg-slate-700"
              iconBg="bg-slate-100 text-slate-700"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 9h18" />
                </svg>
              }
              label="Blacklist size"
              value={data.summary.blacklist_size.toLocaleString()}
              sub="Rows in blacklist_id_card"
            />
            <KpiCard
              accent="bg-brand-400"
              iconBg="bg-brand-50 text-brand-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              }
              label="Hit rate"
              value={
                data.summary.persons_total > 0
                  ? `${((data.rows.length / data.summary.persons_total) * 100).toFixed(2)}%`
                  : "—"
              }
              sub="Persons on file matching blacklist"
            />
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h3 className="text-lg font-semibold text-slate-800">
                  Hits
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    {filteredRows.length.toLocaleString()} of {data.rows.length.toLocaleString()}
                  </span>
                </h3>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="search"
                  placeholder="Search MID, company, name, ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-sm w-72 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
                />
                <button
                  type="button"
                  onClick={exportExcel}
                  disabled={filteredRows.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M12 15V3" />
                  </svg>
                  Export Excel
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
                    <SortHeader k="company" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Company
                    </SortHeader>
                    <SortHeader k="state" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      State
                    </SortHeader>
                    <SortHeader k="partner_no" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Partner
                    </SortHeader>
                    <SortHeader k="person" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Person
                    </SortHeader>
                    <th className="px-4 py-2.5 font-semibold">Citizen ID</th>
                    <SortHeader k="role" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Role
                    </SortHeader>
                    <th className="px-4 py-2.5 font-semibold">Reason</th>
                    <SortHeader k="added" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Added
                    </SortHeader>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-slate-500">
                        No blacklist hits for these filters.
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((r) => {
                    const company = r.company_name_en?.trim() || r.company_name_th?.trim() || "—";
                    const person = r.full_name_th?.trim() || r.full_name_en?.trim() || "—";
                    const roles = roleOf(r);
                    return (
                      <tr key={r.personal_id} className="border-b border-slate-100 hover:bg-slate-50">
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
                        <td className="px-4 py-2 text-slate-800 max-w-xs truncate" title={company}>
                          {company}
                        </td>
                        <td className="px-4 py-2">
                          <StatePill state={r.merchant_state} closed={!!r.merchant_close_date} />
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">
                          {r.partner_no ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-700 max-w-[180px] truncate" title={person}>
                          {person}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">
                          {reveal ? r.citizen_id ?? "—" : maskID(r.citizen_id)}
                        </td>
                        <td className="px-4 py-2">
                          {roles.length === 0 ? (
                            <span className="text-slate-400 text-xs">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {roles.map((role) => (
                                <span
                                  key={role}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-50 text-brand-700 border border-brand-100"
                                >
                                  {role}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-600 max-w-[200px] truncate" title={r.blacklist_reason ?? ""}>
                          {r.blacklist_reason ?? "—"}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {shortTs(r.blacklist_added_at)}
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
}: {
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  const arrow = sortKey !== k ? "" : sortDir === "asc" ? " ↑" : " ↓";
  return (
    <th
      onClick={() => onSort(k)}
      className="px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap"
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
