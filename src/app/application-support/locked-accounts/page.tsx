"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Summary = {
  permanent_locked: number;
  mfa_locked: number;
  login_locked: number;
  total_users: number;
  total_enabled: number;
};

type DetailRow = {
  username: string;
  enabled: boolean | null;
  merchant_id: string | null;
  partner_id: string | null;
  staff_id: string | null;
  failed_login_attempts: number | null;
  mfa_otp_failed_attempts: number | null;
  login_lock_tier: string | number | null;
  login_permanently_locked: boolean | null;
  mfa_otp_locked_until: string | null;
  locked_until: string | null;
  last_failed_login_time: string | null;
  owner_type: "merchant" | "partner" | "staff" | "unknown";
  merchant_no: string | null;
  merchant_company: string | null;
  partner_no: string | null;
};

type ApiResponse = {
  summary: Summary;
  rows: DetailRow[];
};

type LockKind = "permanent" | "mfa" | "login";

type SortKey =
  | "username"
  | "owner"
  | "lock"
  | "until"
  | "failed_login"
  | "failed_mfa"
  | "last_failed";
type SortDir = "asc" | "desc";

function shortTs(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 16).replace("T", " ");
}

// A user can hit more than one of the lock conditions; pick the strongest.
function primaryLock(r: DetailRow, now: Date): LockKind | null {
  if (r.login_permanently_locked) return "permanent";
  if (r.mfa_otp_locked_until && new Date(r.mfa_otp_locked_until) > now) return "mfa";
  if (r.locked_until && new Date(r.locked_until) > now) return "login";
  return null;
}

function lockUntil(r: DetailRow): string | null {
  if (r.login_permanently_locked) return null;
  if (r.mfa_otp_locked_until) return r.mfa_otp_locked_until;
  if (r.locked_until) return r.locked_until;
  return null;
}

