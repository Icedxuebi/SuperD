"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Row = {
  "Order ID": string | null;
  "Create By": string | null;
  "Create Date": string | null;
  "Ref1": string | null;
  "Ref2": string | null;
  "Amount": string | number | null;
  "Transfer Status": string | null;
  "Transfer Date": string | null;
  "MID": string | null;
  "Merchant Name": string | null;
};

type ApiResponse = {
  rows: Row[];
  count: number;
  capped: boolean;
  rowLimit: number;
  submittedRef1: number;
  submittedRef2: number;
};

type SortKey =
  | "Order ID"
  | "Create By"
  | "Create Date"
  | "Ref1"
  | "Ref2"
  | "Amount"
  | "Transfer Status"
  | "Transfer Date"
  | "MID"
  | "Merchant Name";

type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean; mono?: boolean }[] = [
  { key: "Order ID", label: "Order ID", mono: true },
  { key: "Create By", label: "Create By" },
  { key: "Create Date", label: "Create Date", mono: true },
  { key: "MID", label: "MID", mono: true },
  { key: "Merchant Name", label: "Merchant" },
  { key: "Ref1", label: "Ref 1", mono: true },
  { key: "Ref2", label: "Ref 2", mono: true },
  { key: "Amount", label: "Amount", numeric: true },
  { key: "Transfer Status", label: "Status" },
  { key: "Transfer Date", label: "Transfer Date", mono: true },
];

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  return String(value).replace("T", " ").replace("Z", "").slice(0, 19);
}

