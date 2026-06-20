import type { MarketContext } from "@/lib/types";

interface DemandDriversPanelProps {
  market: MarketContext;
}

const FEATURE_LABELS: Record<string, string> = {
  distance_km: "Distance",
  population: "Population",
  gdp_usd: "GDP",
  gdp_growth_pct: "GDP growth",
  tourism_arrivals_baseline: "Tourism",
  competitor_count: "Competitor count",
  competitor_avg_fare_usd: "Competitor fares",
  avg_fare_usd: "Fare",
  seasonality: "Seasonality (month)",
};

/** Real per-feature importances from the trained XGBoost demand model
 * (ml/train_demand_model.py), combining the two month sin/cos encoding
 * features into one human-readable "Seasonality" entry. */
function topDemandDrivers(raw: Record<string, number>, limit = 5) {
  const combined: Record<string, number> = { ...raw };
  combined.seasonality = (combined.month_sin ?? 0) + (combined.month_cos ?? 0);
  delete combined.month_sin;
  delete combined.month_cos;

  const total = Object.values(combined).reduce((sum, v) => sum + v, 0) || 1;
  return Object.entries(combined)
    .map(([key, value]) => ({ label: FEATURE_LABELS[key] ?? key, pct: (value / total) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, limit);
}

export default function DemandDriversPanel({ market }: DemandDriversPanelProps) {
  const avgCompetitorRating =
    market.competitors.length > 0
      ? market.competitors.reduce((sum, c) => sum + c.rating, 0) / market.competitors.length
      : null;

  const modelDrivers = topDemandDrivers(market.demand_feature_importances);

  const drivers = [
    {
      icon: "luggage",
      label: "Tourism Arrivals",
      value: `${(market.tourism_arrivals_baseline / 1e6).toFixed(1)}M/yr`,
      valueClass: "text-tertiary",
      bg: "bg-tertiary/5 border-tertiary/10",
    },
    {
      icon: "trending_up",
      label: "GDP Growth",
      value: `${market.gdp_growth_pct >= 0 ? "+" : ""}${market.gdp_growth_pct.toFixed(1)}%`,
      valueClass: market.gdp_growth_pct >= 0 ? "text-tertiary" : "text-error",
      bg: market.gdp_growth_pct >= 0 ? "bg-tertiary/5 border-tertiary/10" : "bg-error/5 border-error/10",
    },
    {
      icon: "groups",
      label: "Population",
      value: `${(market.population / 1e6).toFixed(1)}M`,
      valueClass: "text-tertiary",
      bg: "bg-tertiary/5 border-tertiary/10",
    },
    {
      icon: "groups_2",
      label: "Competitors",
      value: `${market.competitors.length}`,
      valueClass: "text-on-surface",
      bg: "bg-tertiary/5 border-tertiary/10",
    },
  ];

  return (
    <div className="glass-panel rounded-lg p-4">
      <div className="mb-4 flex items-center justify-between">
        <h5 className="font-label text-[10px] uppercase tracking-widest text-primary">
          Demand drivers · {market.destination}
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

      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50 mb-1.5">
          What the demand model actually learned matters
        </div>
        <div className="space-y-1.5">
          {modelDrivers.map((d) => (
            <div key={d.label} className="flex items-center gap-2">
              <span className="font-label text-[10px] w-28 shrink-0 text-on-surface-variant">{d.label}</span>
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-tertiary/60" style={{ width: `${d.pct}%` }} />
              </div>
              <span className="font-label text-[10px] w-10 text-right text-on-surface-variant">{d.pct.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
