"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type TicketRow = {
  id: string;
  contract_no: string | null;
  merchant_id: string | null;
  status: string | null;
  detail: string | null;
  create_by: string | null;
  create_date: string | null;
  update_by: string | null;
  update_date: string | null;
  success_date: string | null;
  main_id: string | null;
  main_section: string | null;
  main_section_th: string | null;
  sub_id: string | null;
  sub_section: string | null;
  sub_section_th: string | null;
  owner_role: string | null;
  owner_email: string | null;
  handler_roles: string | null;
  attachments: number | null;
  resolve_days: number | null;
};

type DetailRow = {
  case_info_id: string;
  key: string | null;
  value1: string | null;
  value2: string | null;
};

type FileRow = {
  case_info_id: string;
  file_name: string | null;
  file_name_original: string | null;
  file_path: string | null;
  file_type: string | null;
  create_date: string | null;
};

type Merchant = { name: string | null; state: string | null };

type Stats = {
  total: number;
  open: number;
  approve: number;
  reject: number;
  merchants: number;
  avg_resolve_days: number | null;
  median_resolve_days: number | null;
};

type TypeRow = {
  section: string | null;
  name: string | null;
  role: string | null;
  n: number;
  open: number;
};

type MainSection = { id: string; name_en: string | null; name_th: string | null };
type SubSection = {
  id: string;
  main_id: number | null;
  name_en: string | null;
  name_th: string | null;
  role: string | null;
  email_to: string | null;
  attach_file: boolean | null;
};

type ApiResponse = {
  rows: TicketRow[];
  details: DetailRow[];
  files: FileRow[];
  merchants: Record<string, Merchant>;
  merchantLookupError: string | null;
  total: number;
  page: number;
  pageSize: number;
  sortBy: SortKey;
  sortDir: SortDir;
  stats: Stats;
  byType: TypeRow[];
  facets: { mainSections: MainSection[]; subSections: SubSection[] };
};

type SortKey =
  | "id"
  | "contract_no"
  | "status"
  | "main_section"
  | "sub_section"
  | "owner_role"
  | "create_by"
  | "create_date"
  | "update_by"
  | "success_date"
  | "resolve_days"
  | "attachments";

type SortDir = "asc" | "desc";

const PAGE_SIZES = [25, 50, 100];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "CREATE", label: "Open (CREATE)" },
  { value: "APPROVE", label: "Approved" },
  { value: "REJECT", label: "Rejected" },
];

const ROLE_OPTIONS = [
  { value: "", label: "All roles" },
  { value: "SUPPORT", label: "Support" },
  { value: "SUPPORT_MANAGER", label: "Support Manager" },
  { value: "OPERATION", label: "Operation" },
  { value: "FINANCE", label: "Finance" },
];

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "id", label: "Ticket #" },
  { key: "contract_no", label: "MID" },
  { key: "main_section", label: "Section" },
  { key: "sub_section", label: "Type" },
  { key: "status", label: "Status" },
  { key: "owner_role", label: "Owner" },
  { key: "create_by", label: "Opened by" },
  { key: "create_date", label: "Created" },
  { key: "update_by", label: "Handled by" },
  { key: "success_date", label: "Closed" },
  { key: "resolve_days", label: "TAT", numeric: true },
  { key: "attachments", label: "Files", numeric: true },
];

function fmtDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return String(value).replace("T", " ").replace("Z", "").slice(0, 16);
}

