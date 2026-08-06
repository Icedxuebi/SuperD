"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Issue types that count as "merchant tickets" (the GREEN bar in chart 1).
const TICKET_ISSUE_TYPES = [
  "เปลี่ยนแปลง IP",
  "Debit Note",
  "Case Slip ขาฝาก",
  "แก้ไข Webhook",
];

const COLOR_BRAND = "#A4262C";
const COLOR_GREEN = "#059669";
const COLOR_BLUE = "#2563eb";

// Rank-based ramp for the "by partner" chart (hot → cool, like the source deck).
const PARTNER_RAMP = [
  "#A4262C",
  "#ea580c",
  "#d4a017",
  "#059669",
  "#0891b2",
  "#2563eb",
  "#1e293b",
];

type TicketRow = {
  date: Date | null;
  closeDate: Date | null;
  partner: string;
  issueType: string;
  createBy: string;
  closeBy: string;
  status: string;
};

// ---- CSV parsing (full-text, quote- and newline-aware) -------------------

function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (q) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') {
      q = true;
    } else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
  }
  return rows;
}

// d/m/yyyy — auto-detects Buddhist era (year > 2400 → subtract 543).
function parseDmy(s: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y > 2400) y -= 543;
  if (y < 100) y += 2000;
  const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Columns dropped before mapping — never read into the dashboard.
const IGNORE_COLUMNS = ["check"];

function rowsToTickets(table: string[][]): { tickets: TicketRow[]; error?: string } {
  if (table.length < 2) return { tickets: [], error: "The file has no data rows." };
  const rawHeader = table[0].map((h) => h.trim().replace(/\*/g, ""));
  const keep = rawHeader.map((h) => !IGNORE_COLUMNS.includes(h.toLowerCase()));
  const header = rawHeader.filter((_, i) => keep[i]);
  const body = table.slice(1).map((r) => r.filter((_, i) => keep[i]));
  const col = (name: string) => header.findIndex((h) => h === name);
  const iDate = col("Date");
  const iClose = col("Close Date");
  const iPartner = col("Partner ID");
  const iIssue = col("Issue Type");
  const iCreateBy = col("Create By");
  const iCloseBy = col("Close By");
  const iStatus = col("Status");
  if (iIssue < 0 || iPartner < 0) {
    return {
      tickets: [],
      error:
        "Couldn't find the expected columns (need at least 'Issue Type' and 'Partner ID').",
    };
  }
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const tickets = body
    // A row whose only content was an ignored column (e.g. a lone "Check"
    // flag) is now blank — drop it so it doesn't become a phantom "—" entry.
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => ({
      date: parseDmy(get(r, iDate)),
      closeDate: parseDmy(get(r, iClose)),
      partner: get(r, iPartner),
      issueType: get(r, iIssue),
      createBy: get(r, iCreateBy),
      closeBy: get(r, iCloseBy),
      status: get(r, iStatus),
    }))
    // A real ticket must have an Issue Type — skip blank/placeholder rows.
    .filter((t) => t.issueType !== "")
    .map((t) => ({ ...t, partner: t.partner || "—" }));
  return { tickets };
}

// ---- aggregation ----------------------------------------------------------

function isClosed(t: TicketRow): boolean {
  return t.closeBy.trim() !== "" || t.status.toLowerCase() === "done";
}

function formatNum(n: number): string {
  return n.toLocaleString();
}

// Lighten (percent > 0) or darken (percent < 0) a #rrggbb / #rgb color.
function shade(hex: string, percent: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const num = parseInt(full, 16);
  const adj = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + (percent / 100) * (percent > 0 ? 255 - c : c))));
  const r = adj((num >> 16) & 0xff);
  const g = adj((num >> 8) & 0xff);
  const b = adj(num & 0xff);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Custom recharts bar shape: extrudes the rect up-and-right with a lit top
// face and a shaded side face to fake a 3D block (works for vertical &
// horizontal bars). All props are optional because recharts injects them.
function Bar3D({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  fill = "#94a3b8",
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
}) {
  if (!(width > 0) || !(height > 0)) return null;
  const depth = Math.max(4, Math.min(14, Math.min(width, height) * 0.4));
  return (
    <g>
      {/* front face */}
      <path d={`M${x},${y} h${width} v${height} h${-width} Z`} fill={fill} />
      {/* top face (lit) */}
      <path
        d={`M${x},${y} l${depth},${-depth} h${width} l${-depth},${depth} Z`}
        fill={shade(fill, 20)}
      />
      {/* right side face (shaded) */}
      <path
        d={`M${x + width},${y} l${depth},${-depth} v${height} l${-depth},${depth} Z`}
        fill={shade(fill, -22)}
      />
    </g>
  );
}

