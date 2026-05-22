"use client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";

const COLORS = ["#A4262C", "#d4a017", "#475569", "#2563eb", "#0891b2"];

interface Props {
  trend: Array<Record<string, string | number>>;
  top5Names: string[];
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function TrendLineChart({ trend, top5Names }: Props) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-block w-1 h-5 rounded-full bg-slate-700" />
        <h3 className="text-lg font-semibold text-slate-800">Top 5 Merchants Over Time</h3>
      </div>
      <div style={{ width: "100%", height: 400 }}>
        <ResponsiveContainer>
          <LineChart data={trend} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
            <YAxis tickFormatter={formatNum} stroke="#64748b" fontSize={12} />
            <Tooltip
              formatter={(v: number) => v.toLocaleString()}
              contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {top5Names.map((name, idx) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={COLORS[idx % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
