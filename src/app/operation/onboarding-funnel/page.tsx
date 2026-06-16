"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type StateRow = {
  state: string;
  count: number;
  no_create_date: number;
  age_0_7: number;
  age_8_30: number;
  age_31_90: number;
  age_90_plus: number;
  oldest_create_date: string | null;
  newest_create_date: string | null;
};

type StuckRow = {
  merchant_id: string;
  merchant_no: string | null;
  company_name_en: string | null;
  company_name_th: string | null;
  merchant_name_en: string | null;
  merchant_name_th: string | null;
  person_type: string | null;
  state: string;
  risk: string | null;
  owner_name: string | null;
  partner_no: string | null;
  create_date: string | null;
  register_date: string | null;
  age_days: number | null;
  state_changed_at: string | null;
  days_at_stage: number | null;
};

type ApiResponse = {
  states: StateRow[];
  totals: {
    all: number;
    inPipeline: number;
    approved: number;
    rejected: number;
  };
  stuck: StuckRow[];
};

// Display names match the platform's "All States" list verbatim — the same
// raw enum the rest of the org uses, so search/screenshots line up. Each
// stage's meaning (in real funnel order):
//   REGISTER                       — info entered (create_date)
//   PRE_BUSINESS_APPROVE           — waiting for ops to action
//   BUSINESS_APPROVE               — waiting for merchant to send more docs
//   PRE_APPROVE_OPERATION          — KYC / KYM review
//   PRE_APPROVE_OPERATION_MANAGER  — ops manager sign-off
//   PRE_APPROVE_RISK               — risk team determines risk level
//   PRE_APPROVE_RISK_MANAGER       — risk manager sign-off
//   PRE_APPROVE_SUPERVISOR         — COO sign-off
//   PRE_APPROVE_MANAGER            — CEO sign-off (only required when risk = H)
//   PRE_APPROVE_DOCUMENT           — waiting for contract
//   WAITING_SANDBOX                — waiting for merchant sandbox testing
//   COMPLETE_SANDBOX               — sandbox done, ready to go live
const STATE_LABEL: Record<string, string> = {
  REGISTER: "REGISTER",
  PRE_BUSINESS_APPROVE: "PRE_BUSINESS_APPROVE",
  BUSINESS_APPROVE: "BUSINESS_APPROVE",
  PRE_APPROVE_OPERATION: "PRE_APPROVE_OPERATION",
  PRE_APPROVE_OPERATION_MANAGER: "PRE_APPROVE_OPERATION_MANAGER",
  PRE_APPROVE_RISK: "PRE_APPROVE_RISK",
  PRE_APPROVE_RISK_MANAGER: "PRE_APPROVE_RISK_MANAGER",
  PRE_APPROVE_SUPERVISOR: "PRE_APPROVE_SUPERVISOR",
  PRE_APPROVE_MANAGER: "PRE_APPROVE_MANAGER",
  PRE_APPROVE_DOCUMENT: "PRE_APPROVE_DOCUMENT",
  WAITING_SANDBOX: "WAITING_SANDBOX",
  COMPLETE_SANDBOX: "COMPLETE_SANDBOX",
  APPROVE: "APPROVE",
  REJECT: "REJECT",
};

// Plain-English meaning per state — surfaced on hover everywhere the raw
// enum is rendered so analysts don't have to memorise the FSM.
const STATE_DESCRIPTION: Record<string, string> = {
  REGISTER: "Applicant entered info — create_date is set.",
  PRE_BUSINESS_APPROVE: "Waiting for ops to action.",
  BUSINESS_APPROVE: "Waiting for merchant to send more document info.",
  PRE_APPROVE_OPERATION: "KYC / KYM review by ops.",
  PRE_APPROVE_OPERATION_MANAGER: "Ops manager sign-off.",
  PRE_APPROVE_RISK: "Risk team determines risk level.",
  PRE_APPROVE_RISK_MANAGER: "Risk manager sign-off.",
  PRE_APPROVE_SUPERVISOR: "COO sign-off.",
  PRE_APPROVE_MANAGER: "CEO sign-off — only required when risk = H.",
  PRE_APPROVE_DOCUMENT: "Waiting for contract. Stage age counts from CEO+COO sign-off (risk = H) or COO sign-off (risk = M / L).",
  WAITING_SANDBOX: "Waiting for merchant sandbox testing.",
  COMPLETE_SANDBOX: "Sandbox done, ready to go live.",
  APPROVE: "Approved — live merchant.",
  REJECT: "Rejected — terminal.",
};

