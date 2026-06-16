import type { MarketContext } from "@/lib/types";

interface DemandDriversPanelProps {
  market: MarketContext;
}

export default function DemandDriversPanel({ market }: DemandDriversPanelProps) {
  const avgCompetitorRating =
    market.competitors.length > 0
      ? market.competitors.reduce((sum, c) => sum + c.rating, 0) / market.competitors.length
      : null;

  const competitorImpact = market.competitors.length === 0 ? 5 : -market.competitors.length * 1.8;
  const tourismImpact = Math.min(15, (market.tourism_arrivals_baseline / 1e6) * 1.2);
  const fxVolatility = -(Math.abs(market.gdp_growth_pct - 3) * 0.8);

  const drivers = [
    {
      icon: "luggage",
      label: "Tourism Synergy",
      value: `+${tourismImpact.toFixed(1)}%`,
      valueClass: "text-tertiary",
      bg: "bg-tertiary/5 border-tertiary/10",
    },
    {
      icon: "trending_up",
      label: "GDP Outlook",
      value: `${market.gdp_growth_pct >= 0 ? "+" : ""}${market.gdp_growth_pct.toFixed(1)}%`,
      valueClass: market.gdp_growth_pct >= 0 ? "text-tertiary" : "text-error",
      bg: market.gdp_growth_pct >= 0 ? "bg-tertiary/5 border-tertiary/10" : "bg-error/5 border-error/10",
    },
    {
      icon: "groups",
      label: "Population",
      value: `+${((market.population / 1e6) * 0.05).toFixed(1)}%`,
      valueClass: "text-tertiary",
      bg: "bg-tertiary/5 border-tertiary/10",
    },
    {
      icon: "currency_exchange",
      label: "FX Volatility",
      value: `${fxVolatility.toFixed(1)}%`,
      valueClass: Number(fxVolatility) < 0 ? "text-error" : "text-tertiary",
      bg: Number(fxVolatility) < 0 ? "bg-error/5 border-error/10" : "bg-tertiary/5 border-tertiary/10",
    },
    {
      icon: "event",
      label: "Major Events",
      value: "+15.0%",
      valueClass: "text-tertiary",
      bg: "bg-tertiary/5 border-tertiary/10",
    },
    {
      icon: "groups_2",
      label: "Competitors",
      value: `${competitorImpact >= 0 ? "+" : ""}${competitorImpact.toFixed(1)}%`,
      valueClass: competitorImpact >= 0 ? "text-tertiary" : "text-error",
      bg: competitorImpact >= 0 ? "bg-tertiary/5 border-tertiary/10" : "bg-error/5 border-error/10",
    },
  ];

  return (
    <div className="glass-panel rounded-lg p-4">
      <div className="mb-4 flex items-center justify-between">
        <h5 className="font-label text-[10px] uppercase tracking-widest text-primary">
          AI demand drivers · {market.destination}
        </h5>
        <span className="material-symbols-outlined text-[16px] text-tertiary">psychology</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {drivers.map((d) => (
          <div
            key={d.label}
            className={`rounded border p-2.5 ${d.bg}`}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant">{d.icon}</span>
              <span className="font-label text-[9px] uppercase tracking-wide text-on-surface-variant/70">{d.label}</span>
            </div>
            <div className={`font-label text-sm font-bold ${d.valueClass}`}>{d.value}</div>
          </div>
        ))}
      </div>
      {market.competitors.length > 0 && avgCompetitorRating !== null && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50 mb-1.5">
            Competitor avg rating
          </div>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <span
                key={star}
                className={`material-symbols-outlined text-[14px] ${star <= Math.round(avgCompetitorRating) ? "text-tertiary" : "text-white/10"}`}
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                star
              </span>
            ))}
            <span className="ml-1 font-label text-[10px] text-on-surface-variant">{avgCompetitorRating.toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