export default function LockedAccountsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<"all" | LockKind>("all");
  const [ownerFilter, setOwnerFilter] = useState<"all" | DetailRow["owner_type"]>(
    "all",
  );
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lock");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/locked-accounts`)
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

  const now = useMemo(() => new Date(), []);

  const enriched = useMemo(() => {
    if (!data) return [];
    return data.rows.map((r) => ({
      ...r,
      _lock: primaryLock(r, now),
      _until: lockUntil(r),
    }));
  }, [data, now]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = enriched;
    if (filter !== "all") arr = arr.filter((r) => r._lock === filter);
    if (ownerFilter !== "all") arr = arr.filter((r) => r.owner_type === ownerFilter);
    if (q) {
      arr = arr.filter(
        (r) =>
          r.username.toLowerCase().includes(q) ||
          (r.merchant_no ?? "").toLowerCase().includes(q) ||
          (r.merchant_company ?? "").toLowerCase().includes(q) ||
          (r.partner_no ?? "").toLowerCase().includes(q),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    arr = [...arr].sort((a, b) => {
      switch (sortKey) {
        case "username":
          return dir * a.username.localeCompare(b.username);
        case "owner":
          return dir * a.owner_type.localeCompare(b.owner_type);
        case "lock": {
          const order: Record<string, number> = {
            permanent: 3,
            mfa: 2,
            login: 1,
          };
          const av = a._lock ? order[a._lock] : 0;
          const bv = b._lock ? order[b._lock] : 0;
          return dir * (av - bv);
        }
        case "until":
          return dir * (a._until ?? "").localeCompare(b._until ?? "");
        case "failed_login":
          return dir * ((a.failed_login_attempts ?? 0) - (b.failed_login_attempts ?? 0));
        case "failed_mfa":
          return (
            dir * ((a.mfa_otp_failed_attempts ?? 0) - (b.mfa_otp_failed_attempts ?? 0))
          );
        case "last_failed":
          return (
            dir * (a.last_failed_login_time ?? "").localeCompare(b.last_failed_login_time ?? "")
          );
      }
    });
    return arr;
  }, [enriched, filter, ownerFilter, search, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "username" || k === "owner" ? "asc" : "desc");
    }
  }

  function ownerLabel(r: DetailRow): string {
    switch (r.owner_type) {
      case "merchant":
        return r.merchant_no ?? `(merchant ${r.merchant_id ?? "?"})`;
      case "partner":
        return r.partner_no ?? `(partner ${r.partner_id ?? "?"})`;
      case "staff":
        return `staff #${r.staff_id ?? "?"}`;
      default:
        return "—";
    }
  }

  function exportExcel() {
    if (filteredRows.length === 0) return;
    const rows = filteredRows.map((r) => ({
      Username: r.username,
      Owner: r.owner_type,
      "MID / Partner": ownerLabel(r),
      Company: r.merchant_company ?? "",
      "Lock reason":
        r._lock === "permanent"
          ? "PERMANENT"
          : r._lock === "mfa"
            ? "MFA OTP"
            : r._lock === "login"
              ? "LOGIN"
              : "",
      "Locked until": shortTs(r._until),
      "Login attempts": r.failed_login_attempts ?? 0,
      "MFA attempts": r.mfa_otp_failed_attempts ?? 0,
      "Login tier": r.login_lock_tier ?? "",
      "Last failed login": shortTs(r.last_failed_login_time),
      Enabled: r.enabled ? "Yes" : "No",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Locked accounts");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `LockedAccounts_${stamp}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Locked Accounts</h1>
        <p className="text-slate-600">
          Users blocked by permanent lock, MFA-OTP lockout, or login failure
          escalation. Counted at {" "}
          <span className="font-medium text-slate-700">Asia/Bangkok</span> wall-clock.
        </p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Lock type</span>
          <div className="inline-flex gap-1 bg-slate-100 rounded-lg p-1">
            {(["all", "permanent", "mfa", "login"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
                  filter === k
                    ? "bg-white shadow-sm text-brand-700"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {k === "mfa" ? "MFA" : k}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Owner type</span>
          <div className="inline-flex gap-1 bg-slate-100 rounded-lg p-1">
            {(["all", "merchant", "partner", "staff"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setOwnerFilter(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
                  ownerFilter === k
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
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              }
              label="Permanent locked"
              value={data.summary.permanent_locked.toLocaleString()}
              sub="login_permanently_locked = TRUE"
            />
            <KpiCard
              accent="bg-accent-500"
              iconBg="bg-accent-50 text-accent-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
                </svg>
              }
              label="MFA OTP locked"
              value={data.summary.mfa_locked.toLocaleString()}
              sub="mfa_otp_locked_until in the future"
            />
            <KpiCard
              accent="bg-slate-700"
              iconBg="bg-slate-100 text-slate-700"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.74-3l-7-12a2 2 0 00-3.48 0l-7 12A2 2 0 005 19z" />
                </svg>
              }
              label="Login locked"
              value={data.summary.login_locked.toLocaleString()}
              sub="locked_until in the future"
            />
            <KpiCard
              accent="bg-brand-400"
              iconBg="bg-brand-50 text-brand-600"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M9 11a4 4 0 100-8 4 4 0 000 8zm6 0a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
              }
              label="Total users"
              value={data.summary.total_users.toLocaleString()}
              sub={`${data.summary.total_enabled.toLocaleString()} enabled`}
            />
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h3 className="text-lg font-semibold text-slate-800">
                  Locked users
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    {filteredRows.length.toLocaleString()} of {data.rows.length.toLocaleString()}
                  </span>
                </h3>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="search"
                  placeholder="Search username, MID, partner…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-sm w-64 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
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
                    <SortHeader k="username" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Username
                    </SortHeader>
                    <SortHeader k="owner" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Owner
                    </SortHeader>
                    <th className="px-4 py-2.5 font-semibold">Company / Partner</th>
                    <SortHeader k="lock" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Lock
                    </SortHeader>
                    <SortHeader k="until" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Locked until
                    </SortHeader>
                    <SortHeader k="failed_login" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} numeric>
                      Login fails
                    </SortHeader>
                    <SortHeader k="failed_mfa" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} numeric>
                      MFA fails
                    </SortHeader>
                    <SortHeader k="last_failed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Last failed
                    </SortHeader>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-slate-500">
                        No locked users for these filters.
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((r) => {
                    const owner = ownerLabel(r);
                    const company = r.merchant_company ?? "—";
                    return (
                      <tr key={r.username} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-xs font-medium text-slate-800 whitespace-nowrap">
                          {r.username}
                        </td>
                        <td className="px-4 py-2">
                          <OwnerPill kind={r.owner_type} />
                          {r.owner_type === "merchant" && r.merchant_no ? (
                            <a
                              href={`/application-support/merchant-lookup/${r.merchant_no}`}
                              className="ml-2 font-mono text-xs text-brand-600 hover:text-brand-700 hover:underline"
                            >
                              {r.merchant_no}
                            </a>
                          ) : (
                            <span className="ml-2 font-mono text-xs text-slate-600">{owner}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-700 max-w-xs truncate" title={company}>
                          {company}
                        </td>
                        <td className="px-4 py-2">
                          <LockBadge kind={r._lock} />
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">
                          {r._lock === "permanent" ? (
                            <span className="text-brand-700 font-semibold">never</span>
                          ) : (
                            shortTs(r._until)
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-medium tabular-nums text-slate-700">
                          {(r.failed_login_attempts ?? 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-medium tabular-nums text-slate-700">
                          {(r.mfa_otp_failed_attempts ?? 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {shortTs(r.last_failed_login_time)}
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

function LockBadge({ kind }: { kind: LockKind | null }) {
  if (!kind) return <span className="text-slate-400">—</span>;
  const map: Record<LockKind, { label: string; color: string }> = {
    permanent: { label: "PERMANENT", color: "#A4262C" },
    mfa: { label: "MFA OTP", color: "#d4a017" },
    login: { label: "LOGIN", color: "#475569" },
  };
  const { label, color } = map[kind];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums"
      style={{ backgroundColor: `${color}15`, color }}
    >
      {label}
    </span>
  );
}

function OwnerPill({ kind }: { kind: DetailRow["owner_type"] }) {
  const map: Record<DetailRow["owner_type"], { label: string; color: string }> = {
    merchant: { label: "Merchant", color: "#A4262C" },
    partner: { label: "Partner", color: "#d4a017" },
    staff: { label: "Staff", color: "#475569" },
    unknown: { label: "Unknown", color: "#94a3b8" },
  };
  const { label, color } = map[kind];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium"
      style={{ backgroundColor: `${color}15`, color }}
    >
      {label}
    </span>
  );
}

function SortHeader({
  k,
  sortKey,
  sortDir,
  onSort,
  children,
  numeric,
}: {
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
  numeric?: boolean;
}) {
  const arrow = sortKey !== k ? "" : sortDir === "asc" ? " ↑" : " ↓";
  return (
    <th
      onClick={() => onSort(k)}
      className={`px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap ${
        numeric ? "text-right" : ""
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
