import type { ProfitabilityRow } from "./RouteProfitabilityTable";

interface RevenueCompositionPanelProps {
  rows: ProfitabilityRow[];
}

const CABIN_LABELS: Record<string, string> = {
  economy: "Economy",
  premium_economy: "Premium Economy",
  business: "Business / First",
};

const SEGMENT_CLASSES: Record<string, string> = {
  economy: "bg-tertiary",
  premium_economy: "bg-secondary",
  business: "bg-accent-blue",
  ancillary: "bg-on-surface-variant/40",
};

function fmtUsd(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`;
  return `$${abs.toFixed(0)}`;
}

export default function RevenueCompositionPanel({ rows }: RevenueCompositionPanelProps) {
  const totals: Record<string, number> = { economy: 0, premium_economy: 0, business: 0, ancillary: 0 };

  for (const { whatIf } of rows) {
    const revenue = whatIf.baseline.revenue;
    for (const [cabin, data] of Object.entries(revenue.cabin_breakdown)) {
      totals[cabin] = (totals[cabin] ?? 0) + data.revenue_usd;
    }
    totals.ancillary += revenue.ancillary_revenue_usd;
  }

  const grandTotal = Object.values(totals).reduce((sum, v) => sum + v, 0);
  const segments = Object.entries(totals).map(([key, value]) => ({
    key,
    label: CABIN_LABELS[key] ?? "Ancillary",
    value,
    pct: grandTotal > 0 ? (value / grandTotal) * 100 : 0,
  }));

  return (
    <div className="glass-panel rounded-lg p-4">
      <h5 className="mb-4 flex items-center justify-between font-label text-[10px] uppercase tracking-widest text-primary">
        Revenue composition · network
        <span className="material-symbols-outlined text-[16px]">donut_large</span>
      </h5>

      <div className="mb-4 flex h-3 w-full overflow-hidden rounded-full bg-white/5">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={SEGMENT_CLASSES[seg.key]}
            style={{ width: `${seg.pct}%` }}
            title={`${seg.label}: ${fmtUsd(seg.value)} (${seg.pct.toFixed(0)}%)`}
          />
        ))}
      </div>

      <div className="space-y-2">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${SEGMENT_CLASSES[seg.key]}`} />
              <span className="text-on-surface-variant">{seg.label}</span>
            </div>
            <div className="font-label text-xs text-on-surface">
              {fmtUsd(seg.value)} <span className="text-on-surface-variant">({seg.pct.toFixed(0)}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
