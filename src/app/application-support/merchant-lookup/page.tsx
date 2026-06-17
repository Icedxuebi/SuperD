"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type MerchantRow = {
  merchant_no: string | null;
  partner_no: string | null;
  merchant_name_en: string | null;
  email: string | null;
  state: string | null;
  auto_reject_detail: string | null;
  approved_date: string | null;
  store_closure_date: string | null;
  store_closure_reason: string | null;
};

type SortKey =
  | "merchant_no"
  | "partner_no"
  | "merchant_name_en"
  | "email"
  | "state"
  | "auto_reject_detail"
  | "approved_date"
  | "store_closure_date"
  | "store_closure_reason";

type SortDir = "asc" | "desc";

type ApiResponse = {
  rows: MerchantRow[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: SortKey;
  sortDir: SortDir;
};

const PAGE_SIZES = [10, 25, 50, 100];

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

const COLUMNS: { key: SortKey; label: string; numeric?: boolean; mono?: boolean }[] = [
  { key: "merchant_no", label: "Merchant ID", mono: true },
  { key: "partner_no", label: "Partner No", mono: true },
  { key: "merchant_name_en", label: "Merchant Name" },
  { key: "email", label: "Email" },
  { key: "state", label: "State" },
  { key: "auto_reject_detail", label: "Auto Reject Detail" },
  { key: "approved_date", label: "Approved Date", mono: true },
  { key: "store_closure_date", label: "Store Closure Date", mono: true },
  { key: "store_closure_reason", label: "Store Closure Reason" },
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

export default function MerchantLookupPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState<SortKey>("merchant_no");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, pageSize, sortBy, sortDir, stateFilter]);

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
    });
    fetch(`/api/merchants?${params}`)
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
  }, [debouncedQ, page, pageSize, sortBy, sortDir, stateFilter]);

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

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  const pageNumbers = useMemo(() => buildPageWindow(page, totalPages, 5), [page, totalPages]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">All Merchants</h1>
        <p className="text-slate-600">Display registered merchants in the system.</p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 flex-1 min-w-[260px]">
          <span className="text-xs font-medium text-slate-600">Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by merchant ID, partner no, or merchant name…"
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
          }}
          disabled={q === "" && stateFilter === ""}
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
              Merchants
              {data && (
                <span className="text-sm font-normal text-slate-500 ml-2">
                  {data.total.toLocaleString()} total
                </span>
              )}
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[600px]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="text-left text-slate-600 border-b border-slate-200">
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => onSort(c.key)}
                    className="px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap"
                    aria-sort={
                      sortBy === c.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    {c.label}
                    <span className="text-brand-600">{arrow(c.key)}</span>
                  </th>
                ))}
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap text-right">Actions</th>
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
                    No merchants match this search.
                  </td>
                </tr>
              )}
              {data?.rows.map((r) => (
                <tr
                  key={r.merchant_no ?? Math.random()}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-4 py-2 font-mono text-xs text-slate-800 whitespace-nowrap">
                    {r.merchant_no ?? "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                    {r.partner_no ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-800">{r.merchant_name_en ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-700">{r.email ?? "—"}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <StateBadge state={r.state} />
                  </td>
                  <td
                    className="px-4 py-2 text-slate-700 max-w-xs truncate"
                    title={r.auto_reject_detail ?? ""}
                  >
                    {r.auto_reject_detail ?? "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                    {formatDate(r.approved_date)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                    {formatDate(r.store_closure_date)}
                  </td>
                  <td
                    className="px-4 py-2 text-slate-700 max-w-xs truncate"
                    title={r.store_closure_reason ?? ""}
                  >
                    {r.store_closure_reason ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {r.merchant_no && (
                      <Link
                        href={`/application-support/merchant-lookup/${r.merchant_no}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-sm"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        View
                      </Link>
                    )}
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
  let end = Math.min(total - 1, start + size - 1);
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
