"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Row = {
  "Order ID": string | null;
  "MID": string | null;
  "Merchant Name": string | null;
  "BillerID": string | null;
  "Transaction Date": string | null;
  "Ref1": string | null;
  "Ref2": string | null;
  "Type": "Payment" | "Withdraw";
  "Amount": string | number | null;
  "Bank Account Number": string | null;
  "Bank Account Name": string | null;
  "Bank Code": string | null;
  "Bank Name": string | null;
};

const COLUMNS: { key: keyof Row; label: string; numeric?: boolean; mono?: boolean }[] = [
  { key: "Order ID", label: "Order ID", mono: true },
  { key: "MID", label: "MID", mono: true },
  { key: "Merchant Name", label: "Merchant Name" },
  { key: "BillerID", label: "BillerID", mono: true },
  { key: "Transaction Date", label: "Transaction Date", mono: true },
  { key: "Ref1", label: "Ref1", mono: true },
  { key: "Ref2", label: "Ref2", mono: true },
  { key: "Type", label: "Type" },
  { key: "Amount", label: "Amount", numeric: true },
  { key: "Bank Account Number", label: "Bank Account Number", mono: true },
  { key: "Bank Account Name", label: "Bank Account Name" },
  { key: "Bank Code", label: "Bank Code", mono: true },
  { key: "Bank Name", label: "Bank Name" },
];

function formatTHB(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num as number);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return String(value).replace("T", " ").replace("Z", "").slice(0, 19);
}

export default function PoliceCasePage() {
  const [mid, setMid] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [previewLimit, setPreviewLimit] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => {
    if (!rows) return 0;
    return rows.reduce((acc, r) => {
      const n = typeof r.Amount === "string" ? Number(r.Amount) : r.Amount;
      return acc + (Number.isFinite(n) ? (n as number) : 0);
    }, 0);
  }, [rows]);

  // Cap what we render to the DOM — the full set still lives in `rows`
  // and gets used for Excel export.
  const displayedRows = useMemo(
    () => (rows ? rows.slice(0, previewLimit) : null),
    [rows, previewLimit],
  );
  const previewCapped = !!rows && rows.length > previewLimit;

  async function runQuery(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const res = await fetch("/api/police-case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mid, dateFrom, dateTo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Query failed (${res.status})`);
      setRows(data.rows as Row[]);
      setPreviewLimit(typeof data.previewLimit === "number" ? data.previewLimit : 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function exportExcel() {
    if (!rows || rows.length === 0) return;
    const sheetData = rows.map((r) => ({
      ...r,
      Amount: typeof r.Amount === "string" ? Number(r.Amount) : r.Amount,
      "Transaction Date": formatDate(r["Transaction Date"]),
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData, {
      header: COLUMNS.map((c) => c.key),
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Police Case");
    XLSX.writeFile(wb, `PoliceCase${mid}.xlsx`);
  }

  const resultsReady = rows !== null && !loading;
  const hasResults = resultsReady && (rows?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Police Case Query</h1>
        <p className="text-slate-600">
          Look up payment and withdrawal transactions for a single merchant within a date range, then
          export the result for law-enforcement requests.
        </p>
      </div>

      <form
        onSubmit={runQuery}
        className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card flex flex-wrap items-end gap-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">MID (merchant_no)</span>
          <input
            type="text"
            required
            value={mid}
            onChange={(e) => setMid(e.target.value.trim().toUpperCase())}
            placeholder="M250701022505"
            pattern="[A-Z][A-Z0-9]{2,30}"
            title="Merchant number, e.g. M250701022505"
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors w-56 font-mono"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">From</span>
          <input
            type="datetime-local"
            required
            step="1"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">To</span>
          <input
            type="datetime-local"
            required
            step="1"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {loading ? "Running…" : "Search"}
        </button>

        <button
          type="button"
          onClick={exportExcel}
          disabled={!hasResults}
          className="px-4 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5"
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
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          Export to Excel
        </button>

        {hasResults && (
          <div className="ml-auto text-sm text-slate-500 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            {rows!.length.toLocaleString()} {rows!.length === 1 ? "row" : "rows"} · total{" "}
            <span className="font-mono font-medium text-slate-700">{formatTHB(total)}</span> THB
          </div>
        )}
      </form>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && <div className="text-center py-12 text-slate-500">Loading…</div>}

      {resultsReady && (
        <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
              <h3 className="text-lg font-semibold text-slate-800">
                Results
                <span className="text-sm font-normal text-slate-500 ml-2">
                  {previewCapped ? (
                    <>
                      Showing first{" "}
                      <span className="text-slate-700 font-medium">
                        {previewLimit.toLocaleString()}
                      </span>{" "}
                      of{" "}
                      <span className="text-slate-700 font-medium">
                        {rows!.length.toLocaleString()}
                      </span>{" "}
                      rows
                      <span className="text-amber-700"> · export to Excel for the full set</span>
                    </>
                  ) : (
                    <>
                      {rows!.length.toLocaleString()} {rows!.length === 1 ? "row" : "rows"}
                    </>
                  )}
                </span>
              </h3>
            </div>
          </div>

          {!hasResults ? (
            <div className="p-8 text-center text-slate-500">
              No transactions found for this merchant and date range.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-slate-600 border-b border-slate-200">
                    {COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        className={`px-4 py-2.5 font-semibold whitespace-nowrap ${
                          c.numeric ? "text-right" : ""
                        }`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayedRows!.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      {COLUMNS.map((c) => {
                        if (c.key === "Amount") {
                          return (
                            <td
                              key={c.key}
                              className="px-4 py-2 text-right font-mono font-medium tabular-nums whitespace-nowrap"
                            >
                              {formatTHB(r.Amount)}
                            </td>
                          );
                        }
                        if (c.key === "Type") {
                          const isPayment = r.Type === "Payment";
                          return (
                            <td key={c.key} className="px-4 py-2 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                                  isPayment
                                    ? "bg-brand-50 text-brand-700"
                                    : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                {r.Type}
                              </span>
                            </td>
                          );
                        }
                        if (c.key === "Transaction Date") {
                          return (
                            <td
                              key={c.key}
                              className="px-4 py-2 font-mono text-xs whitespace-nowrap"
                            >
                              {formatDate(r["Transaction Date"])}
                            </td>
                          );
                        }
                        const raw = r[c.key];
                        const display = raw === null || raw === "" || raw === undefined ? "—" : String(raw);
                        return (
                          <td
                            key={c.key}
                            className={`px-4 py-2 ${
                              c.mono ? "font-mono text-xs" : "text-slate-800"
                            } whitespace-nowrap`}
                          >
                            {display}
                          </td>
                        );
                      })}
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