// Distinct color per state — each stage gets a visually separate hue so the
// funnel chart is readable at a glance. Terminal states keep emerald (approve)
// and slate (reject) so they stay recognisable elsewhere in the app.
const STATE_COLOR: Record<string, string> = {
  REGISTER: "#3b82f6",                       // blue-500
  PRE_BUSINESS_APPROVE: "#A4262C",           // brand red
  BUSINESS_APPROVE: "#7c3aed",               // violet-600
  PRE_APPROVE_OPERATION: "#f59e0b",          // amber-500
  PRE_APPROVE_OPERATION_MANAGER: "#ea580c",  // orange-600
  PRE_APPROVE_RISK: "#d946ef",               // fuchsia-500
  PRE_APPROVE_RISK_MANAGER: "#a21caf",       // fuchsia-700
  PRE_APPROVE_SUPERVISOR: "#ec4899",         // pink-500
  PRE_APPROVE_MANAGER: "#be185d",            // pink-700
  PRE_APPROVE_DOCUMENT: "#14b8a6",           // teal-500
  WAITING_SANDBOX: "#06b6d4",                // cyan-500
  COMPLETE_SANDBOX: "#84cc16",               // lime-500
  APPROVE: "#059669",                        // emerald-600
  REJECT: "#475569",                         // slate-700
};

type SortKey =
  | "merchant_no"
  | "age_days"
  | "days_at_stage"
  | "state"
  | "partner_no"
  | "owner_name";
type SortDir = "asc" | "desc";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

