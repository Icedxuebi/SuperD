"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type FormType = "KYM" | "KYC" | "CDD";

type FormPayload = {
  form: FormType;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
};

type ApiResponse = {
  summary: {
    kym_rows: number;
    kyc_rows: number;
    cdd_rows: number;
    total_rows: number;
  };
  forms: {
    kym: FormPayload;
    kyc: FormPayload;
    cdd: FormPayload;
  };
};

type Role = "operation" | "risk" | "manager";

type EnrichedRow = Record<string, unknown> & {
  _form: FormType;
  _merchant_id?: number | string | null;
  _merchant_no?: string | null;
  _merchant_company?: string | null;
  _merchant_state?: string | null;
  _merchant_enabled?: boolean | null;
  _merchant_close_date?: string | null;
  _partner_no?: string | null;
  _person_th?: string | null;
  _person_en?: string | null;
  __roleStatus: Record<Role, "approved" | "pending" | "missing">;
  __dueDate: string | null;
  __overdue: boolean;
};

// Per-role approval-date column patterns. We accept the most common naming
// variants seen in this DB (operation_approve_date, operation_manager_*,
// risk_approve_date, risk_manager_*, manager_approve_date, supervisor_*).
const ROLE_PATTERNS: Record<Role, RegExp[]> = {
  operation: [
    /^operation_approve_date$/i,
    /^operation_manager_approve_date$/i,
    /^operation_staff_id$/i,
  ],
  risk: [
    /^risk_approve_date$/i,
    /^risk_manager_approve_date$/i,
    /^risk_staff_id$/i,
  ],
  manager: [
    /^manager_approve_date$/i,
    /^supervisor_approve_date$/i,
  ],
};

const DUE_DATE_PATTERNS = [
  /^due_date$/i,
  /^period_end$/i,
  /^period_end_date$/i,
  /^end_date$/i,
  /^deadline$/i,
  /^expire_date$/i,
];

function findColumn(columns: string[], patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const found = columns.find((c) => p.test(c));
    if (found) return found;
  }
  return null;
}

// Read a value as "non-empty" — used to decide if a role has signed off. A
// truthy boolean column or a non-null/non-empty string both count.
function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function enrich(
  rows: Record<string, unknown>[],
  columns: string[],
  form: FormType,
): EnrichedRow[] {
  const roleColumns: Record<Role, string | null> = {
    operation: findColumn(columns, ROLE_PATTERNS.operation),
    risk: findColumn(columns, ROLE_PATTERNS.risk),
    manager: findColumn(columns, ROLE_PATTERNS.manager),
  };
  const dueColumn = findColumn(columns, DUE_DATE_PATTERNS);

  const todayISO = new Date().toISOString().slice(0, 10);

  return rows.map((r) => {
    const __roleStatus: Record<Role, "approved" | "pending" | "missing"> = {
      operation: "missing",
      risk: "missing",
      manager: "missing",
    };
    (Object.keys(roleColumns) as Role[]).forEach((role) => {
      const col = roleColumns[role];
      if (!col) {
        __roleStatus[role] = "missing";
      } else {
        __roleStatus[role] = isFilled(r[col]) ? "approved" : "pending";
      }
    });

    const dueRaw = dueColumn ? r[dueColumn] : null;
    const __dueDate = typeof dueRaw === "string" ? dueRaw.slice(0, 10) : null;
    const allApproved = (Object.values(__roleStatus) as ("approved" | "pending" | "missing")[]).every(
      (s) => s !== "pending",
    );
    const __overdue = !!__dueDate && __dueDate < todayISO && !allApproved;

    return {
      ...r,
      _form: form,
      __roleStatus,
      __dueDate,
      __overdue,
    } as EnrichedRow;
  });
}

function shortTs(s: string | null | undefined): string {
  if (!s) return "—";
  return String(s).slice(0, 10);
}

