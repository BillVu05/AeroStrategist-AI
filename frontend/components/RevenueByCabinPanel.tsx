import type { RevenueBreakdown } from "@/lib/types";

interface RevenueByCabinPanelProps {
  destination: string;
  revenue: RevenueBreakdown;
}

const CABIN_LABELS: Record<string, string> = {
  economy: "Y",
  premium_economy: "Y+",
  business: "J",
};

export default function RevenueByCabinPanel({ destination, revenue }: RevenueByCabinPanelProps) {
  const total = revenue.total_revenue_usd;
  const rows = Object.entries(revenue.cabin_breakdown).map(([cabin, data]) => ({
    label: CABIN_LABELS[cabin] ?? cabin,
    pct: total > 0 ? (data.revenue_usd / total) * 100 : 0,
  }));

  return (
    <div className="glass-panel rounded-lg p-4">
      <h5 className="mb-4 flex items-center justify-between font-label text-[10px] uppercase tracking-widest text-primary">
        Revenue by cabin · {destination}
        <span className="material-symbols-outlined text-[16px]">pie_chart</span>
      </h5>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3">
            <div className="w-10 font-label text-[10px] text-on-surface-variant">{row.label}</div>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
              <div className="h-full bg-tertiary" style={{ width: `${row.pct}%` }} />
            </div>
            <div className="w-10 text-right font-label text-[10px] text-primary">{row.pct.toFixed(0)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}
