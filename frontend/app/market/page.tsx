"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDemandForecast, getMarketContext, getRoutes, getWhatIf } from "@/lib/api";
import type { DemandForecastResponse, MarketContext, RouteInfo, WhatIfResponse } from "@/lib/types";
import { DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import KpiCard from "@/components/KpiCard";
import MarketShareLeaderboard, { type MarketRow } from "@/components/MarketShareLeaderboard";
import MiniBarPanel from "@/components/MiniBarPanel";

type CompetitionLevel = "LOW" | "MED" | "HIGH";
type SortKey = "opportunity" | "revenue" | "demand";

interface RouteOpportunityRow {
  route: RouteInfo;
  demand: DemandForecastResponse;
  whatIf: WhatIfResponse;
  market: MarketContext;
  opportunityScore: number;
  competition: CompetitionLevel;
}

interface MarketData {
  rows: RouteOpportunityRow[];
  marketRows: MarketRow[];
  gdpSeries: { label: string; value: number }[];
  maxPassengers: number;
}

function calcOpportunityScore(
  demand: DemandForecastResponse,
  whatIf: WhatIfResponse,
  market: MarketContext,
  maxPassengers: number,
  maxRevenue: number,
): number {
  const demandScore = maxPassengers > 0 ? (demand.predicted_passengers / maxPassengers) * 40 : 0;
  const revenueScore = maxRevenue > 0 ? (whatIf.baseline.revenue.total_revenue_usd / maxRevenue) * 30 : 0;
  const compScore = market.competitors.length === 0 ? 20 : Math.max(0, 20 - market.competitors.length * 5);
  const gdpScore = Math.min(10, Math.max(0, market.gdp_growth_pct * 2));
  return Math.round(demandScore + revenueScore + compScore + gdpScore);
}

function calcCompetition(market: MarketContext): CompetitionLevel {
  const n = market.competitors.length;
  if (n === 0) return "LOW";
  if (n <= 2) return "MED";
  return "HIGH";
}

function fmtUsd(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPax(v: number) {
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

const COMP_COLOR: Record<CompetitionLevel, string> = {
  LOW: "text-tertiary",
  MED: "text-secondary",
  HIGH: "text-error",
};

const COMP_BG: Record<CompetitionLevel, string> = {
  LOW: "border-tertiary/20 bg-tertiary/10",
  MED: "border-secondary/20 bg-secondary/10",
  HIGH: "border-error/20 bg-error/10",
};

export default function MarketAnalysisPage() {
  const [data, setData] = useState<MarketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("opportunity");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const routesData = await getRoutes();

        const results = await Promise.all(
          routesData.routes.map(async (route) => {
            const [demand, whatIf, market] = await Promise.all([
              getDemandForecast({ destination: route.destination, year: DEFAULT_YEAR, month: DEFAULT_MONTH }),
              getWhatIf({ destination: route.destination, year: DEFAULT_YEAR, month: DEFAULT_MONTH }),
              getMarketContext(route.destination, DEFAULT_YEAR),
            ]);
            return { route, demand, whatIf, market };
          })
        );

        const maxPassengers = Math.max(...results.map((r) => r.demand.predicted_passengers));
        const maxRevenue = Math.max(...results.map((r) => r.whatIf.baseline.revenue.total_revenue_usd));

        const rows: RouteOpportunityRow[] = results.map(({ route, demand, whatIf, market }) => ({
          route,
          demand,
          whatIf,
          market,
          opportunityScore: calcOpportunityScore(demand, whatIf, market, maxPassengers, maxRevenue),
          competition: calcCompetition(market),
        }));

        const marketRows: MarketRow[] = results.map(({ route, whatIf, market }) => ({
          route,
          whatIf,
          market,
        }));

        const gdpSeries = results.map(({ route, market }) => ({
          label: route.destination,
          value: market.gdp_growth_pct,
        }));

        if (!cancelled) setData({ rows, marketRows, gdpSeries, maxPassengers });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (error) return <ErrorMessage message={error} />;
  if (!data) return <LoadingSpinner />;

  const { rows, marketRows, gdpSeries, maxPassengers } = data;

  const sorted = [...rows].sort((a, b) => {
    if (sort === "revenue") return b.whatIf.baseline.revenue.total_revenue_usd - a.whatIf.baseline.revenue.total_revenue_usd;
    if (sort === "demand") return b.demand.predicted_passengers - a.demand.predicted_passengers;
    return b.opportunityScore - a.opportunityScore;
  });

  const topOpp = rows.reduce((best, r) => (r.opportunityScore > best.opportunityScore ? r : best));
  const topRev = rows.reduce((best, r) =>
    r.whatIf.baseline.revenue.total_revenue_usd > best.whatIf.baseline.revenue.total_revenue_usd ? r : best
  );
  const topTourism = rows.reduce((best, r) =>
    r.market.tourism_arrivals_baseline > best.market.tourism_arrivals_baseline ? r : best
  );
  const lowCompCount = rows.filter((r) => r.competition === "LOW").length;
  const avgComp = rows.reduce((sum, r) => sum + r.market.competitors.length, 0) / rows.length;

  const growthSignals = rows
    .flatMap((r) =>
      r.market.competitors.slice(0, 2).map((c) => ({
        route: r.route.destination,
        city: r.route.destination_city,
        competitor: c.name,
        frequency: c.weekly_frequency,
        fare: c.avg_fare_usd,
      }))
    )
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">
            Market Analysis <span className="text-tertiary">&amp; Intelligence</span>
          </h1>
          <p className="text-sm text-on-surface-variant">
            Pacific Wings network — {DEFAULT_YEAR}/{DEFAULT_MONTH.toString().padStart(2, "0")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded border border-tertiary/20 bg-tertiary/10 px-3 py-1.5">
            <span className="agent-pulse h-1.5 w-1.5 rounded-full bg-tertiary" />
            <span className="font-label text-[10px] uppercase tracking-widest text-tertiary">96.4% Confidence</span>
          </div>
          <Link
            href="/copilot?q=Execute+optimal+market+strategy+for+Pacific+Wings+network"
            className="flex items-center gap-2 rounded bg-accent-blue px-4 py-2 font-label text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            <span className="material-symbols-outlined text-[16px]">play_circle</span>
            EXECUTE STRATEGY
          </Link>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          icon="travel_explore"
          label="Best Opportunity"
          value={topOpp.route.destination}
          delta={`SCORE: ${topOpp.opportunityScore}/100`}
          deltaClass="text-tertiary"
        />
        <KpiCard
          icon="account_balance_wallet"
          label="Top Revenue Route"
          value={topRev.route.destination}
          delta={fmtUsd(topRev.whatIf.baseline.revenue.total_revenue_usd)}
          deltaClass="text-tertiary"
        />
        <KpiCard
          icon="beach_access"
          label="Highest Tourism"
          value={topTourism.route.destination}
          delta={`${(topTourism.market.tourism_arrivals_baseline / 1e6).toFixed(1)}M arrivals`}
          deltaClass="text-tertiary"
        />
        <KpiCard
          icon="shield"
          label="Low-Competition Routes"
          value={`${lowCompCount} / ${rows.length}`}
          delta="SCARCITY ADVANTAGE"
          deltaClass="text-tertiary"
        />
        <KpiCard
          icon="diversity_3"
          label="Avg Competitors"
          value={avgComp.toFixed(1)}
          delta={avgComp > 3 ? "HIGH PRESSURE" : "MANAGEABLE"}
          deltaClass={avgComp > 3 ? "text-error" : "text-tertiary"}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="glass-panel overflow-hidden rounded-lg">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
              <h3 className="text-lg font-semibold text-primary">Route Opportunity Ranking</h3>
              <div className="flex gap-1">
                {(["opportunity", "revenue", "demand"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSort(s)}
                    className={`rounded px-2 py-1 font-label text-[10px] uppercase tracking-wider transition-colors ${
                      sort === s
                        ? "bg-tertiary/20 text-tertiary"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead className="bg-black/20 font-label text-[10px] uppercase tracking-wider text-on-surface-variant">
                  <tr>
                    <th className="px-4 py-3 font-normal">Route</th>
                    <th className="px-4 py-3 font-normal">Demand Score</th>
                    <th className="px-4 py-3 font-normal">Competition</th>
                    <th className="px-4 py-3 font-normal">Revenue Potential</th>
                    <th className="px-4 py-3 font-normal">Status</th>
                    <th className="px-4 py-3 font-normal">Opp. Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm">
                  {sorted.map((r) => {
                    const demandNorm = maxPassengers > 0
                      ? Math.round((r.demand.predicted_passengers / maxPassengers) * 100)
                      : 0;
                    return (
                      <tr key={r.route.destination} className="transition-colors hover:bg-white/5">
                        <td className="px-4 py-3">
                          <div className="font-bold text-on-surface">SYD → {r.route.destination}</div>
                          <div className="font-label text-[10px] text-on-surface-variant/60">
                            {r.route.destination_city}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-white/10">
                              <div className="h-full bg-tertiary" style={{ width: `${demandNorm}%` }} />
                            </div>
                            <span className="font-label text-[10px] text-tertiary">{demandNorm}</span>
                          </div>
                          <div className="mt-0.5 font-label text-[10px] text-on-surface-variant/60">
                            {fmtPax(r.demand.predicted_passengers)} pax
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded border px-2 py-0.5 font-label text-[10px] ${COMP_BG[r.competition]} ${COMP_COLOR[r.competition]}`}
                          >
                            {r.competition}
                          </span>
                          <div className="mt-0.5 font-label text-[10px] text-on-surface-variant/60">
                            {r.market.competitors.length} carriers
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-on-surface">
                            {fmtUsd(r.whatIf.baseline.revenue.total_revenue_usd)}
                          </div>
                          <div className="font-label text-[10px] text-on-surface-variant/60">
                            ${r.demand.avg_fare_usd.toFixed(0)} avg fare
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded border px-2 py-0.5 font-label text-[10px] ${
                              r.route.status === "active"
                                ? "border-tertiary/20 bg-tertiary/10 text-tertiary"
                                : "border-secondary/20 bg-secondary/10 text-secondary"
                            }`}
                          >
                            {r.route.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div
                            className={`text-xl font-bold ${
                              r.opportunityScore >= 70
                                ? "text-tertiary"
                                : r.opportunityScore >= 45
                                ? "text-secondary"
                                : "text-on-surface-variant"
                            }`}
                          >
                            {r.opportunityScore}
                          </div>
                          <div className="mt-0.5 h-1 w-12 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full ${
                                r.opportunityScore >= 70
                                  ? "bg-tertiary"
                                  : r.opportunityScore >= 45
                                  ? "bg-secondary"
                                  : "bg-white/30"
                              }`}
                              style={{ width: `${r.opportunityScore}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <MiniBarPanel
            title="GDP Growth by Market"
            icon="bar_chart"
            data={gdpSeries}
            formatValue={(v) => `${v.toFixed(1)}%`}
          />

          <div className="glass-panel rounded-lg">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
              <h4 className="font-label text-[10px] uppercase tracking-widest text-primary">Competitor Signals</h4>
              <Link
                href="/copilot?q=Analyze+competitor+signals+and+recommend+counter-strategies+for+Pacific+Wings"
                className="font-label text-[9px] uppercase tracking-widest text-tertiary transition-colors hover:text-tertiary/70"
              >
                VIEW ALL INTEL →
              </Link>
            </div>
            <div className="divide-y divide-white/5">
              {growthSignals.length === 0 ? (
                <p className="p-4 text-sm text-on-surface-variant">No competitor data available.</p>
              ) : (
                growthSignals.map((s, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 px-4 py-3">
                    <div>
                      <div className="font-label text-[10px] text-on-surface-variant/60">
                        SYD → {s.route} · {s.city}
                      </div>
                      <div className="text-sm text-on-surface">{s.competitor}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-label text-[10px] text-secondary">{s.frequency}×/wk</div>
                      <div className="font-label text-[10px] text-on-surface-variant/60">
                        ${s.fare.toFixed(0)}/seat
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <MarketShareLeaderboard rows={marketRows} />
    </div>
  );
}
