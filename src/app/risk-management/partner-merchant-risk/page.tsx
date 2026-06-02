"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Adapted from the original CSV-upload Partner Risk dashboard. The rendering
// (panels, donuts, AE compare, rollup table) is unchanged; only the data
// source has flipped — we now hit /api/partner-merchant-risk on mount instead
// of asking the user to upload CSVs.

// ---- domains + colours ----------------------------------------------------

const RISK_ORDER = ["High", "Medium", "Low", "Unrated"] as const;
const STATUS_ORDER = ["Active", "Inactive", "Closed"] as const;
type Risk = (typeof RISK_ORDER)[number];
type Status = (typeof STATUS_ORDER)[number];

const RISK_COLORS: Record<Risk, string> = {
  High: "#A4262C",
  Medium: "#d4a017",
  Low: "#059669",
  Unrated: "#94a3b8",
};

const STATUS_COLORS: Record<Status, string> = {
  Active: "#059669",
  Inactive: "#A4262C",
  Closed: "#1e293b",
};

// ---- row shapes (match the API response) ---------------------------------

type PartnerRow = { ae: string | null; status: Status; risk: Risk };
type MerchantRow = {
  code: string | null;
  status: Status;
  risk: Risk;
  ae: string | null;
};

type ApiResponse = { partners: PartnerRow[]; merchants: MerchantRow[] };

// ---- number helpers -------------------------------------------------------

function formatNum(n: number): string {
  return n.toLocaleString();
}
function formatPct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function tallyRisk<T extends { risk: Risk }>(rows: T[]): Record<Risk, number> {
  const out: Record<Risk, number> = { High: 0, Medium: 0, Low: 0, Unrated: 0 };
  for (const r of rows) out[r.risk]++;
  return out;
}
function tallyStatus<T extends { status: Status }>(
  rows: T[],
): Record<Status, number> {
  const out: Record<Status, number> = { Active: 0, Inactive: 0, Closed: 0 };
  for (const r of rows) out[r.status]++;
  return out;
}

// ===========================================================================
// Page
// ===========================================================================

export default function PartnerMerchantRiskPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/partner-merchant-risk")
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Partner &amp; Merchant Risk</h1>
        <p className="text-slate-600">
          Risk and status distribution across partners (AEs) and their merchants,
          sourced live from{" "}
          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">partner_info</span>
          {" "}+{" "}
          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">merchant_info</span>.
          Select one or more AEs to filter both panels and compare them side by side.
        </p>
      </div>

      {loading && (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500">
          <div className="inline-flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Loading partner / merchant data…
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {data && !loading && !error && (
        <Dashboard partners={data.partners} merchants={data.merchants} />
      )}
    </div>
  );
}

// ===========================================================================
// Dashboard body
// ===========================================================================

const ALL = "All";

