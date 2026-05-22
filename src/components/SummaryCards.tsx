"use client";

interface Props {
  totalMerchants: number;
  totalAmount: number;
  topMerchant: string | null;
  topMerchantAmount: number;
  uniquePartners: number;
}

function formatAmount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const ICONS = {
  merchants: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18l-1.5 12.5a2 2 0 01-2 1.5h-11a2 2 0 01-2-1.5L3 7z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a4 4 0 018 0v2" />
    </svg>
  ),
  amount: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v20M17 7H9.5a2.5 2.5 0 000 5h5a2.5 2.5 0 010 5H7" />
    </svg>
  ),
  trophy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8m-4-4v4M6 4h12v4a6 6 0 01-12 0V4z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6h2a2 2 0 010 4h-2M6 6H4a2 2 0 000 4h2" />
    </svg>
  ),
  partners: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M9 11a4 4 0 100-8 4 4 0 000 8zm6 0a4 4 0 100-8 4 4 0 000 8z" />
    </svg>
  ),
};

export default function SummaryCards({
  totalMerchants,
  totalAmount,
  topMerchant,
  topMerchantAmount,
  uniquePartners,
}: Props) {
  const cards = [
    {
      label: "Total Merchants",
      value: totalMerchants.toLocaleString(),
      icon: ICONS.merchants,
      accent: "bg-brand-600",
      iconBg: "bg-brand-50 text-brand-600",
    },
    {
      label: "Total Amount",
      value: formatAmount(totalAmount),
      icon: ICONS.amount,
      accent: "bg-accent-500",
      iconBg: "bg-accent-50 text-accent-600",
    },
    {
      label: "Top Merchant",
      value: topMerchant ?? "—",
      sub: topMerchant ? formatAmount(topMerchantAmount) : "",
      icon: ICONS.trophy,
      accent: "bg-slate-700",
      iconBg: "bg-slate-100 text-slate-700",
    },
    {
      label: "Unique Partners",
      value: uniquePartners.toLocaleString(),
      icon: ICONS.partners,
      accent: "bg-brand-400",
      iconBg: "bg-brand-50 text-brand-600",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="relative bg-white border border-slate-200/80 rounded-xl p-5 shadow-card hover:shadow-cardHover transition-shadow overflow-hidden"
        >
          <span
            className={`absolute left-0 top-0 bottom-0 w-1 ${c.accent}`}
            aria-hidden
          />
          <div className="flex items-start justify-between">
            <div className="text-sm font-medium text-slate-500">{c.label}</div>
            <div className={`p-2 rounded-lg ${c.iconBg}`}>{c.icon}</div>
          </div>
          <div className="mt-3 text-2xl font-bold text-slate-900 truncate">
            {c.value}
          </div>
          {c.sub && <div className="text-sm text-slate-500 mt-1">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
