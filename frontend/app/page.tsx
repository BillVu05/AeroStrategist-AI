"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getDemandForecast, getHealth, getRouteEconomics, getRoutes, getWhatIf } from "@/lib/api";
import type { RouteInfo, RoutesResponse, WhatIfResponse } from "@/lib/types";
import { DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import AIPromptBar from "@/components/AIPromptBar";
import KpiCard from "@/components/KpiCard";
import MiniBarPanel from "@/components/MiniBarPanel";
import RevenueByCabinPanel from "@/components/RevenueByCabinPanel";
import ScenarioQuickSim from "@/components/ScenarioQuickSim";
import AgentStatusPanel from "@/components/AgentStatusPanel";
import StatusFooter from "@/components/StatusFooter";

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
  demandSeries: { label: string; value: number }[];
  topRoute: RouteSummary;
  topRouteFuelPrice: number;
  topRouteRevenue: WhatIfResponse["baseline"]["revenue"];
}

function fmtUsd(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function deltaBadge(current: number, previous: number, digits = 1) {
  if (previous === 0) return undefined;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`, positive: pct >= 0 };
}

const PREVIOUS_MONTH = DEFAULT_MONTH === 1 ? 12 : DEFAULT_MONTH - 1;
const PREVIOUS_YEAR = DEFAULT_MONTH === 1 ? DEFAULT_YEAR - 1 : DEFAULT_YEAR;

export default function ExecutiveDashboardPage() {
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

        const topRoute = summaries.reduce((best, s) =>
          s.current.baseline.profit_usd > best.current.baseline.profit_usd ? s : best
        );

        const [demandMonths, topRouteEconomics] = await Promise.all([
          Promise.all(
            Array.from({ length: 12 }, (_, i) =>
              getDemandForecast({ destination: "DAD", year: DEFAULT_YEAR, month: i + 1 })
            )
          ),
          getRouteEconomics({
            destination: topRoute.route.destination,
            year: DEFAULT_YEAR,
            month: DEFAULT_MONTH,
          }),
        ]);

        const demandSeries = demandMonths.map((m, i) => ({
          label: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i],
          value: m.predicted_passengers,
        }));

        if (!cancelled) {
          setData({
            routesData,
            summaries,
            llmAvailable: health.llm_available,
            demandSeries,
            topRoute,
            topRouteFuelPrice: topRouteEconomics.cost.fuel_price_usd_per_gallon,
            topRouteRevenue: topRouteEconomics.revenue,
          });
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

  const { routesData, summaries, llmAvailable, demandSeries, topRoute, topRouteFuelPrice, topRouteRevenue } = data;

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

  return (
    <div className="flex h-full flex-col gap-4">
      <AIPromptBar />

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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="space-y-4 xl:col-span-3">
          <div className="relative">
            <RouteMap origin={routesData.origin} routes={routesData.routes} selected={null} onSelect={() => {}} />
            <div className="absolute left-4 top-4 z-10 flex gap-2">
              <div className="flex items-center gap-2 rounded border border-white/10 bg-black/60 px-3 py-1 font-label text-[10px] text-tertiary backdrop-blur-md">
                <span className="agent-pulse h-2 w-2 rounded-full bg-tertiary" />
                LIVE: {routesData.origin.iata} NETWORK
              </div>
              <div className="rounded border border-white/10 bg-black/60 px-3 py-1 font-label text-[10px] text-on-surface-variant backdrop-blur-md">
                NODES: {routesData.routes.length + 1}
              </div>
            </div>
            <div className="absolute bottom-4 right-4 z-10 w-48 rounded-lg border border-white/10 bg-black/60 p-3 backdrop-blur-md">
              <h5 className="mb-2 font-label text-[10px] text-primary">TOP ROUTE</h5>
              <div className="space-y-1">
                <div className="flex items-center justify-between font-label text-[10px]">
                  <span className="text-on-surface-variant">SYD → {topRoute.route.destination}</span>
                  <span className="text-tertiary">{fmtUsd(topRoute.current.baseline.profit_usd)}</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full bg-tertiary"
                    style={{ width: `${Math.min(topRoute.current.baseline.demand.load_factor * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <MiniBarPanel title="Demand forecast · DAD" icon="trending_up" data={demandSeries} />
            <RevenueByCabinPanel destination={topRoute.route.destination} revenue={topRouteRevenue} />
            <ScenarioQuickSim
              destination={topRoute.route.destination}
              year={DEFAULT_YEAR}
              month={DEFAULT_MONTH}
              baseFuelPrice={topRouteFuelPrice}
            />
          </div>
        </div>

        <div className="xl:col-span-1">
          <AgentStatusPanel llmAvailable={llmAvailable} />
        </div>
      </div>

      <StatusFooter />
    </div>
  );
}
