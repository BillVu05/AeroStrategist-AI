"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { getHealth, getRoutes, getWhatIf } from "@/lib/api";
import type { RouteInfo, RoutesResponse, WhatIfResponse } from "@/lib/types";
import { DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import KpiCard from "@/components/KpiCard";
import AgentStatusPanel from "@/components/AgentStatusPanel";
import { fmtUsd } from "@/lib/format";

const RouteMap = dynamic(() => import("@/components/RouteMap"), { ssr: false });

interface RouteSummary {
  route: RouteInfo;
  current: WhatIfResponse;
  previous: WhatIfResponse;
}

interface DashboardData {
  routesData: RoutesResponse;
  summaries: RouteSummary[];
  llmAvailable: boolean;
  topRoute: RouteSummary;
}


function fmtPct(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function deltaBadge(current: number, previous: number, digits = 1) {
  if (previous === 0) return undefined;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`, positive: pct >= 0 };
}

function profitGrowthPct(s: RouteSummary) {
  const prev = s.previous.baseline.profit_usd;
  if (prev === 0) return 0;
  return ((s.current.baseline.profit_usd - prev) / Math.abs(prev)) * 100;
}

const PREVIOUS_MONTH = DEFAULT_MONTH === 1 ? 12 : DEFAULT_MONTH - 1;
const PREVIOUS_YEAR = DEFAULT_MONTH === 1 ? DEFAULT_YEAR - 1 : DEFAULT_YEAR;

export default function ExecutiveDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [routesData, health] = await Promise.all([getRoutes(), getHealth()]);
        const activeRoutes = routesData.routes.filter((r) => r.status === "active");

        const summaries: RouteSummary[] = await Promise.all(
          activeRoutes.map(async (route) => {
            const [current, previous] = await Promise.all([
              getWhatIf({ destination: route.destination, year: DEFAULT_YEAR, month: DEFAULT_MONTH }),
              getWhatIf({ destination: route.destination, year: PREVIOUS_YEAR, month: PREVIOUS_MONTH }),
            ]);
            return { route, current, previous };
          })
        );

        // `reduce` with no seed throws on an empty array, and every average
        // below divides by summaries.length. A profile with no active route is
        // an empty dashboard, not a TypeError and a page of NaN.
        if (activeRoutes.length === 0) {
          if (!cancelled) setError("No active routes in the airline profile - nothing to report on.");
          return;
        }

        const topRoute = summaries.reduce((best, s) =>
          s.current.baseline.profit_usd > best.current.baseline.profit_usd ? s : best
        );

        if (!cancelled) {
          setData({ routesData, summaries, llmAvailable: health.llm_available, topRoute });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorMessage message={error} />;
  if (!data) return <LoadingSpinner />;

  const { routesData, summaries, llmAvailable, topRoute } = data;

  const totalRevenue = summaries.reduce((sum, s) => sum + s.current.baseline.revenue.total_revenue_usd, 0);
  const prevTotalRevenue = summaries.reduce((sum, s) => sum + s.previous.baseline.revenue.total_revenue_usd, 0);

  const totalProfit = summaries.reduce((sum, s) => sum + s.current.baseline.profit_usd, 0);
  const prevTotalProfit = summaries.reduce((sum, s) => sum + s.previous.baseline.profit_usd, 0);

  const avgShare = summaries.reduce((sum, s) => sum + s.current.baseline.market_share.pacific_wings_share, 0) / summaries.length;
  const prevAvgShare = summaries.reduce((sum, s) => sum + s.previous.baseline.market_share.pacific_wings_share, 0) / summaries.length;

  const totalPassengers = summaries.reduce((sum, s) => sum + s.current.baseline.demand.passengers_carried, 0);
  const prevTotalPassengers = summaries.reduce((sum, s) => sum + s.previous.baseline.demand.passengers_carried, 0);

  const avgLoadFactor = summaries.reduce((sum, s) => sum + s.current.baseline.demand.load_factor, 0) / summaries.length;
  const prevAvgLoadFactor = summaries.reduce((sum, s) => sum + s.previous.baseline.demand.load_factor, 0) / summaries.length;

  const profitMargin = totalRevenue > 0 ? totalProfit / totalRevenue : 0;
  const prevProfitMargin = prevTotalRevenue > 0 ? prevTotalProfit / prevTotalRevenue : 0;

  const revenueDelta = deltaBadge(totalRevenue, prevTotalRevenue);
  const profitDelta = deltaBadge(totalProfit, prevTotalProfit);
  const shareDelta = deltaBadge(avgShare, prevAvgShare);
  const paxDelta = deltaBadge(totalPassengers, prevTotalPassengers);
  const loadDelta = deltaBadge(avgLoadFactor, prevAvgLoadFactor);
  const marginDelta = deltaBadge(profitMargin, prevProfitMargin);

  const topRouteGrowth = profitGrowthPct(topRoute);

  // Real-data strategic insights (replaces the mocked bento cards in the Stitch design)
  const growthLeader = summaries.reduce((best, s) => (profitGrowthPct(s) > profitGrowthPct(best) ? s : best));
  const capacityWatch = summaries.reduce((worst, s) =>
    s.current.baseline.demand.load_factor < worst.current.baseline.demand.load_factor ? s : worst
  );
  const contested = summaries.reduce((worst, s) =>
    s.current.baseline.market_share.pacific_wings_share < worst.current.baseline.market_share.pacific_wings_share ? s : worst
  );

  const insights = [
    {
      icon: "hub",
      iconClass: "bg-tertiary/10 text-tertiary",
      tag: "NETWORK DYNAMICS",
      title: `SYD → ${growthLeader.route.destination} leads growth`,
      body: `Profit up ${profitGrowthPct(growthLeader).toFixed(1)}% month-over-month to ${fmtUsd(
        growthLeader.current.baseline.profit_usd
      )}. Load factor ${fmtPct(growthLeader.current.baseline.demand.load_factor)}.`,
      dest: growthLeader.route.destination,
    },
    {
      icon: "flight",
      iconClass: "bg-secondary/10 text-secondary",
      tag: "CAPACITY STRATEGY",
      title: `SYD → ${capacityWatch.route.destination} at ${fmtPct(capacityWatch.current.baseline.demand.load_factor)} load`,
      body: `Lowest load factor in the network. ${capacityWatch.current.baseline.demand.passengers_carried.toLocaleString()} passengers carried this month — review frequency or gauge in Scenario Lab.`,
      dest: capacityWatch.route.destination,
    },
    {
      icon: "warning",
      iconClass: "bg-error/10 text-error",
      tag: "COMPETITIVE ALERT",
      title: `SYD → ${contested.route.destination} share ${fmtPct(contested.current.baseline.market_share.pacific_wings_share)}`,
      body: `Weakest market position in the network. Competitors hold ${fmtPct(
        1 - contested.current.baseline.market_share.pacific_wings_share
      )} of this corridor.`,
      dest: contested.route.destination,
    },
  ];

  return (
    <div className="flex h-full flex-col gap-4">
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          icon="account_balance_wallet"
          label="Monthly Revenue"
          value={fmtUsd(totalRevenue)}
          delta={revenueDelta?.text}
          deltaClass={revenueDelta?.positive ? "text-tertiary" : "text-error"}
        />
        <KpiCard
          icon="payments"
          label="Net Profit"
          value={fmtUsd(totalProfit)}
          delta={profitDelta?.text}
          deltaClass={profitDelta?.positive ? "text-tertiary" : "text-error"}
        />
        <KpiCard
          icon="pie_chart"
          label="Avg Market Share"
          value={fmtPct(avgShare)}
          delta={shareDelta?.text}
          deltaClass={shareDelta?.positive ? "text-tertiary" : "text-error"}
        />
        <KpiCard
          icon="group"
          label="Passengers Carried"
          value={totalPassengers.toLocaleString()}
          delta={paxDelta?.text}
          deltaClass={paxDelta?.positive ? "text-tertiary" : "text-error"}
        />
        <KpiCard
          icon="flight"
          label="Avg Load Factor"
          value={fmtPct(avgLoadFactor)}
          delta={loadDelta?.text}
          deltaClass={loadDelta?.positive ? "text-tertiary" : "text-error"}
        />
        <KpiCard
          icon="show_chart"
          label="Profit Margin"
          value={fmtPct(profitMargin)}
          delta={marginDelta?.text}
          deltaClass={marginDelta?.positive ? "text-tertiary" : "text-error"}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Network map */}
        <div className="relative xl:col-span-9">
          <RouteMap
            origin={routesData.origin}
            routes={routesData.routes}
            selected={null}
            onSelect={(destination) => router.push(`/routes?dest=${destination}`)}
          />
          <div className="absolute left-4 top-4 z-10 flex gap-2">
            <div className="flex items-center gap-2 rounded border border-white/10 bg-black/60 px-3 py-1 font-label text-[10px] text-tertiary backdrop-blur-md">
              <span className="agent-pulse h-2 w-2 rounded-full bg-tertiary" />
              LIVE: {routesData.origin.iata} NETWORK
            </div>
            <div className="rounded border border-white/10 bg-black/60 px-3 py-1 font-label text-[10px] text-on-surface-variant backdrop-blur-md">
              NODES: {routesData.routes.length + 1}
            </div>
          </div>
          <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-tertiary/20 bg-black/60 p-3 backdrop-blur-md">
            <h5 className="mb-2 font-label text-[10px] text-tertiary">NETWORK VISUALIZER</h5>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="h-[2px] w-3 bg-tertiary" />
                <span className="font-label text-[10px] text-on-surface-variant">ACTIVE REVENUE ROUTES</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 border-b border-dashed border-tertiary/50" />
                <span className="font-label text-[10px] text-on-surface-variant">PROSPECTIVE ROUTES</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4 xl:col-span-3">
          {/* Top route highlight */}
          <div className="glass-panel rim-light flex flex-1 flex-col rounded-2xl p-6">
            <div className="mb-6 flex items-center justify-between">
              <span className="font-label text-[11px] font-bold uppercase tracking-[0.1em] text-tertiary">
                Top Route
              </span>
              <span className="material-symbols-outlined text-tertiary">trending_up</span>
            </div>
            <div className="mb-6 flex flex-col items-center">
              <div className="mb-2 flex items-center gap-4">
                <span className="text-2xl font-bold tracking-tighter">{routesData.origin.iata}</span>
                <span className="material-symbols-outlined text-on-surface-variant">flight_takeoff</span>
                <span className="text-2xl font-bold tracking-tighter">{topRoute.route.destination}</span>
              </div>
              <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                Profit Optimized
              </p>
            </div>
            <div className="mt-auto space-y-3">
              <div className="flex items-end justify-between border-b border-white/5 pb-2">
                <span className="font-label text-[10px] uppercase text-on-surface-variant">Monthly Profit</span>
                <span className="text-lg font-bold text-tertiary">{fmtUsd(topRoute.current.baseline.profit_usd)}</span>
              </div>
              <div className="flex items-end justify-between border-b border-white/5 pb-2">
                <span className="font-label text-[10px] uppercase text-on-surface-variant">Load Factor</span>
                <span className="text-lg font-bold">{fmtPct(topRoute.current.baseline.demand.load_factor)}</span>
              </div>
              <div className="flex items-end justify-between border-b border-white/5 pb-2">
                <span className="font-label text-[10px] uppercase text-on-surface-variant">Growth</span>
                <span className={`text-lg font-bold ${topRouteGrowth >= 0 ? "text-tertiary" : "text-error"}`}>
                  {topRouteGrowth >= 0 ? "+" : ""}
                  {topRouteGrowth.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          <AgentStatusPanel llmAvailable={llmAvailable} />
        </div>
      </div>

      {/* Strategic insights bento */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {insights.map((insight) => (
          <button
            key={insight.tag}
            onClick={() => router.push(`/routes?dest=${insight.dest}`)}
            className="glass-panel rim-light group rounded-xl p-6 text-left transition-colors hover:bg-white/10"
          >
            <div className="mb-4 flex items-start justify-between">
              <div className={`rounded-lg p-2 ${insight.iconClass}`}>
                <span className="material-symbols-outlined">{insight.icon}</span>
              </div>
              <span className="font-label text-[10px] font-bold text-on-surface-variant">{insight.tag}</span>
            </div>
            <h5 className="mb-2 text-lg font-bold">{insight.title}</h5>
            <p className="text-sm leading-tight text-on-surface-variant">{insight.body}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
