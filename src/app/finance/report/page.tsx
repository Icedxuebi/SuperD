"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

// Finance settlement report. Data is pulled live from the read replica via
// /api/finance/report?date=YYYY-MM-DD (payment settle_due + transfer
// transfer_date for the chosen day). Bank cost, agency commission, total cost
// and gross profit are all computed server-side using the exact formulas from
// the finance Power BI model (bank cost = a per-transaction acquirer fee keyed
// on the gateway channel — see the API route).

type FlowTotals = { txn: number; gross: number; fee: number; net: number };
type PartnerOut = {
  partner_no: string;
  group: string;
  txn: number;
  gross: number;
  fee: number;
  net: number;
};
type ReportResponse = {
  date: string;
  payment: FlowTotals;
  transfer: FlowTotals;
  summary: FlowTotals;
  agencyCommission: number;
  anypayShare: number;
  bankCost: number;
  totalCost: number;
  grossProfit: number;
  byPartner: PartnerOut[];
  byGroup: { group: string; txn: number; net: number }[];
  cached: boolean;
  elapsedMs: number;
};

// ---- formatters -----------------------------------------------------------

const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) =>
  Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—";

function bangkokYesterday(): string {
  const bkk = new Date(Date.now() + 7 * 3_600_000);
  bkk.setUTCDate(bkk.getUTCDate() - 1);
  return bkk.toISOString().slice(0, 10);
}

function prettyDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ===========================================================================