// Turnaround time. Sub-day values are the norm (most tickets close in hours),
// so anything under a day renders in hours rather than "0.0d".
function fmtDays(days: number | null | undefined) {
  if (days == null || !Number.isFinite(days)) return "—";
  if (days < 1) {
    const hours = days * 24;
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
    return `${hours.toFixed(1)}h`;
  }
  return `${days.toFixed(1)}d`;
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const map: Record<string, { cls: string; label: string }> = {
    CREATE: { cls: "bg-amber-100 text-amber-700", label: "Open" },
    APPROVE: { cls: "bg-emerald-100 text-emerald-700", label: "Approved" },
    REJECT: { cls: "bg-red-100 text-red-700", label: "Rejected" },
  };
  const m = map[status] ?? { cls: "bg-slate-100 text-slate-700", label: status };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

function RolePill({ role }: { role: string | null }) {
  if (!role) return <span className="text-slate-400">—</span>;
  const cls =
    role === "OPERATION"
      ? "bg-brand-100 text-brand-700"
      : role === "FINANCE"
        ? "bg-accent-100 text-accent-600"
        : role === "SUPPORT_MANAGER"
          ? "bg-slate-200 text-slate-700"
          : "bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap ${cls}`}
    >
      {role}
    </span>
  );
}

export default function TicketsPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [mainId, setMainId] = useState("");
  const [subId, setSubId] = useState("");
  const [role, setRole] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState<SortKey>("create_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, status, mainId, subId, role, from, to, pageSize, sortBy, sortDir]);

  const params = useMemo(
    () => ({
      q: debouncedQ,
      status,
      mainId,
      subId,
      role,
      from,
      to,
      sortBy,
      sortDir,
    }),
    [debouncedQ, status, mainId, subId, role, from, to, sortBy, sortDir],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpanded(null);
    const search = new URLSearchParams({
      ...params,
      page: String(page),
      pageSize: String(pageSize),
    });
    fetch(`/api/tickets?${search}`)
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
  }, [params, page, pageSize]);

  // Sub-section ids encode their parent section, so narrow the Type list once a
  // Section is chosen — and drop a Type that no longer belongs to it.
  const subOptions = useMemo(() => {
    const all = data?.facets.subSections ?? [];
    if (!mainId) return all;
    return all.filter((s) => String(s.main_id) === mainId);
  }, [data, mainId]);

  useEffect(() => {
    if (subId && !subOptions.some((s) => s.id === subId)) setSubId("");
  }, [subId, subOptions]);

  const detailsById = useMemo(() => {
    const m = new Map<string, DetailRow[]>();
    for (const d of data?.details ?? []) {
      const list = m.get(d.case_info_id) ?? [];
      list.push(d);
      m.set(d.case_info_id, list);
    }
    return m;
  }, [data]);

  const filesById = useMemo(() => {
    const m = new Map<string, FileRow[]>();
    for (const f of data?.files ?? []) {
      const list = m.get(f.case_info_id) ?? [];
      list.push(f);
      m.set(f.case_info_id, list);
    }
    return m;
  }, [data]);

  // Tickets missing a contract_no still carry an internal merchant_id, which
  // the API indexes under a `#<id>` key.
  function merchantFor(r: TicketRow): Merchant | undefined {
    if (!data) return undefined;
    if (r.contract_no) return data.merchants[r.contract_no];
    if (r.merchant_id) return data.merchants[`#${r.merchant_id}`];
    return undefined;
  }

  function onSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(key === "create_date" || key === "success_date" ? "desc" : "asc");
    }
  }

  function arrow(key: SortKey) {
    if (sortBy !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  function clearFilters() {
    setQ("");
    setStatus("");
    setMainId("");
    setSubId("");
    setRole("");
    setFrom("");
    setTo("");
  }

  const hasFilters =
    q !== "" || status !== "" || mainId !== "" || subId !== "" || role !== "" || from !== "" || to !== "";

  // Exports every ticket matching the current filters, not just this page.
  async function exportExcel() {
    if (!data || data.total === 0 || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const search = new URLSearchParams({ ...params, full: "1" });
      const res = await fetch(`/api/tickets?${search}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Export failed (${res.status})`);
      const exported = body as ApiResponse;
      const sheet = exported.rows.map((r) => {
        const m = exported.merchants[r.contract_no ?? `#${r.merchant_id}`];
        return {
          "Ticket #": r.id,
          MID: r.contract_no ?? "",
          Merchant: m?.name ?? "",
          Section: r.main_section ?? "",
          Type: r.sub_section ?? "",
          "Type (TH)": r.sub_section_th ?? "",
          Status: r.status ?? "",
          "Owner Role": r.owner_role ?? "",
          "Handler Roles": r.handler_roles ?? "",
          "Opened By": r.create_by ?? "",
          Created: fmtDateTime(r.create_date),
          "Handled By": r.update_by ?? "",
          Closed: fmtDateTime(r.success_date),
          "TAT (days)": r.resolve_days != null ? Number(r.resolve_days.toFixed(3)) : "",
          Attachments: r.attachments ?? 0,
          Detail: r.detail ?? "",
        };
      });
      const ws = XLSX.utils.json_to_sheet(sheet);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Tickets");
      XLSX.writeFile(wb, `tickets-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1),
    [data],
  );
  const pageNumbers = useMemo(() => buildPageWindow(page, totalPages, 5), [page, totalPages]);

  const stats = data?.stats;
  const resolved = stats ? stats.approve + stats.reject : 0;
  const approvalRate = resolved > 0 ? (stats!.approve / resolved) * 100 : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Tickets</h1>
        <p className="text-slate-600">
          Merchant support cases from the ticket system — search, filter and inspect
          request details, routing and attachments.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 flex-1 min-w-[260px]">
          <span className="text-xs font-medium text-slate-600">Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ticket #, MID, email, or text in the request…"
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors min-w-[150px]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Section</span>
          <select
            value={mainId}
            onChange={(e) => setMainId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors min-w-[140px]"
          >
            <option value="">All sections</option>
            {(data?.facets.mainSections ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Type</span>
          <select
            value={subId}
            onChange={(e) => setSubId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors min-w-[200px] max-w-[260px]"
          >
            <option value="">All types</option>
            {subOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Owner role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors min-w-[150px]"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Created from</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Per page</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} items
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={clearFilters}
          disabled={!hasFilters}
          className="px-4 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
        >
          Clear filter
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

      {data?.merchantLookupError && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-sm">
          Merchant names unavailable — the main Anypay database could not be reached
          ({data.merchantLookupError}). Ticket data below is unaffected.
        </div>
      )}

      {/* KPIs */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi
            accent="bg-brand-600"
            iconBg="bg-brand-50 text-brand-600"
            icon={ICON_TICKET}
            label="Tickets"
            value={stats.total.toLocaleString()}
            sub={`${stats.merchants.toLocaleString()} distinct merchants`}
          />
          <Kpi
            accent="bg-accent-500"
            iconBg="bg-accent-50 text-accent-600"
            icon={ICON_CLOCK}
            label="Open"
            value={stats.open.toLocaleString()}
            sub={
              stats.total > 0
                ? `${((stats.open / stats.total) * 100).toFixed(1)}% of tickets awaiting action`
                : "—"
            }
          />
          <Kpi
            accent="bg-emerald-500"
            iconBg="bg-emerald-50 text-emerald-600"
            icon={ICON_CHECK}
            label="Resolved"
            value={resolved.toLocaleString()}
            sub={
              approvalRate != null
                ? `${approvalRate.toFixed(0)}% approved · ${stats.reject.toLocaleString()} rejected`
                : "—"
            }
          />
          <Kpi
            accent="bg-slate-700"
            iconBg="bg-slate-100 text-slate-700"
            icon={ICON_TIMER}
            label="Median time to close"
            value={fmtDays(stats.median_resolve_days)}
            sub={`Average ${fmtDays(stats.avg_resolve_days)} — skewed by long tail`}
          />
        </div>
      )}

      {/* Breakdown by ticket type */}
      {data && data.byType.length > 0 && (
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
            <h3 className="text-lg font-semibold text-slate-800">
              By ticket type
              <span className="text-sm font-normal text-slate-500 ml-2">
                {data.byType.length} {data.byType.length === 1 ? "type" : "types"} in the current
                filter
              </span>
            </h3>
          </div>
          <ul className="space-y-2">
            {data.byType.map((t) => {
              const pct = stats && stats.total > 0 ? (t.n / stats.total) * 100 : 0;
              return (
                <li key={`${t.section}-${t.name}`} className="flex items-center gap-3 text-sm">
                  <div className="w-[300px] shrink-0 truncate text-slate-700" title={t.name ?? ""}>
                    <span className="text-xs text-slate-400 mr-1.5">{t.section}</span>
                    {t.name ?? "—"}
                  </div>
                  <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden min-w-[80px]">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.max(pct, 0.6)}%` }}
                    />
                  </div>
                  <div className="w-16 text-right font-mono font-medium tabular-nums text-slate-800">
                    {t.n.toLocaleString()}
                  </div>
                  <div className="w-14 text-right font-mono text-xs tabular-nums text-slate-400">
                    {pct.toFixed(1)}%
                  </div>
                  <div className="w-24 text-right">
                    {t.open > 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-100 text-amber-700 font-mono">
                        {t.open.toLocaleString()} open
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </div>
                  <div className="w-32 text-right">
                    <RolePill role={t.role} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Results */}
      <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-200 gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
            <h3 className="text-lg font-semibold text-slate-800">
              Tickets
              {data && (
                <span className="text-sm font-normal text-slate-500 ml-2">
                  {data.total.toLocaleString()} total
                </span>
              )}
            </h3>
          </div>
          <button
            type="button"
            onClick={exportExcel}
            disabled={!data || data.total === 0 || exporting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
            title={
              !data || data.total === 0
                ? "No rows to export"
                : `Export ${data.total.toLocaleString()} ticket${data.total === 1 ? "" : "s"} matching the current filters`
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
            {exporting ? "Exporting…" : "Export Excel"}
          </button>
        </div>

        <div className="overflow-x-auto max-h-[700px]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="text-left text-slate-600 border-b border-slate-200">
                <th className="px-3 py-2.5 w-8" />
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => onSort(c.key)}
                    className={`px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap ${
                      c.numeric ? "text-right" : ""
                    }`}
                    aria-sort={
                      sortBy === c.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    {c.label}
                    <span className="text-brand-600">{arrow(c.key)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data && loading && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="text-center py-12 text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {data && data.rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="text-center py-12 text-slate-500">
                    No tickets match these filters.
                  </td>
                </tr>
              )}
              {data?.rows.map((r) => {
                const isOpen = expanded === r.id;
                const merchant = merchantFor(r);
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : r.id)}
                      className={`border-b border-slate-100 cursor-pointer ${
                        isOpen ? "bg-brand-50/40" : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-3 py-2 text-slate-400">
                        <svg
                          viewBox="0 0 24 24"
                          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-800 whitespace-nowrap">
                        {r.id}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {r.contract_no ? (
                          <Link
                            href={`/application-support/merchant-lookup/${r.contract_no}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-xs text-brand-600 hover:text-brand-700 hover:underline"
                          >
                            {r.contract_no}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-slate-400">
                            #{r.merchant_id ?? "—"}
                          </span>
                        )}
                        {merchant?.name && (
                          <div className="text-xs text-slate-500 truncate max-w-[180px]">
                            {merchant.name}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                        {r.main_section ?? "—"}
                      </td>
                      <td
                        className="px-4 py-2 text-slate-800 max-w-[240px] truncate"
                        title={r.sub_section ?? ""}
                      >
                        {r.sub_section ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-4 py-2">
                        <RolePill role={r.owner_role} />
                      </td>
                      <td
                        className="px-4 py-2 text-slate-600 max-w-[200px] truncate"
                        title={r.create_by ?? ""}
                      >
                        {r.create_by ?? "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-slate-600">
                        {fmtDateTime(r.create_date)}
                      </td>
                      <td
                        className="px-4 py-2 text-slate-600 max-w-[180px] truncate"
                        title={r.update_by ?? ""}
                      >
                        {r.update_by ? r.update_by.replace("@anypay.co.th", "") : "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-slate-600">
                        {fmtDateTime(r.success_date)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums whitespace-nowrap text-slate-700">
                        {fmtDays(r.resolve_days)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                        {r.attachments ? (
                          <span className="text-slate-700">{r.attachments}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <td colSpan={COLUMNS.length + 1} className="p-0">
                          {/* The table is wider than the viewport and scrolls
                              horizontally. A plain full-width cell would stretch
                              the panel to the full scroll width and push its
                              right-hand column off-screen, so pin it to the
                              visible area instead. */}
                          <div className="sticky left-0 w-[calc(100vw-3rem)] max-w-[1232px] px-6 py-5">
                            <TicketDetail
                              row={r}
                              merchant={merchant}
                              details={detailsById.get(r.id) ?? []}
                              files={filesById.get(r.id) ?? []}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {data && data.total > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-slate-200 bg-slate-50">
            <div className="text-sm text-slate-500">
              Showing{" "}
              <span className="font-medium text-slate-700">
                {(data.page - 1) * data.pageSize + 1}
              </span>{" "}
              –{" "}
              <span className="font-medium text-slate-700">
                {Math.min(data.page * data.pageSize, data.total)}
              </span>{" "}
              of <span className="font-medium text-slate-700">{data.total.toLocaleString()}</span>{" "}
              tickets
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              pageNumbers={pageNumbers}
              onChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---- expanded row ---------------------------------------------------------

function TicketDetail({
  row,
  merchant,
  details,
  files,
}: {
  row: TicketRow;
  merchant: Merchant | undefined;
  details: DetailRow[];
  files: FileRow[];
}) {
  // `priority` is carried on every ticket and is always "medium" — surface it as
  // a chip rather than letting it dominate the key/value list.
  const priority = details.find((d) => d.key === "priority");
  const extras = details.filter((d) => d.key !== "priority");
  const body = (row.detail ?? "").trim();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <Panel title="Request">
          {body ? (
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{body}</p>
          ) : (
            <p className="text-sm text-slate-400">
              No request text was submitted with this ticket.
            </p>
          )}
        </Panel>

        {extras.length > 0 && (
          <Panel title="Submitted fields">
            <dl className="space-y-2">
              {extras.map((d, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
                  <dt className="text-xs font-medium text-slate-500 sm:w-40 shrink-0 font-mono">
                    {d.key}
                  </dt>
                  <dd className="text-sm text-slate-800 break-all">
                    {[d.value1, d.value2].filter((v) => v && v.trim() !== "").join(" · ") || "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        )}

        <Panel title={`Attachments (${files.length})`}>
          {files.length === 0 ? (
            <p className="text-sm text-slate-400">No files attached.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {files.map((f, i) => (
                <li key={i} className="py-2 flex items-start gap-3 first:pt-0 last:pb-0">
                  <span className="mt-0.5 p-1.5 rounded-md bg-slate-100 text-slate-500 shrink-0">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <path d="M14 2v6h6" />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-800 break-words">
                      {f.file_name_original ?? f.file_name ?? "—"}
                    </div>
                    <div className="text-xs text-slate-400 font-mono break-all">
                      {f.file_path ?? ""}
                      {f.file_path && f.file_name ? `/${f.file_name}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Routing">
          <dl className="space-y-2 text-sm">
            <Field label="Owner role">
              <RolePill role={row.owner_role} />
            </Field>
            <Field label="Notified">
              <span className="text-slate-700 break-all">{row.owner_email ?? "—"}</span>
            </Field>
            <Field label="Can handle">
              <span className="text-slate-700">{row.handler_roles ?? "—"}</span>
            </Field>
            <Field label="Priority">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600">
                {priority?.value1 ?? "—"}
              </span>
            </Field>
          </dl>
        </Panel>

        <Panel title="Merchant">
          <dl className="space-y-2 text-sm">
            <Field label="MID">
              {row.contract_no ? (
                <Link
                  href={`/application-support/merchant-lookup/${row.contract_no}`}
                  className="font-mono text-xs text-brand-600 hover:text-brand-700 hover:underline"
                >
                  {row.contract_no}
                </Link>
              ) : (
                <span className="text-slate-400">— (internal id {row.merchant_id ?? "—"})</span>
              )}
            </Field>
            <Field label="Name">
              <span className="text-slate-700">{merchant?.name ?? "—"}</span>
            </Field>
            <Field label="State">
              <span className="text-slate-700">{merchant?.state ?? "—"}</span>
            </Field>
          </dl>
        </Panel>

        <Panel title="Timeline">
          <dl className="space-y-2 text-sm">
            <Field label="Opened">
              <span className="font-mono text-xs text-slate-700">
                {fmtDateTime(row.create_date)}
              </span>
            </Field>
            <Field label="By">
              <span className="text-slate-700 break-all">{row.create_by ?? "—"}</span>
            </Field>
            <Field label="Last update">
              <span className="font-mono text-xs text-slate-700">
                {fmtDateTime(row.update_date)}
              </span>
            </Field>
            <Field label="Handled by">
              <span className="text-slate-700 break-all">{row.update_by ?? "—"}</span>
            </Field>
            <Field label="Closed">
              <span className="font-mono text-xs text-slate-700">
                {fmtDateTime(row.success_date)}
              </span>
            </Field>
            <Field label="Turnaround">
              <span className="font-mono text-xs text-slate-700">{fmtDays(row.resolve_days)}</span>
            </Field>
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-xs font-medium text-slate-500 w-24 shrink-0">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

// ---- small UI primitives --------------------------------------------------

function Kpi({
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
      {sub && (
        <div className="text-sm text-slate-500 mt-1 truncate" title={sub}>
          {sub}
        </div>
      )}
    </div>
  );
}

function buildPageWindow(current: number, total: number, size: number): (number | "…")[] {
  if (total <= size + 2) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const half = Math.floor(size / 2);
  let start = Math.max(2, current - half);
  const end = Math.min(total - 1, start + size - 1);
  if (end - start + 1 < size) start = Math.max(2, end - size + 1);

  const out: (number | "…")[] = [1];
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}

function Pagination({
  page,
  totalPages,
  pageNumbers,
  onChange,
}: {
  page: number;
  totalPages: number;
  pageNumbers: (number | "…")[];
  onChange: (p: number) => void;
}) {
  const btn = "min-w-[32px] h-8 px-2 rounded-md text-sm font-medium transition-colors";
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className={`${btn} text-slate-700 hover:bg-slate-200 disabled:text-slate-300 disabled:cursor-not-allowed`}
        aria-label="Previous page"
      >
        ‹
      </button>
      {pageNumbers.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-slate-400">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`${btn} ${
              p === page ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-200"
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className={`${btn} text-slate-700 hover:bg-slate-200 disabled:text-slate-300 disabled:cursor-not-allowed`}
        aria-label="Next page"
      >
        ›
      </button>
    </div>
  );
}

const svgProps = {
  viewBox: "0 0 24 24",
  className: "h-5 w-5",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ICON_TICKET = (
  <svg {...svgProps}>
    <path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4V8z" />
    <path d="M13 6v12" strokeDasharray="2 2" />
  </svg>
);
const ICON_CLOCK = (
  <svg {...svgProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const ICON_CHECK = (
  <svg {...svgProps}>
    <path d="M5 13l4 4L19 7" />
  </svg>
);
const ICON_TIMER = (
  <svg {...svgProps}>
    <path d="M10 2h4" />
    <circle cx="12" cy="14" r="8" />
    <path d="M12 10v4" />
  </svg>
);
