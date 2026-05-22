"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface PartnerSlice {
  partner: string;
  amount: number;
}

const COLORS = [
  "#A4262C", "#d4a017", "#475569", "#2563eb", "#0891b2",
  "#059669", "#7c3aed", "#db2777", "#ea580c", "#1e293b",
  "#94a3b8", "#c03d44",
];

export default function PartnerPieChart({ partners }: { partners: PartnerSlice[] }) {
  const data = partners.slice(0, 12);
  const total = data.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-block w-1 h-5 rounded-full bg-accent-500" />
        <h3 className="text-lg font-semibold text-slate-800">Partner Breakdown</h3>
      </div>
      <div style={{ width: "100%", height: 400 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="partner"
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={120}
              paddingAngle={2}
            >
              {data.map((_, idx) => (
                <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number, name: string) => [
                `${v.toLocaleString()} (${((v / total) * 100).toFixed(1)}%)`,
                name,
              ]}
              contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
