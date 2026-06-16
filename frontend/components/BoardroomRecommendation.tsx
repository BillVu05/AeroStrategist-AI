import Link from "next/link";
import type { MarketContext, WhatIfResponse } from "@/lib/types";

interface BoardroomRecommendationProps {
  destination: string;
  destinationCity: string;
  whatIf: WhatIfResponse;
  market: MarketContext;
}

function fmtUsd(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function BoardroomRecommendation({
  destination,
  destinationCity,
  whatIf,
  market,
}: BoardroomRecommendationProps) {
  const { baseline } = whatIf;
  const profit = baseline.profit_usd;
  const margin = baseline.revenue.total_revenue_usd > 0 ? profit / baseline.revenue.total_revenue_usd : 0;

  const riskRating = profit < 0 ? "HIGH" : margin < 0.1 ? "MEDIUM" : "LOW";
  const riskColor = riskRating === "HIGH" ? "text-error" : riskRating === "MEDIUM" ? "text-secondary" : "text-tertiary";

  const competitorCount = market.competitors.length;
  const competitionLabel = competitorCount === 0 ? "NONE" : competitorCount === 1 ? "LOW" : competitorCount === 2 ? "MEDIUM" : "HIGH";

  const confidence = Math.max(40, Math.min(95, Math.round(55 + margin * 100 + market.gdp_growth_pct)));

  const recommendation: "PROCEED" | "CAUTION" | "NO-GO" =
    profit < 0 ? "NO-GO" : margin < 0.1 ? "CAUTION" : "PROCEED";

  const recStyle = {
    PROCEED: { badge: "border-tertiary/40 bg-tertiary/10 text-tertiary", icon: "check_circle" },
    CAUTION: { badge: "border-secondary/40 bg-secondary/10 text-secondary", icon: "warning" },
    "NO-GO": { badge: "border-error/40 bg-error/10 text-error", icon: "cancel" },
  }[recommendation];

  const sharePct = baseline.market_share.pacific_wings_share * 100;

  const growthRate = Math.max(market.gdp_growth_pct / 100, 0.01);
  const demandBars = [0, 1, 2, 3, 4].map((i) => Math.pow(1 + growthRate, i));
  const maxBar = demandBars[demandBars.length - 1];

  const paybackYears = profit > 0 ? (2_000_000 / (profit * 12)).toFixed(1) : "N/A";

  return (
    <div className="glass-panel-active glow-border relative space-y-6 overflow-hidden rounded-lg p-4">
      {/* Header row: title + confidence + recommendation badge */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="rounded-lg bg-tertiary/10 p-3">
            <span className="material-symbols-outlined text-[32px] text-tertiary">auto_awesome</span>
          </div>
          <div>
            <h3 className="text-xl font-semibold text-primary">Boardroom Recommendation</h3>
            <p className="font-label text-[10px] uppercase tracking-widest text-tertiary/80">
              Strategic expansion candidate · SYD → {destination}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className={`flex items-center gap-1.5 rounded border px-3 py-1.5 font-label text-sm font-bold tracking-widest ${recStyle.badge}`}>
            <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              {recStyle.icon}
            </span>
            {recommendation}
          </span>
          <div className="text-right">
            <span className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50">Confidence</span>
            <div className="font-label text-xl font-bold text-tertiary leading-tight">{confidence}%</div>
          </div>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {[
          { label: "Est. Revenue", value: fmtUsd(baseline.revenue.total_revenue_usd), color: "text-primary" },
          { label: "Net Profit", value: fmtUsd(profit), color: profit >= 0 ? "text-tertiary" : "text-error" },
          { label: "Market Share", value: `${sharePct.toFixed(0)}%`, color: "text-on-surface" },
          { label: "Risk Rating", value: riskRating, color: riskColor },
          { label: "Competition", value: competitionLabel, color: "text-on-surface" },
          { label: "Payback", value: `${paybackYears}y`, color: "text-secondary" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded border border-white/5 bg-white/[0.02] p-2.5 text-center">
            <div className="font-label text-[9px] uppercase tracking-wide text-on-surface-variant/60 mb-1">{label}</div>
            <div className={`text-sm font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <Link
          href="/copilot?q=Should%20we%20launch%20Sydney%20to%20Da%20Nang%3F"
          className="flex flex-1 items-center justify-center gap-2 rounded bg-accent-blue py-2.5 font-label text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
          DEPLOY ASSET
        </Link>
        <Link
          href="/copilot?q=Simulate+alternatives+to+the+Sydney+Da+Nang+route"
          className="glass-panel flex flex-1 items-center justify-center gap-2 rounded py-2.5 font-label text-xs font-medium text-on-surface transition-colors hover:bg-white/10"
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          SIMULATE ALTERNATIVES
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="glass-panel rounded-lg border-l-2 border-tertiary p-4">
          <div className="mb-2 font-label text-[10px] uppercase tracking-widest text-tertiary">Demand Growth</div>
          <div className="mb-2 flex h-16 items-end gap-1">
            {demandBars.map((v, i) => (
              <div
                key={i}
                className={i === demandBars.length - 1 ? "h-full w-full bg-tertiary" : "w-full bg-tertiary/40"}
                style={{ height: `${(v / maxBar) * 100}%` }}
              />
            ))}
          </div>
          <p className="text-[11px] text-on-surface-variant">
            +{market.gdp_growth_pct.toFixed(1)}% GDP growth ({market.macro_year})
          </p>
        </div>
        <div className="glass-panel rounded-lg border-l-2 border-secondary p-4">
          <div className="mb-2 font-label text-[10px] uppercase tracking-widest text-secondary">Aircraft Synergy</div>
          <div className="mb-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary">flight_class</span>
            <span className="text-base font-bold text-on-surface">{market.assigned_aircraft}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant">
            {market.distance_km.toLocaleString()} km · {market.flight_duration_hours.toFixed(1)}h
          </p>
        </div>
        <div className="glass-panel rounded-lg border-l-2 border-on-primary-container p-4">
          <div className="mb-2 font-label text-[10px] uppercase tracking-widest text-on-primary-container">
            Market Share
          </div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-base font-bold text-on-surface">{sharePct.toFixed(0)}%</span>
            <span className="material-symbols-outlined text-on-primary-container">pie_chart</span>
          </div>
          <p className="text-[11px] text-on-surface-variant">Projected Pacific Wings share</p>
        </div>
      </div>
    </div>
  );
}
