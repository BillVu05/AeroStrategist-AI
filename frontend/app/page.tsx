"use client";

import { useEffect, useState } from "react";
import { getRoutes, getWhatIf } from "@/lib/api";
import type { RouteInfo, WhatIfResponse } from "@/lib/types";
import { DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import RouteCard from "@/components/RouteCard";
import ProfitByRouteChart from "@/components/ProfitByRouteChart";

interface RouteSummary {
  route: RouteInfo;
  whatIf: WhatIfResponse;
}

export default function ExecutiveDashboardPage() {
  const [summaries, setSummaries] = useState<RouteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const routesData = await getRoutes();
        const activeRoutes = routesData.routes.filter((r) => r.status === "active");

        const results = await Promise.all(
          activeRoutes.map(async (route) => ({
            route,
            whatIf: await getWhatIf({
              destination: route.destination,
              year: DEFAULT_YEAR,
              month: DEFAULT_MONTH,
            }),
          }))
        );

        if (!cancelled) setSummaries(results);
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
  if (!summaries) return <LoadingSpinner />;

  const chartData = summaries.map(({ route, whatIf }) => ({
    destination: route.destination,
    profit_usd: whatIf.baseline.profit_usd,
  }));

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Executive Dashboard</h1>
      <p className="mb-4 text-sm text-gray-500">
        Pacific Wings — current operations, {DEFAULT_YEAR}/{DEFAULT_MONTH.toString().padStart(2, "0")}
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {summaries.map(({ route, whatIf }) => (
          <RouteCard
            key={route.destination}
            destination={route.destination}
            destinationName={route.destination_name}
            profitUsd={whatIf.baseline.profit_usd}
            loadFactor={whatIf.baseline.demand.load_factor}
            marketShare={whatIf.baseline.market_share.pacific_wings_share}
          />
        ))}
      </div>

      <div className="mt-4">
        <ProfitByRouteChart data={chartData} />
      </div>
    </div>
  );
}
