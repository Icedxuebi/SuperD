"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Row = {
  merchant_id: number;
  merchant_no: string | null;
  partner_no: string | null;
  display_name: string | null;
  person_type: string | null;
  tax_id: string | null;
  state: string | null;
  status: string | null;
  close_date: string | null;
  close_remark: string | null;
  reject_types: string | null;
  first_listed: string | null;
  blacklist_name: string | null;
  bl_rows: number | null;
};

type SortKey =
  | "merchant_no"
  | "partner_no"
  | "merchant_name"
  | "tax_id"
  | "state"
  | "status"
  | "reject_types"
  | "first_listed"
  | "bl_rows"
  | "close_date"
  | "close_remark";

type SortDir = "asc" | "desc";

type ApiResponse = {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: SortKey;
  sortDir: SortDir;
  state: string;
  status: string;
};

const PAGE_SIZES = [10, 25, 50, 100];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "CLOSE", label: "Close" },
];

const STATE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All states" },
  { value: "APPROVE", label: "Approve" },
  { value: "BUSINESS_APPROVE", label: "Business Approve" },
  { value: "PRE_BUSINESS_APPROVE", label: "Pre-Business Approve" },
  { value: "PRE_APPROVE_SUPERVISOR", label: "Pre-Approve Supervisor" },
  { value: "PRE_APPROVE_OPERATION", label: "Pre-Approve Operation" },
  { value: "PRE_APPROVE_DOCUMENT", label: "Pre-Approve Document" },
  { value: "REGISTER", label: "Register" },
  { value: "REJECT", label: "Reject" },
  { value: "__NULL__", label: "(no state)" },
];

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "merchant_no", label: "Merchant ID" },
  { key: "partner_no", label: "Partner No" },
  { key: "merchant_name", label: "Merchant Name" },
  { key: "tax_id", label: "Tax ID" },
  { key: "state", label: "State" },
  { key: "status", label: "Status" },
  { key: "reject_types", label: "On Lists" },
  { key: "first_listed", label: "First Listed" },
  { key: "bl_rows", label: "Entries", align: "right" },
  { key: "close_date", label: "Store Closure Date" },
  { key: "close_remark", label: "Store Closure Reason" },
];

function formatDate(value: string | null | undefined) {
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
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${color}`}>
      {state}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const color =
    status === "Active"
      ? "bg-emerald-100 text-emerald-700"
      : status === "Inactive"
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-200 text-slate-700";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}

// AMLO sanctions / terrorism lists are the higher-signal matches; the bulky
// internal reject registries (APS / CFR / ANP) are shown in a neutral tone.
function RejectTypeChips({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const types = value.split(",").map((t) => t.trim()).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1">
      {types.map((t) => {
        const isAmlo = t.startsWith("AMLO");
        const color = isAmlo
          ? "bg-red-100 text-red-700"
          : "bg-slate-100 text-slate-600";
        return (
          <span
            key={t}
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium font-mono ${color}`}
          >
            {t}
          </span>
        );
      })}
    </div>
  );
}

function TypeBadge({ personType }: { personType: string | null }) {
  if (!personType) return null;
  const label = personType === "C" ? "Company" : personType === "I" ? "Individual" : personType;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
      {label}
    </span>
  );
}

