"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import type { MerchantRow } from "@/lib/top100-types";

// Anypay brand red leads; gold + cool tones support without competing
const COLORS = [
  "#A4262C", "#d4a017", "#475569", "#2563eb", "#0891b2",
  "#059669", "#7c3aed", "#db2777", "#ea580c", "#1e293b",
];

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function TopMerchantsBarChart({ merchants }: { merchants: MerchantRow[] }) {
  const data = merchants.slice(0, 10).map((m) => ({
    name: m.merchantName,
    mid: m.mid,
    partner: m.partner ?? "—",
    amount: m.totalAmount,
  }));

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
        <h3 className="text-lg font-semibold text-slate-800">Top 10 Merchants</h3>
      </div>
      <div style={{ width: "100%", height: 400 }}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tickFormatter={formatNum} stroke="#64748b" fontSize={12} />
            <YAxis
              type="category"
              dataKey="name"
              stroke="#64748b"
              fontSize={11}
              width={140}
              tick={{ textAnchor: "end" }}
            />
            <Tooltip
              formatter={(v: number) => v.toLocaleString()}
              labelFormatter={(label: string) => {
                const row = data.find((d) => d.name === label);
                return `${label} (${row?.mid})`;
              }}
              contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
              {data.map((_, idx) => (
                <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
