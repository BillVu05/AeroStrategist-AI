"use client";

import { useEffect, useState } from "react";
import { getDemandForecast, getMarketContext, getRoutes } from "@/lib/api";
import type { DemandForecastResponse, MarketContext, RoutesResponse } from "@/lib/types";
import { DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import KpiCard from "@/components/KpiCard";
import MiniBarPanel from "@/components/MiniBarPanel";
import DemandDriversPanel from "@/components/DemandDriversPanel";
import DemandScenarioPanel from "@/components/DemandScenarioPanel";
import DemandComparisonTable, { type DemandComparisonRow } from "@/components/DemandComparisonTable";

const YOY_YEAR = DEFAULT_YEAR - 1;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface DemandData {
  routesData: RoutesResponse;
  paxSeries: { label: string; value: number }[];
  loadFactorSeries: { label: string; value: number }[];
  comparisonRows: DemandComparisonRow[];
  topGrowthRoute: DemandComparisonRow;
  driversMarket: MarketContext;
  networkYoyGrowthPct: number;
  avgFareUsd: number;
  avgLoadFactor: number;
}

function fmtPax(value: number) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

export default function DemandForecastingPage() {
  const [data, setData] = useState<DemandData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const routesData = await getRoutes();
        const activeRoutes = routesData.routes.filter((r) => r.status === "active");
        const allRoutes = routesData.routes;

        // 12-month forecasts for every active route, current year.
        const yearlyForecasts: DemandForecastResponse[][] = await Promise.all(
          activeRoutes.map((route) =>
            Promise.all(
              Array.from({ length: 12 }, (_, i) =>
                getDemandForecast({ destination: route.destination, year: DEFAULT_YEAR, month: i + 1 })
              )
            )
          )
        );

        // Same-month-last-year forecast for every route (active + candidate), for YoY growth.
        const lastYearForecasts = await Promise.all(
          allRoutes.map((route) =>
            getDemandForecast({ destination: route.destination, year: YOY_YEAR, month: DEFAULT_MONTH })
          )
        );

        // Current-month forecast for candidate routes not covered by yearlyForecasts.
        const currentMonthByDestination = new Map<string, DemandForecastResponse>();
        activeRoutes.forEach((route, i) => {
          currentMonthByDestination.set(route.destination, yearlyForecasts[i][DEFAULT_MONTH - 1]);
        });
        const candidateRoutes = allRoutes.filter((r) => !currentMonthByDestination.has(r.destination));
        const candidateForecasts = await Promise.all(
          candidateRoutes.map((route) => getDemandForecast({ destination: route.destination, year: DEFAULT_YEAR, month: DEFAULT_MONTH }))
        );
        candidateRoutes.forEach((route, i) => currentMonthByDestination.set(route.destination, candidateForecasts[i]));

        const lastYearByDestination = new Map<string, DemandForecastResponse>();
        allRoutes.forEach((route, i) => lastYearByDestination.set(route.destination, lastYearForecasts[i]));

        // Network-wide monthly series (active routes only).
        const paxSeries = MONTH_LABELS.map((label, i) => ({
          label,
          value: yearlyForecasts.reduce((sum, months) => sum + months[i].predicted_passengers, 0),
        }));
        const loadFactorSeries = MONTH_LABELS.map((label, i) => ({
          label,
          value:
            yearlyForecasts.reduce((sum, months) => sum + months[i].predicted_load_factor, 0) / yearlyForecasts.length,
        }));

        const comparisonRows: DemandComparisonRow[] = allRoutes.map((route) => {
          const current = currentMonthByDestination.get(route.destination)!;
          const lastYear = lastYearByDestination.get(route.destination)!;
          const yoyGrowthPct =
            lastYear.predicted_passengers > 0
              ? ((current.predicted_passengers - lastYear.predicted_passengers) / lastYear.predicted_passengers) * 100
              : 0;
          return {
            route,
            monthlyDemand: current.predicted_passengers,
            monthlyDemandLow: current.predicted_passengers_low,
            monthlyDemandHigh: current.predicted_passengers_high,
            avgFareUsd: current.avg_fare_usd,
            loadFactor: current.predicted_load_factor,
            yoyGrowthPct,
          };
        });

        const topGrowthRoute = comparisonRows.reduce((best, r) => (r.yoyGrowthPct > best.yoyGrowthPct ? r : best));

        const activeRows = comparisonRows.filter((r) => r.route.status === "active");
        const currentTotal = activeRows.reduce((sum, r) => sum + r.monthlyDemand, 0);
        const lastYearTotal = activeRows.reduce(
          (sum, r) => sum + lastYearByDestination.get(r.route.destination)!.predicted_passengers,
          0
        );
        const networkYoyGrowthPct = lastYearTotal > 0 ? ((currentTotal - lastYearTotal) / lastYearTotal) * 100 : 0;

        const totalFareWeight = activeRows.reduce((sum, r) => sum + r.monthlyDemand * r.avgFareUsd, 0);
        const avgFareUsd = currentTotal > 0 ? totalFareWeight / currentTotal : 0;
        const avgLoadFactor = activeRows.reduce((sum, r) => sum + r.loadFactor, 0) / activeRows.length;

        const driversMarket = await getMarketContext(topGrowthRoute.route.destination, DEFAULT_YEAR);

        if (!cancelled) {
          setData({
            routesData,
            paxSeries,
            loadFactorSeries,
            comparisonRows,
            topGrowthRoute,
            driversMarket,
            networkYoyGrowthPct,
            avgFareUsd,
            avgLoadFactor,
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

  const { paxSeries, loadFactorSeries, comparisonRows, topGrowthRoute, driversMarket, networkYoyGrowthPct, avgFareUsd, avgLoadFactor } =
    data;

  const predictedAnnualPax = paxSeries.reduce((sum, m) => sum + m.value, 0);
  const peakMonth = paxSeries.reduce((best, m) => (m.value > best.value ? m : best));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-on-surface">
          Demand Forecasting <span className="text-tertiary">&amp; Predictive Analytics</span>
        </h1>
        <p className="text-sm text-on-surface-variant">
          Pacific Wings network — {DEFAULT_YEAR}/{DEFAULT_MONTH.toString().padStart(2, "0")}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard icon="groups" label="Predicted Annual Pax" value={fmtPax(predictedAnnualPax)} />
        <KpiCard
          icon="trending_up"
          label="YoY Demand Growth"
          value={`${networkYoyGrowthPct >= 0 ? "+" : ""}${networkYoyGrowthPct.toFixed(1)}%`}
          delta={networkYoyGrowthPct >= 0 ? "ACCELERATING" : "SLOWING"}
          deltaClass={networkYoyGrowthPct >= 0 ? "text-tertiary" : "text-error"}
        />
        <KpiCard icon="speed" label="Avg Load Factor" value={`${(avgLoadFactor * 100).toFixed(1)}%`} />
        <KpiCard icon="calendar_month" label="Peak Month" value={peakMonth.label} />
        <KpiCard
          icon="rocket_launch"
          label="Top Growth Route"
          value={topGrowthRoute.route.destination}
          delta={`${topGrowthRoute.yoyGrowthPct >= 0 ? "+" : ""}${topGrowthRoute.yoyGrowthPct.toFixed(1)}%`}
          deltaClass={topGrowthRoute.yoyGrowthPct >= 0 ? "text-tertiary" : "text-error"}
        />
        <KpiCard icon="sell" label="Network Avg Fare" value={`$${avgFareUsd.toFixed(0)}`} />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MiniBarPanel title={`Network demand forecast · ${DEFAULT_YEAR}`} icon="trending_up" data={paxSeries} formatValue={fmtPax} />
          <MiniBarPanel
            title={`Network load factor · ${DEFAULT_YEAR}`}
            icon="speed"
            data={loadFactorSeries}
            formatValue={(v) => `${(v * 100).toFixed(0)}%`}
          />
        </div>
        <DemandDriversPanel market={driversMarket} />
      </div>

      <DemandComparisonTable rows={comparisonRows} />

      {/* Competitor Intelligence */}
      {driversMarket.competitors.length > 0 && (
        <div className="glass-panel overflow-hidden rounded-lg">
          <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
            <h3 className="flex items-center gap-2 font-label text-[10px] uppercase tracking-widest text-primary">
              <span className="material-symbols-outlined text-[14px] text-tertiary">groups</span>
              Competitor Intelligence · {driversMarket.destination}
            </h3>
            <span className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/40">
              {driversMarket.competitors.length} CARRIERS
            </span>
          </div>
          <div className="grid grid-cols-1 gap-px bg-white/5 sm:grid-cols-3">
            {driversMarket.competitors.slice(0, 3).map((c) => (
              <div key={c.name} className="bg-background p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div className="font-semibold text-on-surface">{c.name}</div>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span
                        key={star}
                        className={`material-symbols-outlined text-[12px] ${star <= Math.round(c.rating) ? "text-tertiary" : "text-white/10"}`}
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        star
                      </span>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  {[
                    { label: "Frequency", value: `${c.weekly_frequency}×/wk` },
                    { label: "Avg Fare",  value: `$${c.avg_fare_usd.toFixed(0)}` },
                    { label: "Rating",    value: `${c.rating.toFixed(1)} / 5.0` },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50">{label}</span>
                      <span className="font-label text-[10px] font-medium text-on-surface">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <DemandScenarioPanel destination={topGrowthRoute.route.destination} year={DEFAULT_YEAR} month={DEFAULT_MONTH} />
        </div>
      </div>
    </div>
  );
}