// ---- page -----------------------------------------------------------------

export default function TicketDashboardPage() {
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const ingest = useCallback((file: File) => {
    setError(null);
    if (!/\.csv$/i.test(file.name)) {
      setError("Please upload a .csv file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const table = parseCsv(String(reader.result ?? ""));
        const { tickets: parsed, error: err } = rowsToTickets(table);
        if (err) {
          setError(err);
          return;
        }
        setTickets(parsed);
        setFileName(file.name);
      } catch {
        setError("Failed to parse the CSV file.");
      }
    };
    reader.onerror = () => setError("Failed to read the file.");
    reader.readAsText(file, "utf-8");
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) ingest(file);
    },
    [ingest],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Ticket Dashboard</h1>
        <p className="text-slate-600">
          Upload a support-ticket CSV export to visualise issues, throughput, and
          partner load.
        </p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={`block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-brand-600 bg-brand-50"
              : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/40"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) ingest(file);
            }}
          />
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 rounded-full bg-brand-50 text-brand-600">
              <svg
                viewBox="0 0 24 24"
                className="h-7 w-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12V4m0 0l-4 4m4-4l4 4" />
              </svg>
            </div>
            <div>
              <div className="font-semibold text-slate-800">
                Drop the ticket CSV here, or click to browse
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Expects columns like{" "}
                <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 font-mono">
                  Date, Partner ID, Issue Type, Create By, Close By, Status
                </span>
              </div>
            </div>
          </div>
        </label>

        {fileName && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <div className="text-slate-700">
              Loaded{" "}
              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                {fileName}
              </span>
              <span className="ml-2 text-emerald-600">
                • {formatNum(tickets?.length ?? 0)} rows
              </span>
            </div>
            <button
              onClick={() => {
                setTickets(null);
                setFileName("");
                setError(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Clear
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            {error}
          </div>
        )}
      </div>

      {!tickets ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500">
          No data yet — upload a CSV to render the dashboard.
        </div>
      ) : (
        <Dashboard tickets={tickets} />
      )}
    </div>
  );
}

// ---- dashboard body -------------------------------------------------------

function Dashboard({ tickets }: { tickets: TicketRow[] }) {
  const stats = useMemo(() => {
    const total = tickets.length;
    const closed = tickets.filter(isClosed).length;
    const merchantTickets = tickets.filter((t) =>
      TICKET_ISSUE_TYPES.includes(t.issueType),
    ).length;

    // Chart 2: created vs closed per support-team member.
    const teamMap = new Map<string, { created: number; closed: number }>();
    const bump = (name: string, key: "created" | "closed") => {
      if (!name) return;
      const e = teamMap.get(name) ?? { created: 0, closed: 0 };
      e[key]++;
      teamMap.set(name, e);
    };
    tickets.forEach((t) => {
      bump(t.createBy, "created");
      if (isClosed(t)) bump(t.closeBy, "closed");
    });
    const team = [...teamMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.created - a.created);
    const closedTotal = team.reduce((s, t) => s + t.closed, 0);

    // Chart 3: count + resolution time per issue type.
    const issueMap = new Map<
      string,
      { count: number; sumDays: number; maxDays: number; resolved: number }
    >();
    tickets.forEach((t) => {
      const e =
        issueMap.get(t.issueType) ?? {
          count: 0,
          sumDays: 0,
          maxDays: 0,
          resolved: 0,
        };
      e.count++;
      if (t.date && t.closeDate) {
        const days = (t.closeDate.getTime() - t.date.getTime()) / 86_400_000;
        if (days >= 0) {
          e.sumDays += days;
          e.resolved++;
          e.maxDays = Math.max(e.maxDays, days);
        }
      }
      issueMap.set(t.issueType, e);
    });
    const byIssue = [...issueMap.entries()]
      .map(([name, v]) => ({
        name,
        count: v.count,
        maxDays: v.maxDays,
        avgDays: v.resolved > 0 ? v.sumDays / v.resolved : 0,
        resolved: v.resolved,
      }))
      .sort((a, b) => b.count - a.count);

    const topMax = [...byIssue]
      .filter((i) => i.resolved > 0)
      .sort((a, b) => b.maxDays - a.maxDays)
      .slice(0, 3);
    const topAvg = [...byIssue]
      .filter((i) => i.resolved > 0)
      .sort((a, b) => b.avgDays - a.avgDays)
      .slice(0, 3);

    // Chart 4: count per partner + each partner's dominant issue type.
    const partnerMap = new Map<
      string,
      { count: number; issues: Map<string, number> }
    >();
    tickets.forEach((t) => {
      const e = partnerMap.get(t.partner) ?? { count: 0, issues: new Map() };
      e.count++;
      e.issues.set(t.issueType, (e.issues.get(t.issueType) ?? 0) + 1);
      partnerMap.set(t.partner, e);
    });
    const byPartner = [...partnerMap.entries()]
      .map(([name, v]) => {
        let topIssue = "—";
        let topIssueCount = 0;
        v.issues.forEach((c, k) => {
          if (c > topIssueCount) {
            topIssueCount = c;
            topIssue = k;
          }
        });
        return { name, count: v.count, topIssue, topIssueCount };
      })
      .sort((a, b) => b.count - a.count);

    return {
      total,
      closed,
      pending: total - closed,
      merchantTickets,
      team,
      closedTotal,
      byIssue,
      topMax,
      topAvg,
      byPartner,
    };
  }, [tickets]);

  const closeRate = stats.total > 0 ? stats.closed / stats.total : 0;

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi accent="bg-brand-600" iconBg="bg-brand-50 text-brand-600" label="Total tickets" value={formatNum(stats.total)} sub={`${stats.byPartner.length} partners · ${stats.byIssue.length} issue types`} icon={ICON_TICKET} />
        <Kpi accent="bg-emerald-500" iconBg="bg-emerald-50 text-emerald-600" label="Closed" value={formatNum(stats.closed)} sub={`${(closeRate * 100).toFixed(1)}% close rate`} icon={ICON_CHECK} />
        <Kpi accent="bg-accent-500" iconBg="bg-accent-50 text-accent-600" label="Pending" value={formatNum(stats.pending)} sub="Awaiting close" icon={ICON_CLOCK} />
        <Kpi accent="bg-slate-700" iconBg="bg-slate-100 text-slate-700" label="Merchant tickets" value={formatNum(stats.merchantTickets)} sub="IP · Debit Note · Case Slip · Webhook" icon={ICON_STORE} />
      </div>

      {/* Chart 1 — All Issue & Created Ticket */}
      <Card
        title="All Issue & Created Ticket"
        right={
          <span className="text-sm font-semibold text-slate-600">
            TOTAL :{" "}
            <span className="text-brand-600">
              {formatNum(stats.total)}
            </span>
          </span>
        }
      >
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart
              data={[
                { name: "All Issue", value: stats.total, fill: COLOR_BRAND },
                { name: "Ticket All Merchant", value: stats.merchantTickets, fill: COLOR_GREEN },
              ]}
              margin={{ top: 48, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" stroke="#64748b" fontSize={13} fontWeight={600} />
              <YAxis stroke="#64748b" fontSize={12} tickFormatter={formatNum} />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                formatter={(v: number) => [formatNum(v), "Tickets"]}
              />
              <Bar dataKey="value" shape={<Bar3D />} maxBarSize={140}>
                <Cell fill={COLOR_BRAND} />
                <Cell fill={COLOR_GREEN} />
                <LabelList
                  dataKey="value"
                  position="top"
                  offset={22}
                  fontSize={22}
                  fontWeight={700}
                  fill="#334155"
                  formatter={(v: number) => formatNum(v)}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center justify-center gap-8 text-sm">
          <LegendDot color={COLOR_BRAND} label="All Issue" value={stats.total} />
          <LegendDot color={COLOR_GREEN} label="Ticket All Merchant" value={stats.merchantTickets} />
        </div>
      </Card>

      {/* Chart 2 — Created vs Closed by support team */}
      <Card title="Created & Closed Issue Case by Support Team">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-4" style={{ width: "100%", height: 460 }}>
            <ResponsiveContainer>
              <LineChart data={stats.team} margin={{ top: 44, right: 48, left: 8, bottom: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={13} fontWeight={600} tickMargin={10} padding={{ left: 40, right: 40 }} />
                <YAxis
                  stroke="#64748b"
                  fontSize={12}
                  tickFormatter={formatNum}
                  domain={[0, (max: number) => Math.ceil((max * 1.18) / 50) * 50]}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                  formatter={(v: number, n) => [formatNum(v), n === "created" ? "Created" : "Closed"]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 13 }}
                  formatter={(v) => (v === "created" ? "Created" : "Closed")}
                />
                <Line type="monotone" dataKey="created" stroke={COLOR_BLUE} strokeWidth={3} dot={{ r: 5 }} activeDot={{ r: 7 }}>
                  <LabelList dataKey="created" position="top" offset={14} fontSize={14} fontWeight={700} fill={COLOR_BLUE} formatter={(v: number) => formatNum(v)} />
                </Line>
                <Line type="monotone" dataKey="closed" stroke={COLOR_BRAND} strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 5 }} activeDot={{ r: 7 }}>
                  <LabelList dataKey="closed" position="bottom" offset={14} fontSize={13} fontWeight={700} fill={COLOR_BRAND} formatter={(v: number) => formatNum(v)} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col justify-center gap-4 border border-slate-200 rounded-lg p-5 bg-slate-50">
            <div>
              <div className="text-sm font-semibold" style={{ color: COLOR_BLUE }}>Created</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">{formatNum(stats.total)}</div>
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: COLOR_BRAND }}>Closed</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">{formatNum(stats.closedTotal)}</div>
            </div>
          </div>
        </div>
      </Card>

      {/* Chart 3 — Issue type of the month */}
      <Card title="Issue Type of the Month">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2" style={{ width: "100%", height: Math.max(280, stats.byIssue.length * 42 + 40) }}>
            <ResponsiveContainer>
              <BarChart data={stats.byIssue} layout="vertical" margin={{ top: 5, right: 56, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" stroke="#64748b" fontSize={12} tickFormatter={formatNum} />
                <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={11} width={170} tick={{ textAnchor: "end" }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                  formatter={(v: number) => [formatNum(v), "Cases"]}
                />
                <Bar dataKey="count" shape={<Bar3D />} maxBarSize={28}>
                  {stats.byIssue.map((_, i) => (
                    <Cell key={i} fill={PARTNER_RAMP[i % PARTNER_RAMP.length]} />
                  ))}
                  <LabelList dataKey="count" position="right" offset={16} fontSize={11} fontWeight={700} fill="#475569" formatter={(v: number) => formatNum(v)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-4">
            <Callout title="Top Issue">
              {stats.byIssue.slice(0, 10).map((it, i) => (
                <li key={it.name} className="flex justify-between gap-2">
                  <span className="text-slate-700">
                    {i + 1}. {it.name}
                  </span>
                  <span className="font-mono font-semibold text-brand-600 whitespace-nowrap">
                    {formatNum(it.count)} เคส
                  </span>
                </li>
              ))}
            </Callout>
          </div>
        </div>
      </Card>

      {/* Chart 4 — Count of ticket by partner */}
      <Card title="Count of Ticket by Partner">
        <div style={{ width: "100%", height: 380 }}>
          <ResponsiveContainer>
            <BarChart data={stats.byPartner} margin={{ top: 44, right: 10, left: 0, bottom: 40 }} barCategoryGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" stroke="#64748b" fontSize={10} interval={0} angle={-45} textAnchor="end" height={70} />
              <YAxis stroke="#64748b" fontSize={12} tickFormatter={formatNum} />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                formatter={(v: number) => [formatNum(v), "Tickets"]}
              />
              <Bar dataKey="count" shape={<Bar3D />}>
                {stats.byPartner.map((_, i) => (
                  <Cell
                    key={i}
                    fill={
                      PARTNER_RAMP[
                        Math.min(
                          PARTNER_RAMP.length - 1,
                          Math.floor(
                            (i / Math.max(stats.byPartner.length - 1, 1)) *
                              PARTNER_RAMP.length,
                          ),
                        )
                      ]
                    }
                  />
                ))}
                <LabelList dataKey="count" position="top" offset={16} fontSize={12} fontWeight={600} fill="#64748b" formatter={(v: number) => formatNum(v)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4">
          <Callout title="Top Issue by Partner">
            {stats.byPartner.slice(0, 3).map((p, i) => (
              <li key={p.name} className="flex justify-between gap-2">
                <span className="text-slate-700">
                  {i + 1}. <span className="font-mono font-medium">{p.name}</span> ={" "}
                  {p.topIssue}
                </span>
                <span className="font-mono font-semibold text-brand-600 whitespace-nowrap">
                  {formatNum(p.topIssueCount)} เคส
                </span>
              </li>
            ))}
          </Callout>
        </div>
      </Card>
    </>
  );
}

// ---- small UI primitives --------------------------------------------------

function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
          <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
      <div className="text-sm font-semibold text-brand-700 mb-2">{title}</div>
      <ol className="space-y-1.5 text-sm">{children}</ol>
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-slate-700">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      <span className="font-mono font-medium tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

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
      {sub && <div className="text-sm text-slate-500 mt-1 truncate">{sub}</div>}
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
const ICON_CHECK = (
  <svg {...svgProps}>
    <path d="M5 13l4 4L19 7" />
  </svg>
);
const ICON_CLOCK = (
  <svg {...svgProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const ICON_STORE = (
  <svg {...svgProps}>
    <path d="M3 7h18l-1.5 12.5a2 2 0 01-2 1.5h-11a2 2 0 01-2-1.5L3 7z" />
    <path d="M8 7V5a4 4 0 018 0v2" />
  </svg>
);