// dd/mm/yyyy for the Stuck table's Created and State Latest Change columns.
function fmtDateDmy(s: string | null): string {
  if (!s) return "—";
  const ymd = s.slice(0, 10);
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

export default function OnboardingFunnelPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("days_at_stage");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/onboarding-funnel`)
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

  const inPipelineStates = useMemo(
    () =>
      (data?.states ?? []).filter(
        (s) => s.state !== "APPROVE" && s.state !== "REJECT",
      ),
    [data],
  );

  const funnelChart = useMemo(
    () =>
      inPipelineStates.map((s) => ({
        state: STATE_LABEL[s.state] ?? s.state,
        rawState: s.state,
        count: s.count,
      })),
    [inPipelineStates],
  );

  const approvalRate = useMemo(() => {
    if (!data) return 0;
    const finalized = data.totals.approved + data.totals.rejected;
    if (finalized === 0) return 0;
    return data.totals.approved / finalized;
  }, [data]);

  const filteredStuck = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let rows = data.stuck;
    if (filterState !== "all") {
      rows = rows.filter((r) => r.state === filterState);
    }
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.merchant_no ?? "").toLowerCase().includes(q) ||
          r.merchant_id.toLowerCase().includes(q) ||
          (r.company_name_en ?? "").toLowerCase().includes(q) ||
          (r.company_name_th ?? "").toLowerCase().includes(q) ||
          (r.merchant_name_en ?? "").toLowerCase().includes(q) ||
          (r.merchant_name_th ?? "").toLowerCase().includes(q) ||
          (r.partner_no ?? "").toLowerCase().includes(q) ||
          (r.owner_name ?? "").toLowerCase().includes(q),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      switch (sortKey) {
        case "merchant_no":
          // Pre-approval rows have no merchant_no; fall back to the internal
          // id so the sort key stays stable for those rows.
          return dir * (a.merchant_no ?? `#${a.merchant_id}`).localeCompare(
            b.merchant_no ?? `#${b.merchant_id}`,
          );
        case "state":
          return dir * a.state.localeCompare(b.state);
        case "partner_no":
          return dir * (a.partner_no ?? "").localeCompare(b.partner_no ?? "");
        case "owner_name":
          return dir * (a.owner_name ?? "").localeCompare(b.owner_name ?? "");
        case "age_days": {
          // Rows without a create_date have null age — keep them at the
          // bottom regardless of sort direction so they don't dominate the
          // "oldest first" view.
          const av = a.age_days;
          const bv = b.age_days;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return dir * (av - bv);
        }
        case "days_at_stage": {
          const av = a.days_at_stage;
          const bv = b.days_at_stage;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return dir * (av - bv);
        }
      }
    });
    return rows;
  }, [data, search, filterState, sortKey, sortDir]);

  const stuckStateOptions = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.stuck.map((r) => r.state));
    return Array.from(set);
  }, [data]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(
        k === "merchant_no" || k === "partner_no" || k === "owner_name"
          ? "asc"
          : "desc",
      );
    }
  }

  function exportExcel() {
    if (filteredStuck.length === 0) return;
    const rows = filteredStuck.map((r) => ({
      "Merchant No": r.merchant_no ?? `#${r.merchant_id}`,
      "Internal ID": r.merchant_id,
      "Company (EN)": r.company_name_en ?? "",
      "Company (TH)": r.company_name_th ?? "",
      "Brand (EN)": r.merchant_name_en ?? "",
      "Brand (TH)": r.merchant_name_th ?? "",
      "Person Type": r.person_type ?? "",
      State: STATE_LABEL[r.state] ?? r.state,
      Owner: r.owner_name ?? "",
      Partner: r.partner_no ?? "",
      "Create Date": fmtDateDmy(r.create_date),
      "State Latest Change": fmtDateDmy(r.state_changed_at),
      "Register Date": fmtDate(r.register_date),
      "Age (days)": r.age_days ?? "",
      "Days at Stage": r.days_at_stage ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stuck Merchants");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `OnboardingFunnel_Stuck_${stamp}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">Onboarding Funnel</h1>
          <p className="text-slate-600">
            Merchants by onboarding state, with aging from create date.
          </p>
        </div>
        {loading && (
          <div className="text-sm text-slate-500 flex items-center gap-1.5 pt-2">
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
                  <path d="M3 7h18l-1.5 12.5a2 2 0 01-2 1.5h-11a2 2 0 01-2-1.5L3 7z" />
                  <path d="M8 7V5a4 4 0 018 0v2" />
                </svg>
              }
              label="In Pipeline"
              value={data.totals.inPipeline.toLocaleString()}
              sub={`${data.totals.all.toLocaleString()} total merchants on record`}
            />
            <KpiCard
              accent="bg-emerald-500"
              iconBg="bg-emerald-50 text-emerald-700"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              }
              label="Approved (Live)"
              value={data.totals.approved.toLocaleString()}
              sub={`${(approvalRate * 100).toFixed(1)}% of finalized merchants`}
            />
            <KpiCard
              accent="bg-amber-500"
              iconBg="bg-amber-50 text-amber-700"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.74-3l-7-12a2 2 0 00-3.48 0l-7 12A2 2 0 005 19z" />
                </svg>
              }
              label="Stuck in Pipeline"
              value={data.stuck.length.toLocaleString()}
              sub="Any merchant past Register and not yet Approved/Rejected"
            />
            <KpiCard
              accent="bg-slate-700"
              iconBg="bg-slate-100 text-slate-700"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              }
              label="Rejected"
              value={data.totals.rejected.toLocaleString()}
              sub={`${((1 - approvalRate) * 100).toFixed(1)}% of finalized`}
            />
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
              <h3 className="text-lg font-semibold text-slate-800">
                Pipeline by Stage
                <span className="text-sm font-normal text-slate-500 ml-2">
                  In-pipeline only (excludes Approved &amp; Rejected)
                </span>
              </h3>
            </div>
            <div style={{ width: "100%", height: Math.max(280, funnelChart.length * 48 + 40) }}>
              <ResponsiveContainer>
                <BarChart
                  data={funnelChart}
                  layout="vertical"
                  margin={{ top: 5, right: 60, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" stroke="#64748b" fontSize={12} />
                  <YAxis
                    type="category"
                    dataKey="state"
                    stroke="#64748b"
                    fontSize={11}
                    width={180}
                    tick={{ textAnchor: "end" }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as {
                        state: string;
                        rawState: string;
                        count: number;
                      };
                      const desc = STATE_DESCRIPTION[d.rawState];
                      return (
                        <div className="bg-white border border-slate-200 rounded-md shadow-md p-3 text-xs max-w-xs">
                          <div className="font-mono font-semibold text-slate-900">
                            {d.state}
                          </div>
                          {desc && (
                            <div className="text-slate-600 mt-1 leading-snug">{desc}</div>
                          )}
                          <div className="mt-2 text-slate-800">
                            <span className="font-mono font-semibold tabular-nums">
                              {d.count.toLocaleString()}
                            </span>
                            <span className="text-slate-500 ml-1">merchants</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {funnelChart.map((d) => (
                      <Cell key={d.rawState} fill={STATE_COLOR[d.rawState] ?? "#A4262C"} />
                    ))}
                    <LabelList
                      dataKey="count"
                      position="right"
                      fill="#475569"
                      fontSize={11}
                      fontWeight={600}
                      formatter={(v: number) => v.toLocaleString()}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h3 className="text-lg font-semibold text-slate-800">
                  Stage Breakdown
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    Aging by create date
                  </span>
                </h3>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-slate-600 border-b border-slate-200">
                    <th className="px-4 py-2.5 font-semibold">Stage</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Count</th>
                    <th className="px-4 py-2.5 font-semibold text-right">0–7d</th>
                    <th className="px-4 py-2.5 font-semibold text-right">8–30d</th>
                    <th className="px-4 py-2.5 font-semibold text-right">31–90d</th>
                    <th className="px-4 py-2.5 font-semibold text-right">90d+</th>
                    <th className="px-4 py-2.5 font-semibold text-right">No date</th>
                    <th className="px-4 py-2.5 font-semibold">Oldest entry</th>
                  </tr>
                </thead>
                <tbody>
                  {data.states.map((s) => {
                    const color = STATE_COLOR[s.state] ?? "#A4262C";
                    return (
                      <tr key={s.state} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <span
                            className="inline-flex items-center gap-2 cursor-help"
                            title={STATE_DESCRIPTION[s.state] ?? ""}
                          >
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            <span className="font-medium text-slate-800">
                              {STATE_LABEL[s.state] ?? s.state}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-medium tabular-nums text-slate-900">
                          {s.count.toLocaleString()}
                        </td>
                        <AgeCell value={s.age_0_7} />
                        <AgeCell value={s.age_8_30} />
                        <AgeCell value={s.age_31_90} warn={s.state !== "APPROVE" && s.state !== "REJECT"} />
                        <AgeCell value={s.age_90_plus} warn={s.state !== "APPROVE" && s.state !== "REJECT"} bad />
                        <AgeCell value={s.no_create_date} />
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">
                          {fmtDate(s.oldest_create_date)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1 h-5 rounded-full bg-accent-500" />
                <h3 className="text-lg font-semibold text-slate-800">
                  Stuck Merchants
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    {filteredStuck.length.toLocaleString()} of {data.stuck.length.toLocaleString()} in pipeline
                  </span>
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
                >
                  <option value="all">All stages</option>
                  {stuckStateOptions.map((s) => (
                    <option key={s} value={s} title={STATE_DESCRIPTION[s] ?? ""}>
                      {STATE_LABEL[s] ?? s}
                    </option>
                  ))}
                </select>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search merchant / Merchant / partner…"
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-sm w-64 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
                <button
                  type="button"
                  onClick={exportExcel}
                  disabled={filteredStuck.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
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
                      Merchant No
                    </SortHeader>
                    <th className="px-4 py-2.5 font-semibold">Merchant</th>
                    <SortHeader k="state" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Stage
                    </SortHeader>
                    <SortHeader k="owner_name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Owner
                    </SortHeader>
                    <SortHeader k="partner_no" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}>
                      Partner
                    </SortHeader>
                    <th className="px-4 py-2.5 font-semibold">Created</th>
                    <th className="px-4 py-2.5 font-semibold whitespace-nowrap">State Change</th>
                    <SortHeader k="age_days" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} numeric>
                      Age (days)
                    </SortHeader>
                    <SortHeader k="days_at_stage" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} numeric>
                      Stuck at stage
                    </SortHeader>
                  </tr>
                </thead>
                <tbody>
                  {filteredStuck.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-slate-500">
                        No stuck merchants for these filters.
                      </td>
                    </tr>
                  )}
                  {filteredStuck.map((r) => {
                    // Company name falls back through registered → brand name so
                    // pre-approval rows (where company_name_* is still blank)
                    // still show something identifying.
                    const company =
                      r.company_name_en ||
                      r.company_name_th ||
                      r.merchant_name_en ||
                      r.merchant_name_th ||
                      "—";
                    const color = STATE_COLOR[r.state] ?? "#A4262C";
                    return (
                      <tr key={r.merchant_id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-xs font-medium text-slate-800 whitespace-nowrap">
                          {r.merchant_no ? (
                            <a
                              href={`/application-support/merchant-lookup/${r.merchant_no}`}
                              className="text-brand-600 hover:text-brand-700 hover:underline"
                            >
                              {r.merchant_no}
                            </a>
                          ) : (
                            <span
                              className="text-slate-500"
                              title="No MID assigned yet — merchant is still in onboarding"
                            >
                              #{r.merchant_id}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-700 max-w-xs truncate" title={company}>
                          {company}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium cursor-help"
                            style={{ backgroundColor: `${color}15`, color }}
                            title={STATE_DESCRIPTION[r.state] ?? ""}
                          >
                            {STATE_LABEL[r.state] ?? r.state}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-700 whitespace-nowrap">
                          {r.owner_name ?? "—"}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">
                          {r.partner_no ?? "—"}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {fmtDateDmy(r.create_date)}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {fmtDateDmy(r.state_changed_at)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-mono font-medium tabular-nums ${
                            r.age_days === null
                              ? "text-slate-400"
                              : r.age_days >= 90
                                ? "text-red-700"
                                : r.age_days >= 30
                                  ? "text-amber-700"
                                  : "text-slate-700"
                          }`}
                        >
                          {r.age_days === null ? "—" : r.age_days.toLocaleString()}
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-mono font-medium tabular-nums ${
                            r.days_at_stage === null
                              ? "text-slate-400"
                              : r.days_at_stage >= 30
                                ? "text-red-700"
                                : r.days_at_stage >= 7
                                  ? "text-amber-700"
                                  : "text-slate-700"
                          }`}
                          title="Days in current stage. For PRE_APPROVE_DOCUMENT: from CEO+COO sign-off (High risk) or COO sign-off (Med/Low). Other stages: latest of create / register / approve timestamps."
                        >
                          {r.days_at_stage === null ? "—" : r.days_at_stage.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.stuck.length === 1000 && (
              <div className="px-5 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-200">
                Showing the 1,000 oldest stuck merchants. Narrow filters to see fewer.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AgeCell({ value, warn, bad }: { value: number; warn?: boolean; bad?: boolean }) {
  if (value === 0) {
    return <td className="px-4 py-2 text-right font-mono text-slate-300">—</td>;
  }
  const cls = bad
    ? "text-red-700"
    : warn
      ? "text-amber-700"
      : "text-slate-700";
  return (
    <td className={`px-4 py-2 text-right font-mono font-medium tabular-nums ${cls}`}>
      {value.toLocaleString()}
    </td>
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