export default function FinanceReportPage() {
  const [date, setDate] = useState<string>("");
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // init date on mount (avoids SSR/CSR hydration drift)
  useEffect(() => {
    setDate(bangkokYesterday());
  }, []);

  const load = useCallback((d: string, refresh: boolean) => {
    if (!d) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ date: d });
    if (refresh) qs.set("refresh", "1");
    fetch(`/api/finance/report?${qs.toString()}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Query failed (${res.status})`);
        return body as ReportResponse;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (date) load(date, false);
  }, [date, load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">Finance Report</h1>
          <p className="text-slate-600">
            Daily settlement summary — payment{" "}
            <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              settle_due
            </span>{" "}
            + transfer{" "}
            <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              transfer_date
            </span>{" "}
            for the selected day, pulled live from the database.
          </p>
        </div>
        <Controls
          date={date}
          onDate={setDate}
          onRefresh={() => load(date, true)}
          onExport={data ? () => exportExcel(data) : undefined}
          loading={loading}
        />
      </div>

      {loading && (
        <div className="bg-white border border-slate-200/80 rounded-xl p-12 text-center text-slate-500 shadow-card">
          <div className="inline-flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Crunching {prettyDate(date)} from the read replica… first load of a
            day can take ~10–15s.
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {data && !loading && !error && <Report data={data} />}
    </div>
  );
}

// ===========================================================================
// Controls
// ===========================================================================

function Controls({
  date,
  onDate,
  onRefresh,
  onExport,
  loading,
}: {
  date: string;
  onDate: (d: string) => void;
  onRefresh: () => void;
  onExport?: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Settlement day</span>
        <input
          type="date"
          value={date}
          max={bangkokYesterday()}
          onChange={(e) => onDate(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
        />
      </label>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading || !date}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Re-run the query, bypassing cache"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M23 4v6h-6" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        Refresh
      </button>
      <button
        type="button"
        onClick={onExport}
        disabled={!onExport}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
        Export Excel
      </button>
    </div>
  );
}

// ===========================================================================
// Report body
// ===========================================================================

function Report({ data }: { data: ReportResponse }) {
  const { summary, payment, transfer, agencyCommission, bankCost, totalCost, grossProfit } = data;
  const revenue = summary.fee;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-lg font-semibold text-slate-900">
          {prettyDate(data.date)}
        </span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-600">
          <span className="font-mono font-medium text-slate-800">
            {fmtInt(payment.txn)}
          </span>{" "}
          payment +{" "}
          <span className="font-mono font-medium text-slate-800">
            {fmtInt(transfer.txn)}
          </span>{" "}
          transfer
        </span>
        {data.cached && (
          <span className="text-[11px] uppercase tracking-wide text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">
            cached
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <MetricPanel title="Transaction Summary" accent="bg-brand-600">
          <Metric emphasis label="Accumulated transaction numbers" sub="จำนวนรายการ" value={fmtInt(summary.txn)} />
          <Metric label="Accumulated gross paid amount" value={fmtMoney(summary.gross)} />
          <Metric emphasis label="Accumulated transaction value (net)" value={fmtMoney(summary.net)} />
          <Metric label="Accumulated fee amount" sub="รายได้" value={fmtMoney(summary.fee)} />
          <Metric emphasis label="Fee vs transaction value (net)" value={fmtPct(summary.net ? summary.fee / summary.net : NaN)} />
        </MetricPanel>

        <MetricPanel title="Cost" accent="bg-slate-800" note="Bank cost = per-transaction acquirer fee by gateway channel.">
          <Metric label="Transaction numbers" sub="จำนวนรายการ" value={fmtInt(summary.txn)} />
          <Metric emphasis label="Cost to pay bank" sub="ต้นทุนเพื่อจ่ายธนาคาร" value={fmtMoney(bankCost)} />
          <Metric label="Agency commission cost" sub="ต้นทุนเพื่อจ่ายค่าคอมเอเจนซี่" value={fmtMoney(agencyCommission)} />
          <Metric emphasis label="Total cost" sub="ต้นทุนรวม" value={fmtMoney(totalCost)} />
        </MetricPanel>

        <MetricPanel title="Profit" accent="bg-accent-500">
          <Metric emphasis label="Transaction value" sub="ยอดธุรกรรม" value={fmtMoney(summary.gross)} />
          <Metric label="Revenue" sub="รายได้" value={fmtMoney(revenue)} />
          <Metric emphasis label="Gross profit" sub="กำไรขั้นต้น" value={fmtMoney(grossProfit)} />
          <Metric label="Profit vs revenue" sub="กำไรเทียบรายได้" value={fmtPct(revenue ? grossProfit / revenue : NaN)} />
        </MetricPanel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <AgencyCodeTable rows={data.byPartner} />
        <AgencyGroupTable rows={data.byGroup} totalTxn={summary.txn} totalNet={summary.net} />
      </div>
    </>
  );
}

// ---- metric panel ---------------------------------------------------------

function MetricPanel({
  title,
  accent,
  note,
  children,
}: {
  title: string;
  accent: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <span className={`inline-block w-1 h-5 rounded-full ${accent}`} />
        <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
      {note && <p className="mt-3 text-xs text-slate-400 italic">{note}</p>}
    </div>
  );
}

function Metric({
  label,
  sub,
  value,
  emphasis,
}: {
  label: string;
  sub?: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className={`text-sm ${emphasis ? "font-semibold text-slate-800" : "text-slate-600"}`}>
          {label}
        </div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
      </div>
      <div
        className={`font-mono tabular-nums text-right whitespace-nowrap ${
          emphasis ? "text-xl font-bold text-brand-700" : "text-lg text-slate-800"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// ---- tables ---------------------------------------------------------------

function AgencyCodeTable({ rows }: { rows: PartnerOut[] }) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
      <div className="flex items-center gap-2 p-5 border-b border-slate-200">
        <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
        <h3 className="text-lg font-semibold text-slate-800">
          By Agency Code
          <span className="text-sm font-normal text-slate-500 ml-2">
            {rows.length} partner{rows.length === 1 ? "" : "s"}
          </span>
        </h3>
      </div>
      <div className="overflow-x-auto max-h-[560px]">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr className="text-left text-slate-600 border-b border-slate-200">
              <th className="px-4 py-2.5 font-semibold">Partner</th>
              <th className="px-4 py-2.5 font-semibold">Group</th>
              <th className="px-4 py-2.5 font-semibold text-right">TXN</th>
              <th className="px-4 py-2.5 font-semibold text-right">Amount (net)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.partner_no} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs font-medium text-slate-800 whitespace-nowrap">
                  {r.partner_no}
                </td>
                <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{r.group}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-700">
                  {fmtInt(r.txn)}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900 font-medium">
                  {fmtMoney(r.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgencyGroupTable({
  rows,
  totalTxn,
  totalNet,
}: {
  rows: { group: string; txn: number; net: number }[];
  totalTxn: number;
  totalNet: number;
}) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
      <div className="flex items-center gap-2 p-5 border-b border-slate-200">
        <span className="inline-block w-1 h-5 rounded-full bg-accent-500" />
        <h3 className="text-lg font-semibold text-slate-800">
          By Agency Group
          <span className="text-sm font-normal text-slate-500 ml-2">
            {rows.length} group{rows.length === 1 ? "" : "s"}
          </span>
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-slate-600 border-b border-slate-200">
              <th className="px-4 py-2.5 font-semibold">Group</th>
              <th className="px-4 py-2.5 font-semibold text-right">TXN</th>
              <th className="px-4 py-2.5 font-semibold text-right">Amount (net)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.group} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 font-medium text-slate-800 whitespace-nowrap">{r.group}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-700">
                  {fmtInt(r.txn)}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900 font-medium">
                  {fmtMoney(r.net)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-300 font-semibold text-slate-900">
              <td className="px-4 py-2.5">Total</td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmtInt(totalTxn)}</td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmtMoney(totalNet)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---- Excel export ---------------------------------------------------------

function exportExcel(data: ReportResponse) {
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["Finance Report", data.date],
    [],
    ["Transaction Summary"],
    ["Accumulated transaction numbers", data.summary.txn],
    ["Accumulated gross paid amount", data.summary.gross],
    ["Accumulated transaction value (net)", data.summary.net],
    ["Accumulated fee amount", data.summary.fee],
    ["Fee vs transaction value (net)", data.summary.net ? data.summary.fee / data.summary.net : 0],
    [],
    ["Cost"],
    ["Transaction numbers", data.summary.txn],
    ["Cost to pay bank", data.bankCost],
    ["Agency commission cost", data.agencyCommission],
    ["Total cost", data.totalCost],
    [],
    ["Profit"],
    ["Transaction value (gross)", data.summary.gross],
    ["Revenue (fee)", data.summary.fee],
    ["Gross profit", data.grossProfit],
    ["Profit vs revenue", data.summary.fee ? data.grossProfit / data.summary.fee : 0],
    [],
    ["Breakdown", "Payment", "Transfer"],
    ["TXN", data.payment.txn, data.transfer.txn],
    ["Gross", data.payment.gross, data.transfer.gross],
    ["Net", data.payment.net, data.transfer.net],
  ]);

  const codeSheet = XLSX.utils.json_to_sheet(
    data.byPartner.map((r) => ({
      Partner: r.partner_no,
      Group: r.group,
      TXN: r.txn,
      "Amount (net)": r.net,
    })),
  );
  const groupSheet = XLSX.utils.json_to_sheet([
    ...data.byGroup.map((r) => ({ Group: r.group, TXN: r.txn, "Amount (net)": r.net })),
    {
      Group: "Total",
      TXN: data.summary.txn,
      "Amount (net)": data.summary.net,
    },
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(wb, codeSheet, "By Agency Code");
  XLSX.utils.book_append_sheet(wb, groupSheet, "By Agency Group");
  XLSX.writeFile(wb, `finance-report-${data.date}.xlsx`);
}