export default function KycCddReviewPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formFilter, setFormFilter] = useState<"all" | FormType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "overdue" | "pending" | "complete">(
    "pending",
  );
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/kyc-cdd-review`)
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

  const enrichedAll = useMemo<EnrichedRow[]>(() => {
    if (!data) return [];
    return [
      ...enrich(data.forms.kym.rows, data.forms.kym.columns, "KYM"),
      ...enrich(data.forms.kyc.rows, data.forms.kyc.columns, "KYC"),
      ...enrich(data.forms.cdd.rows, data.forms.cdd.columns, "CDD"),
    ];
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = enrichedAll;
    if (formFilter !== "all") arr = arr.filter((r) => r._form === formFilter);
    if (statusFilter === "overdue") arr = arr.filter((r) => r.__overdue);
    else if (statusFilter === "pending") {
      arr = arr.filter((r) =>
        (Object.values(r.__roleStatus) as ("approved" | "pending" | "missing")[]).includes("pending"),
      );
    } else if (statusFilter === "complete") {
      arr = arr.filter((r) =>
        !(Object.values(r.__roleStatus) as ("approved" | "pending" | "missing")[]).includes("pending"),
      );
    }
    if (q) {
      arr = arr.filter((r) => {
        return (
          (r._merchant_no ?? "").toString().toLowerCase().includes(q) ||
          (r._merchant_company ?? "").toString().toLowerCase().includes(q) ||
          (r._partner_no ?? "").toString().toLowerCase().includes(q) ||
          (r._person_th ?? "").toString().toLowerCase().includes(q) ||
          (r._person_en ?? "").toString().toLowerCase().includes(q)
        );
      });
    }
    // Sort: overdue first, then pending, then by due_date ascending.
    return [...arr].sort((a, b) => {
      if (a.__overdue !== b.__overdue) return a.__overdue ? -1 : 1;
      const ap = (Object.values(a.__roleStatus) as ("approved" | "pending" | "missing")[]).filter((s) => s === "pending").length;
      const bp = (Object.values(b.__roleStatus) as ("approved" | "pending" | "missing")[]).filter((s) => s === "pending").length;
      if (ap !== bp) return bp - ap;
      return (a.__dueDate ?? "9999").localeCompare(b.__dueDate ?? "9999");
    });
  }, [enrichedAll, formFilter, statusFilter, search]);

  const overdueCount = useMemo(() => enrichedAll.filter((r) => r.__overdue).length, [enrichedAll]);
  const pendingCount = useMemo(
    () =>
      enrichedAll.filter((r) =>
        (Object.values(r.__roleStatus) as ("approved" | "pending" | "missing")[]).includes("pending"),
      ).length,
    [enrichedAll],
  );

  const perRolePending = useMemo(() => {
    const counts: Record<Role, number> = { operation: 0, risk: 0, manager: 0 };
    enrichedAll.forEach((r) => {
      (Object.keys(r.__roleStatus) as Role[]).forEach((role) => {
        if (r.__roleStatus[role] === "pending") counts[role]++;
      });
    });
    return counts;
  }, [enrichedAll]);

  function exportExcel() {
    if (filtered.length === 0) return;
    const rows = filtered.map((r) => ({
      Form: r._form,
      MID: r._merchant_no ?? "",
      Company: r._merchant_company ?? "",
      Partner: r._partner_no ?? "",
      "Merchant State": r._merchant_state ?? "",
      Person: r._person_th ?? r._person_en ?? "",
      "Due Date": r.__dueDate ?? "",
      Overdue: r.__overdue ? "Yes" : "No",
      "Operation Status": r.__roleStatus.operation,
      "Risk Status": r.__roleStatus.risk,
      "Manager Status": r.__roleStatus.manager,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "KYC-CDD Review");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `KycCddReview_${stamp}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">KYC / CDD Period Review Tracker</h1>
        <p className="text-slate-600">
          Multi-period compliance review cycle for merchants and their people.
          Status per role is derived from the{" "}
          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
            *_approve_date
          </span>{" "}
          columns; rows with any{" "}
          <span className="font-semibold text-amber-700">pending</span> role are surfaced first.
        </p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Form</span>
          <div className="inline-flex gap-1 bg-slate-100 rounded-lg p-1">
            {(["all", "KYM", "KYC", "CDD"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFormFilter(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  formFilter === k
                    ? "bg-white shadow-sm text-brand-700"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Status</span>
          <div className="inline-flex gap-1 bg-slate-100 rounded-lg p-1">
            {(["all", "overdue", "pending", "complete"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setStatusFilter(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
                  statusFilter === k
                    ? "bg-white shadow-sm text-brand-700"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

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
              label="Overdue"
              value={overdueCount.toLocaleString()}
              sub="Due date passed, not all roles signed"
            />
            <KpiCard
              accent="bg-accent-500"
              iconBg="bg-accent-50 text-accent-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 3" />
                </svg>
              }
              label="Pending review"
              value={pendingCount.toLocaleString()}
              sub={`${data.summary.total_rows.toLocaleString()} period rows total`}
            />
            <KpiCard
              accent="bg-slate-700"
              iconBg="bg-slate-100 text-slate-700"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M9 11a4 4 0 100-8 4 4 0 000 8zm6 0a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
              }
              label="Pending by role"
              value={`${perRolePending.operation.toLocaleString()} / ${perRolePending.risk.toLocaleString()} / ${perRolePending.manager.toLocaleString()}`}
              sub="Operation / Risk / Manager"
            />
            <KpiCard
              accent="bg-brand-400"
              iconBg="bg-brand-50 text-brand-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 9h18" />
                </svg>
              }
              label="Per form"
              value={`${data.summary.kym_rows} / ${data.summary.kyc_rows} / ${data.summary.cdd_rows}`}
              sub="KYM / KYC / CDD rows"
            />
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h3 className="text-lg font-semibold text-slate-800">
                  Review periods
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    {filtered.length.toLocaleString()} of {enrichedAll.length.toLocaleString()}
                  </span>
                </h3>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="search"
                  placeholder="Search MID, company, person…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-sm w-72 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
                />
                <button
                  type="button"
                  onClick={exportExcel}
                  disabled={filtered.length === 0}
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
                    <th className="px-4 py-2.5 font-semibold">Form</th>
                    <th className="px-4 py-2.5 font-semibold">MID</th>
                    <th className="px-4 py-2.5 font-semibold">Company</th>
                    <th className="px-4 py-2.5 font-semibold">Partner</th>
                    <th className="px-4 py-2.5 font-semibold">Person</th>
                    <th className="px-4 py-2.5 font-semibold">Due</th>
                    <th className="px-4 py-2.5 font-semibold">Operation</th>
                    <th className="px-4 py-2.5 font-semibold">Risk</th>
                    <th className="px-4 py-2.5 font-semibold">Manager</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-slate-500">
                        No review periods match these filters.
                      </td>
                    </tr>
                  )}
                  {filtered.map((r, idx) => {
                    const company = r._merchant_company ?? "—";
                    const person = r._person_th ?? r._person_en ?? "—";
                    return (
                      <tr key={`${r._form}-${String(r.id ?? idx)}`} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <FormPill form={r._form} />
                        </td>
                        <td className="px-4 py-2 font-mono text-xs font-medium whitespace-nowrap">
                          {r._merchant_no ? (
                            <a
                              href={`/application-support/merchant-lookup/${r._merchant_no}`}
                              className="text-brand-600 hover:text-brand-700 hover:underline"
                            >
                              {r._merchant_no}
                            </a>
                          ) : r._merchant_id ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-slate-500" title="No MID assigned — merchant still in onboarding">
                                #{String(r._merchant_id)}
                              </span>
                              {r._merchant_state && <StatePill state={String(r._merchant_state)} />}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-800 max-w-[200px] truncate" title={String(company)}>
                          {String(company) || "—"}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">
                          {r._partner_no ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-700 max-w-[160px] truncate" title={String(person)}>
                          {String(person) || "—"}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                          {r.__dueDate ? (
                            <span className={r.__overdue ? "text-brand-700 font-semibold" : "text-slate-700"}>
                              {shortTs(r.__dueDate)}
                              {r.__overdue && <span className="ml-1 text-[10px] uppercase">overdue</span>}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2"><RoleBadge status={r.__roleStatus.operation} /></td>
                        <td className="px-4 py-2"><RoleBadge status={r.__roleStatus.risk} /></td>
                        <td className="px-4 py-2"><RoleBadge status={r.__roleStatus.manager} /></td>
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

// Compact label for the merchant onboarding state, shown when no MID has been
// assigned yet so analysts can see at a glance why the row has no merchant_no.
// Colour-coded loosely: PRE_* (in flight) → slate, BUSINESS_APPROVE → amber,
// REJECT → red. Anything else falls through to neutral.
function StatePill({ state }: { state: string }) {
  const upper = state.toUpperCase();
  let cls = "bg-slate-100 text-slate-600 border-slate-200";
  if (upper === "REJECT") cls = "bg-red-50 text-red-700 border-red-200";
  else if (upper.includes("BUSINESS_APPROVE")) cls = "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {state}
    </span>
  );
}

function FormPill({ form }: { form: FormType }) {
  const map: Record<FormType, { color: string }> = {
    KYM: { color: "#A4262C" },
    KYC: { color: "#d4a017" },
    CDD: { color: "#475569" },
  };
  const { color } = map[form];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums"
      style={{ backgroundColor: `${color}15`, color }}
    >
      {form}
    </span>
  );
}

function RoleBadge({ status }: { status: "approved" | "pending" | "missing" }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
        Approved
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
        Pending
      </span>
    );
  }
  return <span className="text-slate-400 text-xs">—</span>;
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