function fmtTHB(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n as number);
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const s = status.toUpperCase();
  const map: Record<string, { bg: string; label: string }> = {
    S: { bg: "bg-emerald-100 text-emerald-700", label: "Success" },
    E: { bg: "bg-red-100 text-red-700", label: "Failed" },
    F: { bg: "bg-red-100 text-red-700", label: "Failed" },
    P: { bg: "bg-amber-100 text-amber-700", label: "Pending" },
  };
  const m = map[s] ?? { bg: "bg-slate-100 text-slate-700", label: s };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${m.bg}`}
    >
      <span className="font-mono text-[10px] opacity-70">{s}</span>
      {m.label}
    </span>
  );
}

export default function TransferStatusPage() {
  const [ref1, setRef1] = useState("");
  const [ref2, setRef2] = useState("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("Transfer Date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("");

  const ref1Count = useMemo(
    () => ref1.split(/\r?\n/).filter((s) => s.trim().replace(/^"+|"+$/g, "").trim().length > 0).length,
    [ref1],
  );
  const ref2Count = useMemo(
    () => ref2.split(/\r?\n/).filter((s) => s.trim().replace(/^"+|"+$/g, "").trim().length > 0).length,
    [ref2],
  );

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (ref1Count === 0 && ref2Count === 0) {
      setError("Paste at least one Ref1 or Ref2 value.");
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/transfer-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref1, ref2 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Query failed (${res.status})`);
      setData(body as ApiResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function clearAll() {
    setRef1("");
    setRef2("");
    setData(null);
    setError(null);
    setFilter("");
  }

  // Export pulls a fresh SELECT * (all columns) from the API rather than the
  // curated columns shown in the table.
  async function exportExcel() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/transfer-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref1, ref2, full: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Export failed (${res.status})`);
      const rows = (body.rows ?? []) as Record<string, unknown>[];
      if (rows.length === 0) {
        setError("No rows to export.");
        return;
      }
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Transfer Status");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      XLSX.writeFile(wb, `TransferStatus_${stamp}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function onSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "Amount" || k === "Transfer Date" || k === "Create Date" ? "desc" : "asc");
    }
  }
  function arrow(k: SortKey) {
    if (sortKey !== k) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  const filteredSorted = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    const q = filter.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(q)),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (sortKey === "Amount") {
        return dir * (Number(va) - Number(vb));
      }
      return dir * String(va).localeCompare(String(vb));
    });
  }, [data, sortKey, sortDir, filter]);

  const summary = useMemo(() => {
    if (!data) return null;
    let s = 0;
    let f = 0;
    let other = 0;
    let amount = 0;
    for (const r of data.rows) {
      const st = (r["Transfer Status"] ?? "").toString().toUpperCase();
      if (st === "S") s += 1;
      else if (st === "E" || st === "F") f += 1;
      else other += 1;
      const n = typeof r.Amount === "string" ? Number(r.Amount) : r.Amount;
      if (Number.isFinite(n)) amount += n as number;
    }
    return { s, f, other, amount };
  }, [data]);

  const hasResults = data && data.rows.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Transfer Status</h1>
        <p className="text-slate-600">
          Check withdrawal / payout transfer status
        </p>
      </div>

      <form
        onSubmit={runSearch}
        className="bg-white border border-slate-200/80 rounded-xl p-6 shadow-card space-y-4"
      >
        <div className="flex items-center gap-2">
          <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
          <h2 className="text-lg font-semibold text-slate-800">References</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600 flex items-center justify-between">
              <span>
                Ref 1 — <code className="text-xs text-slate-500">merchant_invoice</code>
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {ref1Count.toLocaleString()} {ref1Count === 1 ? "line" : "lines"}
              </span>
            </span>
            <textarea
              value={ref1}
              onChange={(e) => setRef1(e.target.value)}
              rows={6}
              placeholder="One value per line…"
              className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors resize-y"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600 flex items-center justify-between">
              <span>
                Ref 2 — <code className="text-xs text-slate-500">merchant_reference_no</code>
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {ref2Count.toLocaleString()} {ref2Count === 1 ? "line" : "lines"}
              </span>
            </span>
            <textarea
              value={ref2}
              onChange={(e) => setRef2(e.target.value)}
              rows={6}
              placeholder="One value per line…"
              className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors resize-y"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading || (ref1Count === 0 && ref2Count === 0)}
            className="px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {loading ? "Checking…" : "Check status"}
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={ref1 === "" && ref2 === "" && !data}
            className="px-4 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
          >
            Clear
          </button>

          {summary && (
            <div className="ml-auto text-sm text-slate-500 flex items-center gap-3 flex-wrap">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
              <span>
                {data!.rows.length.toLocaleString()}{" "}
                {data!.rows.length === 1 ? "match" : "matches"}
              </span>
              <span className="text-slate-300">·</span>
              <span>
                <span className="font-mono font-medium text-emerald-700">{summary.s}</span> success
              </span>
              <span>
                <span className="font-mono font-medium text-red-700">{summary.f}</span> failed
              </span>
              {summary.other > 0 && (
                <span>
                  <span className="font-mono font-medium text-slate-700">{summary.other}</span>{" "}
                  other
                </span>
              )}
              <span className="text-slate-300">·</span>
              <span>
                total{" "}
                <span className="font-mono font-medium text-slate-700">
                  {fmtTHB(summary.amount)}
                </span>{" "}
                THB
              </span>
            </div>
          )}
        </div>
      </form>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && <div className="text-center py-12 text-slate-500">Loading…</div>}

      {data && !loading && (
        <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-slate-200 gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
              <h3 className="text-lg font-semibold text-slate-800">
                Results
                <span className="text-sm font-normal text-slate-500 ml-2">
                  {data.count.toLocaleString()} {data.count === 1 ? "row" : "rows"}
                  {data.capped && (
                    <span className="text-amber-700">
                      {" "}
                      · capped at {data.rowLimit.toLocaleString()} — narrow the refs to see more
                    </span>
                  )}
                </span>
              </h3>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="search"
                placeholder="Search…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-md text-sm w-64 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
              <button
                type="button"
                onClick={exportExcel}
                disabled={exporting || !hasResults}
                className="px-4 py-1.5 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm whitespace-nowrap inline-flex items-center gap-1.5"
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
                {exporting ? "Exporting…" : "Export to Excel"}
              </button>
            </div>
          </div>

          {!hasResults ? (
            <div className="p-8 text-center text-slate-500">
              No matching transactions found.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[640px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-slate-600 border-b border-slate-200">
                    {COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        onClick={() => onSort(c.key)}
                        className={`px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap ${
                          c.numeric ? "text-right" : ""
                        }`}
                      >
                        {c.label}
                        <span className="text-brand-600">{arrow(c.key)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSorted.map((r, i) => (
                    <tr
                      key={`${r["Order ID"] ?? i}-${i}`}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-2 font-mono text-xs text-slate-800 whitespace-nowrap">
                        {r["Order ID"] ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{r["Create By"] ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                        {fmtDate(r["Create Date"])}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                        {r["MID"] ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-slate-800">{r["Merchant Name"] ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r["Ref1"] ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r["Ref2"] ?? "—"}</td>
                      <td className="px-4 py-2 text-right font-mono font-medium tabular-nums whitespace-nowrap">
                        {fmtTHB(r["Amount"])}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <StatusPill status={r["Transfer Status"]} />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                        {fmtDate(r["Transfer Date"])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