function Dashboard({
  partners,
  merchants,
}: {
  partners: PartnerRow[];
  merchants: MerchantRow[];
}) {
  const [selectedAEs, setSelectedAEs] = useState<Set<string>>(new Set());

  const [pStatus, setPStatus] = useState<string>(ALL);
  const [pRisk, setPRisk] = useState<string>(ALL);
  const [mStatus, setMStatus] = useState<string>(ALL);
  const [mRisk, setMRisk] = useState<string>(ALL);

  const merchantRecords = useMemo(
    () => merchants.filter((m) => m.code !== null),
    [merchants],
  );

  const allAEs = useMemo(() => {
    const s = new Set<string>();
    for (const p of partners) if (p.ae) s.add(p.ae);
    for (const m of merchantRecords) if (m.ae) s.add(m.ae);
    return [...s].sort();
  }, [partners, merchantRecords]);

  const aeSelected = (ae: string | null) =>
    selectedAEs.size === 0 || (ae !== null && selectedAEs.has(ae));

  const partnerFiltered = useMemo(
    () =>
      partners.filter(
        (p) =>
          aeSelected(p.ae) &&
          (pStatus === ALL || p.status === pStatus) &&
          (pRisk === ALL || p.risk === pRisk),
      ),
    [partners, selectedAEs, pStatus, pRisk],
  );

  const merchantFiltered = useMemo(
    () =>
      merchantRecords.filter(
        (m) =>
          aeSelected(m.ae) &&
          (mStatus === ALL || m.status === mStatus) &&
          (mRisk === ALL || m.risk === mRisk),
      ),
    [merchantRecords, selectedAEs, mStatus, mRisk],
  );

  const pRiskTally = useMemo(() => tallyRisk(partnerFiltered), [partnerFiltered]);
  const pStatusTally = useMemo(
    () => tallyStatus(partnerFiltered),
    [partnerFiltered],
  );
  const mRiskTally = useMemo(() => tallyRisk(merchantFiltered), [merchantFiltered]);
  const mStatusTally = useMemo(
    () => tallyStatus(merchantFiltered),
    [merchantFiltered],
  );

  const rollup = useMemo<AeRollup[]>(() => {
    const map = new Map<string, AeRollup>();
    const ensure = (ae: string) => {
      let r = map.get(ae);
      if (!r) {
        r = {
          ae,
          partnerStatus: null,
          partnerRisk: null,
          merchants: 0,
          risk: { High: 0, Medium: 0, Low: 0, Unrated: 0 },
          status: { Active: 0, Inactive: 0, Closed: 0 },
        };
        map.set(ae, r);
      }
      return r;
    };
    for (const p of partners) {
      if (!p.ae) continue;
      const r = ensure(p.ae);
      r.partnerStatus = p.status;
      r.partnerRisk = p.risk;
    }
    for (const m of merchantRecords) {
      if (!m.ae) continue;
      const r = ensure(m.ae);
      r.merchants++;
      r.risk[m.risk]++;
      r.status[m.status]++;
    }
    return [...map.values()];
  }, [partners, merchantRecords]);

  const selectedRollups = useMemo(
    () =>
      rollup
        .filter((r) => selectedAEs.has(r.ae))
        .sort((a, b) => b.merchants - a.merchants),
    [rollup, selectedAEs],
  );

  const noAeMerchants = useMemo(
    () => merchantRecords.filter((m) => !m.ae).length,
    [merchantRecords],
  );

  function toggleAe(ae: string) {
    setSelectedAEs((prev) => {
      const next = new Set(prev);
      if (next.has(ae)) next.delete(ae);
      else next.add(ae);
      return next;
    });
  }
  function clearAEs() {
    setSelectedAEs(new Set());
  }

  const filterLabel =
    selectedAEs.size === 0
      ? "All partners"
      : `${selectedAEs.size} AE${selectedAEs.size === 1 ? "" : "s"} selected`;

  return (
    <>
      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
          <span className="text-sm font-semibold text-slate-700">
            Select &amp; compare AEs
          </span>
        </div>
        <AeMultiSelect
          allAEs={allAEs}
          selected={selectedAEs}
          onToggle={toggleAe}
          onClear={clearAEs}
          label={filterLabel}
        />
        {selectedAEs.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {[...selectedAEs].sort().map((ae) => (
              <button
                key={ae}
                onClick={() => toggleAe(ae)}
                className="group inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-200 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 transition-colors"
                title="Remove from selection"
              >
                <span className="font-mono">{ae}</span>
                <span className="text-brand-400 group-hover:text-brand-600">
                  ×
                </span>
              </button>
            ))}
            <button
              onClick={clearAEs}
              className="text-xs text-slate-500 hover:text-slate-700 ml-1"
            >
              Reset
            </button>
          </div>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {allAEs.length} AE{allAEs.length === 1 ? "" : "s"} in the data
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title="Partner Risk" accent="bg-brand-600">
          <div className="flex flex-wrap items-end gap-3">
            <BigNumber
              value={partnerFiltered.length}
              caption="partners"
              sub={`of ${formatNum(partners.length)} total`}
            />
            <div className="flex flex-wrap gap-3">
              <Slicer
                label="Status"
                value={pStatus}
                onChange={setPStatus}
                options={STATUS_ORDER}
              />
              <Slicer
                label="Risk"
                value={pRisk}
                onChange={setPRisk}
                options={RISK_ORDER}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
            <DonutCard
              title="By risk"
              data={riskChartData(pRiskTally)}
              total={partnerFiltered.length}
            />
            <DonutCard
              title="By status"
              data={statusChartData(pStatusTally)}
              total={partnerFiltered.length}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <CategoryBar title="Partner risk" data={riskChartData(pRiskTally)} />
            <CategoryBar
              title="Partner status"
              data={statusChartData(pStatusTally)}
            />
          </div>
        </Panel>

        <Panel title="Merchant Risk" accent="bg-slate-800">
          <div className="flex flex-wrap items-end gap-3">
            <BigNumber
              value={merchantFiltered.length}
              caption="merchants"
              sub={`of ${formatNum(merchantRecords.length)} total`}
            />
            <div className="flex flex-wrap gap-3">
              <Slicer
                label="Status"
                value={mStatus}
                onChange={setMStatus}
                options={STATUS_ORDER}
              />
              <Slicer
                label="Risk"
                value={mRisk}
                onChange={setMRisk}
                options={RISK_ORDER}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
            <DonutCard
              title="By risk"
              data={riskChartData(mRiskTally)}
              total={merchantFiltered.length}
            />
            <DonutCard
              title="By status"
              data={statusChartData(mStatusTally)}
              total={merchantFiltered.length}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <CategoryBar title="Merchant status" data={statusChartData(mStatusTally)} />
            <CategoryBar title="Merchant risk" data={riskChartData(mRiskTally)} />
          </div>
          {noAeMerchants > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              {formatNum(noAeMerchants)} merchant
              {noAeMerchants === 1 ? "" : "s"} have no AE — included in totals
              but not attributed to any partner in the comparison below.
            </p>
          )}
        </Panel>
      </div>

      <CompareSection selected={selectedRollups} />

      <RollupTable
        rollup={rollup}
        selected={selectedAEs}
        onToggle={toggleAe}
      />
    </>
  );
}

