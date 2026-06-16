"use client";

import { useEffect, useState } from "react";
import { getRouteEconomics, getRoutes, getWhatIf } from "@/lib/api";
import type { RoutesResponse, WhatIfResponse } from "@/lib/types";
import { DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import KpiCard from "@/components/KpiCard";
import TrendLinePanel from "@/components/TrendLinePanel";
import RevenueCompositionPanel from "@/components/RevenueCompositionPanel";
import RevenueLeaderboardTable from "@/components/RevenueLeaderboardTable";
import PricingSimulatorPanel from "@/components/PricingSimulatorPanel";
import type { ProfitabilityRow } from "@/components/RouteProfitabilityTable";

const PREVIOUS_MONTH = DEFAULT_MONTH === 1 ? 12 : DEFAULT_MONTH - 1;
const PREVIOUS_YEAR = DEFAULT_MONTH === 1 ? DEFAULT_YEAR - 1 : DEFAULT_YEAR;

const MONTH_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

interface RevenueRow extends ProfitabilityRow {
  previousWhatIf: WhatIfResponse;
}

interface RevenueData {
  routesData: RoutesResponse;
  rows: RevenueRow[];
  topRoute: RevenueRow;
  revenueSeries: { label: string; value: number }[];
  profitSeries: { label: string; value: number }[];
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

/** Yield expressed as ticket revenue per 1,000 revenue-passenger-km. */
function networkYield(rows: RevenueRow[], leg: "baseline" | "previous") {
  let ticketRevenue = 0;
  let rpk = 0;
  for (const { route, whatIf, previousWhatIf } of rows) {
    const result = leg === "baseline" ? whatIf.baseline : previousWhatIf.baseline;
    ticketRevenue += result.revenue.ticket_revenue_usd;
    rpk += result.demand.passengers_carried * route.distance_km;
  }
  return rpk > 0 ? (ticketRevenue / rpk) * 1000 : 0;
}

export default function RevenueIntelligencePage() {
  const [data, setData] = useState<RevenueData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const routesData = await getRoutes();
        const activeRoutes = routesData.routes.filter((r) => r.status === "active");

        const rows: RevenueRow[] = await Promise.all(
          activeRoutes.map(async (route) => {
            const [whatIf, previousWhatIf] = await Promise.all([
              getWhatIf({ destination: route.destination, year: DEFAULT_YEAR, month: DEFAULT_MONTH }),
              getWhatIf({ destination: route.destination, year: PREVIOUS_YEAR, month: PREVIOUS_MONTH }),
            ]);
            return { route, whatIf, previousWhatIf, previousPassengers: previousWhatIf.baseline.demand.passengers_carried };
          })
        );

        const topRoute = rows.reduce((best, r) => (r.whatIf.baseline.profit_usd > best.whatIf.baseline.profit_usd ? r : best));

        const monthlyEconomics = await Promise.all(
          Array.from({ length: 12 }, (_, i) =>
            getRouteEconomics({ destination: topRoute.route.destination, year: DEFAULT_YEAR, month: i + 1 })
          )
        );

        const revenueSeries = monthlyEconomics.map((m, i) => ({
          label: MONTH_LABELS[i],
          value: m.revenue.total_revenue_usd,
        }));
        const profitSeries = monthlyEconomics.map((m, i) => ({
          label: MONTH_LABELS[i],
          value: m.profit_usd,
        }));

        if (!cancelled) {
          setData({ routesData, rows, topRoute, revenueSeries, profitSeries });
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

  const { rows, topRoute, revenueSeries, profitSeries } = data;

  const totalRevenue = rows.reduce((sum, r) => sum + r.whatIf.baseline.revenue.total_revenue_usd, 0);
  const prevTotalRevenue = rows.reduce((sum, r) => sum + r.previousWhatIf.baseline.revenue.total_revenue_usd, 0);

  const totalProfit = rows.reduce((sum, r) => sum + r.whatIf.baseline.profit_usd, 0);
  const prevTotalProfit = rows.reduce((sum, r) => sum + r.previousWhatIf.baseline.profit_usd, 0);

  const totalPassengers = rows.reduce((sum, r) => sum + r.whatIf.baseline.demand.passengers_carried, 0);
  const prevTotalPassengers = rows.reduce((sum, r) => sum + r.previousWhatIf.baseline.demand.passengers_carried, 0);

  const totalAncillary = rows.reduce((sum, r) => sum + r.whatIf.baseline.revenue.ancillary_revenue_usd, 0);
  const prevTotalAncillary = rows.reduce((sum, r) => sum + r.previousWhatIf.baseline.revenue.ancillary_revenue_usd, 0);

  const operatingMargin = totalRevenue > 0 ? totalProfit / totalRevenue : 0;
  const prevOperatingMargin = prevTotalRevenue > 0 ? prevTotalProfit / prevTotalRevenue : 0;

  const revenuePerPax = totalPassengers > 0 ? totalRevenue / totalPassengers : 0;
  const prevRevenuePerPax = prevTotalPassengers > 0 ? prevTotalRevenue / prevTotalPassengers : 0;

  const yieldPer1000Rpk = networkYield(rows, "baseline");
  const prevYieldPer1000Rpk = networkYield(rows, "previous");

  const revenueDelta = deltaBadge(totalRevenue, prevTotalRevenue);
  const profitDelta = deltaBadge(totalProfit, prevTotalProfit);
  const marginDelta = deltaBadge(operatingMargin, prevOperatingMargin);
  const revPerPaxDelta = deltaBadge(revenuePerPax, prevRevenuePerPax);
  const ancillaryDelta = deltaBadge(totalAncillary, prevTotalAncillary);
  const yieldDelta = deltaBadge(yieldPer1000Rpk, prevYieldPer1000Rpk);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-on-surface">
          Revenue Intelligence <span className="text-tertiary">&amp; Profitability Analysis</span>
        </h1>
        <p className="text-sm text-on-surface-variant">
          Pacific Wings network — {DEFAULT_YEAR}/{DEFAULT_MONTH.toString().padStart(2, "0")}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          icon="account_balance_wallet"
          label="Revenue Forecast"
          value={fmtUsd(totalRevenue)}
          delta={revenueDelta?.text}
          deltaClass={revenueDelta?.positive ? "text-tertiary" : "text-error"}
        />
        <KpiCard
          icon="payments"
          label="Profit Forecast"
          value={fmtUsd(totalProfit)}
          delta={profitDelta?.text}
          deltaClass={profitDelta?.positive ? "text-tertiary" : "text-error"}
        />
        <KpiCard
          icon="show_chart"
          label="Operating Margin"
          value={fmtPct(operatingMargin)}
          delta={marginDelta?.text}
          deltaClass={marginDelta?.positive ? "text-tertiary" : "text-error"}
        />
        <KpiCard
          icon="person"
          label="Revenue / Passenger"
          value={fmtUsd(revenuePerPax)}
          delta={revPerPaxDelta?.text}
          deltaClass={revPerPaxDelta?.positive ? "text-tertiary" : "text-error"}
        />
        <KpiCard
          icon="luggage"
          label="Ancillary Revenue"
          value={fmtUsd(totalAncillary)}
          delta={ancillaryDelta?.text}
          deltaClass={ancillaryDelta?.positive ? "text-tertiary" : "text-error"}
        />
        <KpiCard
          icon="speed"
          label="Yield / 1,000 RPK"
          value={fmtUsd(yieldPer1000Rpk)}
          delta={yieldDelta?.text}
          deltaClass={yieldDelta?.positive ? "text-tertiary" : "text-error"}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TrendLinePanel
            title={`Revenue trend · ${topRoute.route.destination}`}
            icon="trending_up"
            data={revenueSeries}
            formatValue={fmtUsd}
          />
          <TrendLinePanel
            title={`Profit trend · ${topRoute.route.destination}`}
            icon="monitoring"
            data={profitSeries}
            formatValue={fmtUsd}
          />
        </div>
        <RevenueCompositionPanel rows={rows} />
      </div>

      <RevenueLeaderboardTable rows={rows} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <PricingSimulatorPanel destination={topRoute.route.destination} year={DEFAULT_YEAR} month={DEFAULT_MONTH} />
        </div>
      </div>
    </div>
  );
}
