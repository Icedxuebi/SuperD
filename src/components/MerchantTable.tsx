"use client";

import { useMemo, useState } from "react";
import type { MerchantRow } from "@/lib/top100-types";

type SortKey = "rank" | "mid" | "merchantName" | "partner" | "totalAmount";
type SortDir = "asc" | "desc";

export default function MerchantTable({ merchants }: { merchants: MerchantRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");

  const ranked = useMemo(
    () => merchants.map((m, i) => ({ ...m, rank: i + 1 })),
    [merchants]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return ranked;
    return ranked.filter(
      (m) =>
        m.merchantName.toLowerCase().includes(term) ||
        m.mid.toLowerCase().includes(term) ||
        (m.partner ?? "").toLowerCase().includes(term)
    );
  }, [ranked, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "rank":         cmp = a.rank - b.rank; break;
        case "mid":          cmp = a.mid.localeCompare(b.mid); break;
        case "merchantName": cmp = a.merchantName.localeCompare(b.merchantName); break;
        case "partner":      cmp = (a.partner ?? "").localeCompare(b.partner ?? ""); break;
        case "totalAmount":  cmp = a.totalAmount - b.totalAmount; break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "totalAmount" ? "desc" : "asc");
    }
  }

  function arrow(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl shadow-card overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
          <h3 className="text-lg font-semibold text-slate-800">All Merchants</h3>
        </div>
        <input
          type="search"
          placeholder="Search merchant, MID, or partner..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-md text-sm w-64 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
        />
      </div>
      <div className="overflow-x-auto max-h-[600px]">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0">
            <tr className="text-left text-slate-600 border-b border-slate-200">
              <Th onClick={() => toggleSort("rank")}>#{arrow("rank")}</Th>
              <Th onClick={() => toggleSort("mid")}>MID{arrow("mid")}</Th>
              <Th onClick={() => toggleSort("merchantName")}>Merchant{arrow("merchantName")}</Th>
              <Th onClick={() => toggleSort("partner")}>Partner{arrow("partner")}</Th>
              <Th>Website</Th>
              <Th onClick={() => toggleSort("totalAmount")} className="text-right">
                Total Amount{arrow("totalAmount")}
              </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr key={m.mid} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-500">{m.rank}</td>
                <td className="px-4 py-2 font-mono text-xs">{m.mid}</td>
                <td className="px-4 py-2 font-medium text-slate-800">{m.merchantName}</td>
                <td className="px-4 py-2 text-slate-600">{m.partner ?? "—"}</td>
                <td className="px-4 py-2">
                  {m.website ? (
                    <a
                      href={m.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 hover:text-brand-700 hover:underline text-xs"
                    >
                      {m.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono font-medium">
                  {m.totalAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No merchants match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-2.5 font-semibold ${onClick ? "cursor-pointer select-none hover:text-slate-900" : ""} ${className}`}
    >
      {children}
    </th>
  );
}