export default function BlacklistMerchantPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState<SortKey>("merchant_no");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, pageSize, sortBy, sortDir, stateFilter, statusFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      q: debouncedQ,
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      sortDir,
      state: stateFilter,
      status: statusFilter,
    });
    fetch(`/api/blacklist-merchant?${params}`)
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
  }, [debouncedQ, page, pageSize, sortBy, sortDir, stateFilter, statusFilter]);

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

  // Exports every blacklisted merchant matching the current search + filters
  // (all pages, current sort). The API caps pageSize at 100, so we fan out one
  // request per page and stitch the rows together.
  async function exportExcel() {
    if (!data || data.total === 0 || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const PAGE = 100;
      const pages = Math.ceil(data.total / PAGE);
      const base: Record<string, string> = {
        q: debouncedQ,
        pageSize: String(PAGE),
        sortBy,
        sortDir,
        state: stateFilter,
        status: statusFilter,
      };
      const batches = await Promise.all(
        Array.from({ length: pages }, (_, i) => {
          const params = new URLSearchParams({ ...base, page: String(i + 1) });
          return fetch(`/api/blacklist-merchant?${params}`).then(async (res) => {
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? `Export failed (${res.status})`);
            return body as ApiResponse;
          });
        }),
      );
      const rows = batches.flatMap((b) => b.rows);
      const sheet = rows.map((r) => ({
        "Merchant ID": r.merchant_no ?? `#${r.merchant_id}`,
        "Partner No": r.partner_no ?? "",
        "Merchant Name": r.display_name ?? "",
        Type: r.person_type === "C" ? "Company" : r.person_type === "I" ? "Individual" : (r.person_type ?? ""),
        "Tax ID": r.tax_id ?? "",
        State: r.state ?? "",
        Status: r.status ?? "",
        "On Lists": r.reject_types ?? "",
        "Listed Name": r.blacklist_name ?? "",
        "First Listed": formatDate(r.first_listed),
        Entries: r.bl_rows ?? 0,
        "Store Closure Date": formatDate(r.close_date),
        "Store Closure Reason": r.close_remark ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(sheet);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Blacklist Merchants");
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `blacklist-merchants-${stamp}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  const pageNumbers = useMemo(() => buildPageWindow(page, totalPages, 5), [page, totalPages]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Blacklist Merchant</h1>
        <p className="text-slate-600">
          Merchants whose tax ID matches an entry on the blocked ID-card list (
          <span className="font-mono text-sm">blacklist_id_card</span>). Companies match on the
          corporate tax ID, individuals on the authorized person&apos;s citizen ID.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        This list is broad — <span className="font-medium">blacklist_id_card</span> doubles as the
        historical rejected-applicant / fraud registry (APS, CFR, ANP), so most matches are closed
        or rejected merchants. The high-signal cases are the red{" "}
        <span className="font-mono text-xs">AMLO_*</span> sanctions / terrorism lists. Confirm
        identity against the listed name before acting.
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 flex-1 min-w-[260px]">
          <span className="text-xs font-medium text-slate-600">Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by merchant ID, name, tax ID, or partner no…"
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">State</span>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors min-w-[180px]"
          >
            {STATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors min-w-[160px]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Items per page</span>
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
          onClick={() => {
            setQ("");
            setStateFilter("");
            setStatusFilter("");
          }}
          disabled={q === "" && stateFilter === "" && statusFilter === ""}
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

      <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
            <h3 className="text-lg font-semibold text-slate-800">
              Blacklisted Merchants
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
                : `Export ${data.total.toLocaleString()} merchant${data.total === 1 ? "" : "s"} matching the current filters`
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

        <div className="overflow-x-auto max-h-[600px]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="text-left text-slate-600 border-b border-slate-200">
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => onSort(c.key)}
                    className={`px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap ${
                      c.align === "right" ? "text-right" : ""
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
                  <td colSpan={COLUMNS.length} className="text-center py-12 text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {data && data.rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center py-12 text-slate-500">
                    No blacklisted merchants match this search.
                  </td>
                </tr>
              )}
              {data?.rows.map((r) => (
                <tr key={r.merchant_id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-4 py-2 font-mono text-xs text-slate-800 whitespace-nowrap">
                    {r.merchant_no ?? `#${r.merchant_id}`}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                    {r.partner_no ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-800">
                    <div className="flex flex-col gap-1">
                      <span>{r.display_name ?? `#${r.merchant_id}`}</span>
                      <div className="flex items-center gap-1.5">
                        <TypeBadge personType={r.person_type} />
                        {r.blacklist_name && (
                          <span className="text-xs text-slate-500" title="Name on blacklist entry">
                            {r.blacklist_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-800 whitespace-nowrap">
                    {r.tax_id ?? "—"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <StateBadge state={r.state} />
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2">
                    <RejectTypeChips value={r.reject_types} />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                    {formatDate(r.first_listed)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-right whitespace-nowrap">
                    {r.bl_rows ?? "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                    {formatDate(r.close_date)}
                  </td>
                  <td
                    className="px-4 py-2 text-slate-700 max-w-xs truncate"
                    title={r.close_remark ?? ""}
                  >
                    {r.close_remark ?? "—"}
                  </td>
                </tr>
              ))}
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
              items
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