type AeRollup = {
  ae: string;
  partnerStatus: Status | null;
  partnerRisk: Risk | null;
  merchants: number;
  risk: Record<Risk, number>;
  status: Record<Status, number>;
};

type Slice = { name: string; value: number; color: string };

function riskChartData(t: Record<Risk, number>): Slice[] {
  return RISK_ORDER.filter((k) => t[k] > 0).map((k) => ({
    name: k,
    value: t[k],
    color: RISK_COLORS[k],
  }));
}
function statusChartData(t: Record<Status, number>): Slice[] {
  return STATUS_ORDER.filter((k) => t[k] > 0).map((k) => ({
    name: k,
    value: t[k],
    color: STATUS_COLORS[k],
  }));
}

// ===========================================================================
// Reusable pieces
// ===========================================================================

function Panel({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <span className={`inline-block w-1 h-5 rounded-full ${accent}`} />
        <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function BigNumber({
  value,
  caption,
  sub,
}: {
  value: number;
  caption: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-900 text-white px-6 py-4 min-w-[140px]">
      <div className="text-4xl font-bold tabular-nums leading-none">
        {formatNum(value)}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wide text-slate-300">
        {caption}
      </div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Slicer({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors min-w-[130px]"
      >
        <option value={ALL}>All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function DonutCard({
  title,
  data,
  total,
}: {
  title: string;
  data: Slice[];
  total: number;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
        {title}
      </div>
      {total === 0 ? (
        <div className="h-[180px] flex items-center justify-center text-sm text-slate-400">
          No rows
        </div>
      ) : (
        <>
          <div style={{ width: "100%", height: 180 }} className="relative">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={80}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                  formatter={(value: number, name) => [
                    `${formatNum(value)} (${formatPct(value, total)})`,
                    name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-2xl font-bold text-slate-900 tabular-nums">
                {formatNum(total)}
              </div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide">
                total
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {data.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: d.color }}
                />
                <span className="text-slate-600">{d.name}</span>
                <span className="font-mono font-medium text-slate-800">
                  {formatNum(d.value)}
                </span>
                <span className="text-slate-400">
                  {formatPct(d.value, total)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CategoryBar({ title, data }: { title: string; data: Slice[] }) {
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
        {title}
      </div>
      {data.length === 0 ? (
        <div className="h-[160px] flex items-center justify-center text-sm text-slate-400">
          No rows
        </div>
      ) : (
        <div style={{ width: "100%", height: Math.max(140, data.length * 42) }}>
          <ResponsiveContainer>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
              barCategoryGap={10}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#e2e8f0"
                horizontal={false}
              />
              <XAxis
                type="number"
                stroke="#64748b"
                fontSize={11}
                domain={[0, max]}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="#64748b"
                fontSize={11}
                width={64}
                tick={{ textAnchor: "end" }}
              />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                formatter={(value: number) => [formatNum(value), "Count"]}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
                <LabelList
                  dataKey="value"
                  position="right"
                  fill="#475569"
                  fontSize={11}
                  fontWeight={600}
                  formatter={(v: number) => formatNum(v)}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function AeMultiSelect({
  allAEs,
  selected,
  onToggle,
  onClear,
  label,
}: {
  allAEs: string[];
  selected: Set<string>;
  onToggle: (ae: string) => void;
  onClear: () => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allAEs;
    return allAEs.filter((a) => a.toLowerCase().includes(q));
  }, [allAEs, query]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-md text-sm bg-white hover:border-slate-400 transition-colors min-w-[170px]"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
        <span className="text-slate-700">{label}</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 text-slate-400 ml-auto transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 mt-2 w-72 rounded-lg border border-slate-200/80 bg-white shadow-cardHover z-40 flex flex-col">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search AE code…"
              className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-400">
                No matches
              </div>
            ) : (
              filtered.map((ae) => {
                const checked = selected.has(ae);
                return (
                  <button
                    key={ae}
                    onClick={() => onToggle(ae)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-slate-50 text-left"
                  >
                    <span
                      className={`flex-none h-4 w-4 rounded border flex items-center justify-center ${
                        checked
                          ? "bg-brand-600 border-brand-600 text-white"
                          : "border-slate-300"
                      }`}
                    >
                      {checked && (
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3 w-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="font-mono text-xs text-slate-700">
                      {ae}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between p-2 border-t border-slate-100 text-xs">
            <span className="text-slate-500">
              {selected.size} selected
            </span>
            <button
              onClick={onClear}
              className="text-slate-500 hover:text-brand-700 font-medium"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CompareSection({ selected }: { selected: AeRollup[] }) {
  const compareBars = useMemo(
    () =>
      selected.map((r) => ({
        ae: r.ae,
        High: r.risk.High,
        Medium: r.risk.Medium,
        Low: r.risk.Low,
        Unrated: r.risk.Unrated,
      })),
    [selected],
  );

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-block w-1 h-5 rounded-full bg-accent-500" />
        <h3 className="text-lg font-semibold text-slate-800">
          Compare AEs
          {selected.length > 0 && (
            <span className="text-sm font-normal text-slate-500 ml-2">
              {selected.length} selected
            </span>
          )}
        </h3>
      </div>

      {selected.length === 0 ? (
        <div className="py-10 text-center text-slate-400 text-sm">
          Select one or more AEs above (or tick rows in the table below) to
          compare their merchant risk and status side by side.
        </div>
      ) : (
        <>
          <div style={{ width: "100%", height: Math.max(220, selected.length * 46) }}>
            <ResponsiveContainer>
              <BarChart
                data={compareBars}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 12, bottom: 4 }}
                barCategoryGap={14}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#e2e8f0"
                  horizontal={false}
                />
                <XAxis type="number" stroke="#64748b" fontSize={11} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="ae"
                  stroke="#64748b"
                  fontSize={11}
                  width={84}
                  tick={{ textAnchor: "end" }}
                />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                {RISK_ORDER.map((k) => (
                  <Bar key={k} dataKey={k} stackId="r" fill={RISK_COLORS[k]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {selected.map((r) => (
              <CompareCard key={r.ae} r={r} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CompareCard({ r }: { r: AeRollup }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="font-mono text-sm font-semibold text-slate-800">
          {r.ae}
        </span>
        <div className="flex items-center gap-1.5">
          {r.partnerStatus && (
            <Badge color={STATUS_COLORS[r.partnerStatus]} text={r.partnerStatus} />
          )}
          {r.partnerRisk && (
            <Badge color={RISK_COLORS[r.partnerRisk]} text={r.partnerRisk} />
          )}
        </div>
      </div>
      <div className="text-3xl font-bold text-slate-900 tabular-nums leading-none">
        {formatNum(r.merchants)}
      </div>
      <div className="text-xs text-slate-500 mb-3">merchants</div>

      <MiniStacked
        title="Risk"
        segments={RISK_ORDER.filter((k) => r.risk[k] > 0).map((k) => ({
          label: k,
          value: r.risk[k],
          color: RISK_COLORS[k],
        }))}
        total={r.merchants}
      />
      <div className="mt-2">
        <MiniStacked
          title="Status"
          segments={STATUS_ORDER.filter((k) => r.status[k] > 0).map((k) => ({
            label: k,
            value: r.status[k],
            color: STATUS_COLORS[k],
          }))}
          total={r.merchants}
        />
      </div>
    </div>
  );
}

function MiniStacked({
  title,
  segments,
  total,
}: {
  title: string;
  segments: { label: string; value: number; color: string }[];
  total: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase tracking-wide mb-1">
        <span>{title}</span>
      </div>
      <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-slate-100">
        {segments.map((s) => (
          <div
            key={s.label}
            className="h-full"
            style={{
              width: total > 0 ? `${(s.value / total) * 100}%` : "0%",
              backgroundColor: s.color,
            }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {segments.map((s) => (
          <span
            key={s.label}
            className="inline-flex items-center gap-1 text-[11px] text-slate-600"
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label} <span className="font-mono text-slate-800">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Badge({ color, text }: { color: string; text: string }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-white uppercase tracking-wide"
      style={{ backgroundColor: color }}
    >
      {text}
    </span>
  );
}

type RollupSortKey =
  | "ae"
  | "partnerRisk"
  | "merchants"
  | "High"
  | "Medium"
  | "highRate";

function RollupTable({
  rollup,
  selected,
  onToggle,
}: {
  rollup: AeRollup[];
  selected: Set<string>;
  onToggle: (ae: string) => void;
}) {
  const [sortKey, setSortKey] = useState<RollupSortKey>("merchants");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const arr = [...rollup];
    const dir = sortDir === "asc" ? 1 : -1;
    const riskRank = (r: Risk | null) =>
      r === null ? 99 : RISK_ORDER.indexOf(r);
    arr.sort((a, b) => {
      switch (sortKey) {
        case "ae":
          return dir * a.ae.localeCompare(b.ae);
        case "partnerRisk":
          return dir * (riskRank(a.partnerRisk) - riskRank(b.partnerRisk));
        case "merchants":
          return dir * (a.merchants - b.merchants);
        case "High":
          return dir * (a.risk.High - b.risk.High);
        case "Medium":
          return dir * (a.risk.Medium - b.risk.Medium);
        case "highRate":
          return (
            dir *
            (a.risk.High / Math.max(a.merchants, 1) -
              b.risk.High / Math.max(b.merchants, 1))
          );
      }
    });
    return arr;
  }, [rollup, sortKey, sortDir]);

  function toggleSort(k: RollupSortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "ae" ? "asc" : "desc");
    }
  }

  function exportExcel() {
    const rows = sorted.map((r) => ({
      AE: r.ae,
      "AE Status": r.partnerStatus ?? "",
      "AE Risk": r.partnerRisk ?? "",
      Merchants: r.merchants,
      High: r.risk.High,
      Medium: r.risk.Medium,
      Low: r.risk.Low,
      Unrated: r.risk.Unrated,
      "Active (merchants)": r.status.Active,
      "Inactive (merchants)": r.status.Inactive,
      "Closed (merchants)": r.status.Closed,
      "High %": r.merchants > 0 ? r.risk.High / r.merchants : 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    const pctCol = 11; // "High %"
    for (let row = range.s.r + 1; row <= range.e.r; row++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: pctCol })];
      if (cell) cell.z = "0.0%";
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Partner & Merchant Risk by AE");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `partner-merchant-risk-${stamp}.xlsx`);
  }

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
          <h3 className="text-lg font-semibold text-slate-800">
            Partner risk by AE
            <span className="text-sm font-normal text-slate-500 ml-2">
              {rollup.length} AE{rollup.length === 1 ? "" : "s"} · tick to
              compare
            </span>
          </h3>
        </div>
        <button
          type="button"
          onClick={exportExcel}
          disabled={rollup.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
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
      </div>
      <div className="overflow-x-auto max-h-[600px]">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr className="text-left text-slate-600 border-b border-slate-200">
              <th className="px-3 py-2.5 w-10" />
              <RTh k="ae" sk={sortKey} sd={sortDir} on={toggleSort}>
                AE
              </RTh>
              <th className="px-4 py-2.5 font-semibold whitespace-nowrap">
                AE Status
              </th>
              <RTh k="partnerRisk" sk={sortKey} sd={sortDir} on={toggleSort}>
                AE Risk
              </RTh>
              <RTh k="merchants" sk={sortKey} sd={sortDir} on={toggleSort} numeric>
                Merchants
              </RTh>
              <RTh k="High" sk={sortKey} sd={sortDir} on={toggleSort} numeric>
                High
              </RTh>
              <RTh k="Medium" sk={sortKey} sd={sortDir} on={toggleSort} numeric>
                Medium
              </RTh>
              <th className="px-4 py-2.5 font-semibold text-right">Low</th>
              <th className="px-4 py-2.5 font-semibold text-right">Unrated</th>
              <RTh k="highRate" sk={sortKey} sd={sortDir} on={toggleSort} numeric>
                High %
              </RTh>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-12 text-slate-500">
                  No AEs in the data.
                </td>
              </tr>
            )}
            {sorted.map((r) => {
              const checked = selected.has(r.ae);
              return (
                <tr
                  key={r.ae}
                  onClick={() => onToggle(r.ae)}
                  className={`border-b border-slate-100 cursor-pointer ${
                    checked ? "bg-brand-50/60" : "hover:bg-slate-50"
                  }`}
                >
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex h-4 w-4 rounded border items-center justify-center ${
                        checked
                          ? "bg-brand-600 border-brand-600 text-white"
                          : "border-slate-300"
                      }`}
                    >
                      {checked && (
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3 w-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs font-medium text-slate-800 whitespace-nowrap">
                    {r.ae}
                  </td>
                  <td className="px-4 py-2">
                    {r.partnerStatus ? (
                      <Badge
                        color={STATUS_COLORS[r.partnerStatus]}
                        text={r.partnerStatus}
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {r.partnerRisk ? (
                      <Badge
                        color={RISK_COLORS[r.partnerRisk]}
                        text={r.partnerRisk}
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-medium tabular-nums text-slate-800">
                    {formatNum(r.merchants)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-brand-700">
                    {formatNum(r.risk.High)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-amber-600">
                    {formatNum(r.risk.Medium)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-emerald-700">
                    {formatNum(r.risk.Low)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-400">
                    {formatNum(r.risk.Unrated)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-700">
                    {formatPct(r.risk.High, r.merchants)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RTh({
  k,
  sk,
  sd,
  on,
  children,
  numeric,
}: {
  k: RollupSortKey;
  sk: RollupSortKey;
  sd: "asc" | "desc";
  on: (k: RollupSortKey) => void;
  children: React.ReactNode;
  numeric?: boolean;
}) {
  const arrow = sk !== k ? "" : sd === "asc" ? " ↑" : " ↓";
  return (
    <th
      onClick={() => on(k)}
      className={`px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap ${
        numeric ? "text-right" : ""
      }`}
    >
      {children}
      <span className="text-brand-600">{arrow}</span>
    </th>
  );
}
