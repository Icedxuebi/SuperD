"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

type Row = {
  account_number: string | null;
  name: string | null;
  partner: string | null;
  mid: string | null;
  merchant: string | null;
  website: string | null;
  mcc: string | null;
  business_group: string | null;
  total_amount: number | null;
  transaction_count: number | null;
  average_amount: number | null;
  minimum_amount: number | null;
  maximum_amount: number | null;
  begin_date: string | null;
  end_date: string | null;
};

type SortKey =
  | "partner"
  | "mid"
  | "merchant"
  | "mcc"
  | "business_group"
  | "total_amount"
  | "transaction_count"
  | "average_amount"
  | "minimum_amount"
  | "maximum_amount"
  | "begin_date"
  | "end_date";

type SortDir = "asc" | "desc";

const thbFmt = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numFmt = new Intl.NumberFormat("en-US");

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return thbFmt.format(v);
}

function fmtNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return numFmt.format(v);
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return String(v).slice(0, 10);
}

export default function SpenderHistoryPage() {
  return (
    <Suspense fallback={null}>
      <SpenderHistoryView />
    </Suspense>
  );
}

function SpenderHistoryView() {
  const searchParams = useSearchParams();
  const initialAccount = useMemo(() => {
    const v = searchParams.get("account")?.trim() ?? "";
    return /^[0-9]{4,20}$/.test(v) ? v : "";
  }, [searchParams]);

  const [accountInput, setAccountInput] = useState(initialAccount);
  const [searchedAccount, setSearchedAccount] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("total_amount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  async function lookup(account: string) {
    if (!/^[0-9]{4,20}$/.test(account)) {
      setError("Account number must be 4–20 digits.");
      setRows(null);
      return;
    }
    setLoading(true);
    setError(null);
    setRows(null);
    setName(null);
    setSearchedAccount(account);
    setQ("");
    try {
      const res = await fetch(`/api/spender-history?account=${encodeURIComponent(account)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Query failed (${res.status})`);
      const data = body.rows as Row[];
      setRows(data);
      const firstName = data.find((r) => r.name && r.name.trim().length > 0)?.name ?? null;
      setName(firstName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    if (initialAccount) {
      autoRan.current = true;
      void lookup(initialAccount);
    }
  }, [initialAccount]);

  async function runQuery(e: FormEvent) {
    e.preventDefault();
    const account = accountInput.trim();
    if (!account) return;
    await lookup(account);
  }

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    const list = needle
      ? rows.filter((r) => {
          const hay = [
            r.partner,
            r.mid,
            r.merchant,
            r.website,
            r.mcc,
            r.business_group,
            r.begin_date,
            r.end_date,
          ]
            .filter((v): v is string => typeof v === "string" && v.length > 0)
            .join("  ")
            .toLowerCase();
          return hay.includes(needle);
        })
      : rows.slice();

    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      const av = a[sortBy];
      const bv = b[sortBy];
      if (typeof av === "number" || typeof bv === "number") {
        cmp = Number(av ?? 0) - Number(bv ?? 0);
      } else {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }
      return cmp * dir;
    });
    return list;
  }, [rows, q, sortBy, sortDir]);

  function onSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      const numeric: SortKey[] = [
        "total_amount",
        "transaction_count",
        "average_amount",
        "minimum_amount",
        "maximum_amount",
      ];
      setSortDir(numeric.includes(key) ? "desc" : "asc");
    }
  }

  function arrow(key: SortKey) {
    if (sortBy !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  function exportExcel() {
    if (!searchedAccount || filtered.length === 0) return;
    const sheetData = filtered.map((r) => ({
      "Account Number": r.account_number ?? searchedAccount,
      Name: r.name ?? "",
      Partner: r.partner ?? "",
      MID: r.mid ?? "",
      Merchant: r.merchant ?? "",
      Website: r.website ?? "",
      MCC: r.mcc ?? "",
      "Business Group": r.business_group ?? "",
      "Total Amount": r.total_amount ?? 0,
      Transaction: r.transaction_count ?? 0,
      Average: r.average_amount ?? 0,
      Minimum: r.minimum_amount ?? 0,
      Maximum: r.maximum_amount ?? 0,
      Begin: r.begin_date ? new Date(r.begin_date) : "",
      End: r.end_date ? new Date(r.end_date) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData, {
      header: [
        "Account Number",
        "Name",
        "Partner",
        "MID",
        "Merchant",
        "Website",
        "MCC",
        "Business Group",
        "Total Amount",
        "Transaction",
        "Average",
        "Minimum",
        "Maximum",
        "Begin",
        "End",
      ],
      cellDates: true,
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Spender History");
    XLSX.writeFile(wb, `SpenderHistory${searchedAccount}.xlsx`);
  }

  const total = rows?.length ?? 0;
  const shown = filtered.length;

  const aggregate = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    let tot = 0;
    let txn = 0;
    for (const r of rows) {
      tot += r.total_amount ?? 0;
      txn += r.transaction_count ?? 0;
    }
    return { totalAmount: tot, totalTxns: txn };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Spender History</h1>
        <p className="text-slate-600">
          Look up every Anypay merchant a payer&apos;s bank account has paid (successful payments
          only), aggregated by merchant.
        </p>
      </div>

      <form
        onSubmit={runQuery}
        className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card flex flex-wrap items-end gap-4"
      >
        <label className="flex flex-col gap-1 flex-1 min-w-[260px]">
          <span className="text-xs font-medium text-slate-600">Account number</span>
          <input
            type="text"
            inputMode="numeric"
            value={accountInput}
            onChange={(e) => setAccountInput(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="e.g. 2482513740"
            className="px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors font-mono"
          />
        </label>

        <button
          type="submit"
          disabled={loading || accountInput.trim().length < 4}
          className="px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {loading ? "Looking up…" : "Look up"}
        </button>

        {loading && (
          <div className="ml-auto text-sm text-slate-500 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Querying payment_transaction_response…
          </div>
        )}
      </form>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {rows && searchedAccount && (
        <>
          <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
              <h2 className="text-lg font-semibold text-slate-800">Spender</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-3">
              <Field label="Account Number" value={searchedAccount} mono />
              <Field label="Name" value={name ?? "—"} />
              <Field label="Merchants" value={fmtNumber(total)} mono />
              <Field
                label="Total transactions"
                value={fmtNumber(aggregate?.totalTxns ?? 0)}
                mono
              />
              <Field
                label="Total amount"
                value={fmtMoney(aggregate?.totalAmount ?? 0)}
                mono
                wide
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 flex-1 min-w-[260px]">
              <span className="text-xs font-medium text-slate-600">Search results</span>
              <div className="relative">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter by MID, merchant, partner, MCC, business group…"
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none hover:border-slate-400 transition-colors"
                />
              </div>
            </label>

            <button
              type="button"
              onClick={() => setQ("")}
              disabled={q === ""}
              className="px-4 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
            >
              Clear
            </button>

            <button
              type="button"
              onClick={exportExcel}
              disabled={shown === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors shadow-sm"
              title={
                shown === 0
                  ? "No rows to export"
                  : `Export ${shown.toLocaleString()} row${shown === 1 ? "" : "s"}`
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
              Export Excel
            </button>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
                <h3 className="text-lg font-semibold text-slate-800">
                  Merchants paid
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    {shown.toLocaleString()}
                    {shown !== total ? ` of ${total.toLocaleString()}` : ""}
                  </span>
                </h3>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[640px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-slate-600 border-b border-slate-200">
                    <Th label="Partner" col="partner" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                    <Th label="MID" col="mid" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                    <Th label="Merchant" col="merchant" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                    <Th label="MCC" col="mcc" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                    <Th
                      label="Business Group"
                      col="business_group"
                      sortBy={sortBy}
                      arrow={arrow}
                      onSort={onSort}
                    />
                    <Th
                      label="Total Amount"
                      col="total_amount"
                      sortBy={sortBy}
                      arrow={arrow}
                      onSort={onSort}
                      right
                    />
                    <Th
                      label="Transaction"
                      col="transaction_count"
                      sortBy={sortBy}
                      arrow={arrow}
                      onSort={onSort}
                      right
                    />
                    <Th
                      label="Average"
                      col="average_amount"
                      sortBy={sortBy}
                      arrow={arrow}
                      onSort={onSort}
                      right
                    />
                    <Th
                      label="Minimum"
                      col="minimum_amount"
                      sortBy={sortBy}
                      arrow={arrow}
                      onSort={onSort}
                      right
                    />
                    <Th
                      label="Maximum"
                      col="maximum_amount"
                      sortBy={sortBy}
                      arrow={arrow}
                      onSort={onSort}
                      right
                    />
                    <Th label="Begin" col="begin_date" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                    <Th label="End" col="end_date" sortBy={sortBy} arrow={arrow} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {shown === 0 && (
                    <tr>
                      <td colSpan={12} className="text-center py-12 text-slate-500">
                        {total === 0
                          ? `No successful payments found from account ${searchedAccount}.`
                          : "No rows match this search."}
                      </td>
                    </tr>
                  )}
                  {filtered.map((r, i) => (
                    <tr
                      key={`${r.mid ?? "x"}-${i}`}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                        {r.partner ?? "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                        {r.mid ? (
                          <Link
                            href={`/application-support/merchant-lookup/${r.mid}`}
                            className="text-brand-600 hover:text-brand-700 hover:underline"
                          >
                            {r.mid}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-800">
                        {r.merchant ?? "—"}
                        {r.website ? (
                          <div className="text-xs text-slate-500 truncate" title={r.website}>
                            {r.website}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                        {r.mcc ?? "—"}
                      </td>
                      <td
                        className="px-4 py-2 text-slate-700 max-w-sm break-words"
                        title={r.business_group ?? ""}
                      >
                        {r.business_group ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono whitespace-nowrap">
                        {fmtMoney(r.total_amount)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono whitespace-nowrap">
                        {fmtNumber(r.transaction_count)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono whitespace-nowrap">
                        {fmtMoney(r.average_amount)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono whitespace-nowrap">
                        {fmtMoney(r.minimum_amount)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono whitespace-nowrap">
                        {fmtMoney(r.maximum_amount)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                        {fmtDate(r.begin_date)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                        {fmtDate(r.end_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${wide ? "md:col-span-2" : ""}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-sm text-slate-800 break-words ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function Th({
  label,
  col,
  sortBy,
  arrow,
  onSort,
  right = false,
}: {
  label: string;
  col: SortKey;
  sortBy: SortKey;
  arrow: (k: SortKey) => string;
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-900 whitespace-nowrap ${
        right ? "text-right" : ""
      }`}
      aria-sort={sortBy === col ? "ascending" : "none"}
    >
      {label}
      <span className="text-brand-600">{arrow(col)}</span>
    </th>
  );
}
