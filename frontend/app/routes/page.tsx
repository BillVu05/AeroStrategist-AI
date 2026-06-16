"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getDemandForecast, getMarketContext, getRoutes, getWhatIf } from "@/lib/api";
import type { MarketContext, RouteInfo, RoutesResponse, WhatIfResponse } from "@/lib/types";
import { DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import RouteDetailsPanel from "@/components/RouteDetailsPanel";
import BoardroomRecommendation from "@/components/BoardroomRecommendation";
import RiskMatrixPanel from "@/components/RiskMatrixPanel";
import RouteProfitabilityTable, { type ProfitabilityRow } from "@/components/RouteProfitabilityTable";
import MiniBarPanel from "@/components/MiniBarPanel";
import CompetitorMatrix from "@/components/CompetitorMatrix";

const RouteMap = dynamic(() => import("@/components/RouteMap"), { ssr: false });

const CANDIDATE_DESTINATION = "DAD";

const PREVIOUS_MONTH = DEFAULT_MONTH === 1 ? 12 : DEFAULT_MONTH - 1;
const PREVIOUS_YEAR = DEFAULT_MONTH === 1 ? DEFAULT_YEAR - 1 : DEFAULT_YEAR;

interface BaseData {
  routesData: RoutesResponse;
  rows: ProfitabilityRow[];
  candidate: { whatIf: WhatIfResponse; market: MarketContext } | null;
}

interface SelectedData {
  market: MarketContext;
  demandSeries: { label: string; value: number }[];
}

function csvEscape(value: string | number) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: ProfitabilityRow[]) {
  const header = ["destination", "destination_name", "status", "passengers_carried", "revenue_usd", "profit_usd", "load_factor", "market_share"];
  const lines = [header.join(",")];
  for (const { route, whatIf } of rows) {
    lines.push(
      [
        route.destination,
        csvEscape(route.destination_name),
        route.status,
        whatIf.baseline.demand.passengers_carried,
        whatIf.baseline.revenue.total_revenue_usd.toFixed(2),
        whatIf.baseline.profit_usd.toFixed(2),
        whatIf.baseline.demand.load_factor.toFixed(4),
        whatIf.baseline.market_share.pacific_wings_share.toFixed(4),
      ].join(",")
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `route_profitability_${DEFAULT_YEAR}_${DEFAULT_MONTH}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RouteExplorerPage() {
  const [base, setBase] = useState<BaseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedData, setSelectedData] = useState<SelectedData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const routesData = await getRoutes();

        const rows: ProfitabilityRow[] = await Promise.all(
          routesData.routes.map(async (route) => {
            const [whatIf, prevWhatIf] = await Promise.all([
              getWhatIf({ destination: route.destination, year: DEFAULT_YEAR, month: DEFAULT_MONTH }),
              getWhatIf({ destination: route.destination, year: PREVIOUS_YEAR, month: PREVIOUS_MONTH }),
            ]);
            return { route, whatIf, previousPassengers: prevWhatIf.baseline.demand.passengers_carried };
          })
        );

        let candidate: BaseData["candidate"] = null;
        const candidateRow = rows.find((r) => r.route.destination === CANDIDATE_DESTINATION);
        if (candidateRow) {
          const market = await getMarketContext(CANDIDATE_DESTINATION, DEFAULT_YEAR);
          candidate = { whatIf: candidateRow.whatIf, market };
        }

        if (!cancelled) {
          setBase({ routesData, rows, candidate });
          setSelected(routesData.routes[0]?.destination ?? null);
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

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;

    async function loadSelected() {
      try {
        const [market, ...demandMonths] = await Promise.all([
          getMarketContext(selected!, DEFAULT_YEAR),
          ...Array.from({ length: 12 }, (_, i) =>
            getDemandForecast({ destination: selected!, year: DEFAULT_YEAR, month: i + 1 })
          ),
        ]);

        const demandSeries = demandMonths.map((m, i) => ({
          label: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i],
          value: m.predicted_passengers,
        }));

        if (!cancelled) setSelectedData({ market, demandSeries });
      } catch {
        if (!cancelled) setSelectedData(null);
      }
    }

    loadSelected();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (error) return <ErrorMessage message={error} />;
  if (!base) return <LoadingSpinner />;

  const { routesData, rows, candidate } = base;
  const selectedRoute = routesData.routes.find((r: RouteInfo) => r.destination === selected) ?? null;
  const selectedRow = rows.find((r) => r.route.destination === selected) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-end justify-between gap-4 md:flex-row">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">
            Route Intelligence <span className="text-tertiary">&amp; Strategy</span>
          </h1>
          <p className="text-sm text-on-surface-variant">
            Pacific Wings network — {DEFAULT_YEAR}/{DEFAULT_MONTH.toString().padStart(2, "0")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded border border-tertiary/20 bg-tertiary/10 px-3 py-1.5">
            <span className="agent-pulse h-1.5 w-1.5 rounded-full bg-tertiary" />
            <span className="font-label text-[10px] uppercase tracking-widest text-tertiary">84% Confidence</span>
          </div>
          <button
            type="button"
            onClick={() => downloadCsv(rows)}
            className="glass-panel flex items-center gap-2 rounded px-4 py-2 text-sm text-on-surface transition-colors hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Export Report
          </button>
          <Link
            href="/reports"
            className="glass-panel flex items-center gap-2 rounded px-4 py-2 text-sm text-on-surface transition-colors hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            New Scenario
          </Link>
          <Link
            href="/copilot"
            className="flex items-center gap-2 rounded bg-accent-blue px-4 py-2 text-sm text-white shadow-lg transition-colors hover:bg-blue-700"
          >
            <span className="material-symbols-outlined text-[18px]">smart_toy</span>
            Ask AI Agents
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        <div className="md:w-2/3">
          <RouteMap origin={routesData.origin} routes={routesData.routes} selected={selected} onSelect={setSelected} />
        </div>
        <div className="md:w-1/3">
          <RouteDetailsPanel route={selectedRoute} origin={routesData.origin} />
        </div>
      </div>

      {candidate && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <BoardroomRecommendation
              destination={CANDIDATE_DESTINATION}
              destinationCity={candidate.market.destination_city}
              whatIf={candidate.whatIf}
              market={candidate.market}
            />
          </div>
          <div className="lg:col-span-4">
            {selectedData && selectedRow ? (
              <RiskMatrixPanel
                destination={selected ?? CANDIDATE_DESTINATION}
                fuelPriceUsdPerGallon={selectedRow.whatIf.baseline.cost.fuel_price_usd_per_gallon}
                gdpGrowthPct={selectedData.market.gdp_growth_pct}
                loadFactor={selectedRow.whatIf.baseline.demand.load_factor}
              />
            ) : (
              <LoadingSpinner />
            )}
          </div>
        </div>
      )}

      <RouteProfitabilityTable rows={rows} selected={selected} onSelect={setSelected} />

      {selected && selectedRow && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {selectedData ? (
            <>
              <MiniBarPanel
                title={`Passenger forecast · ${selected}`}
                icon="trending_up"
                data={selectedData.demandSeries}
              />
              <CompetitorMatrix destination={selected} market={selectedData.market} whatIf={selectedRow.whatIf} />
            </>
          ) : (
            <LoadingSpinner />
          )}
        </div>
      )}
    </div>
  );
}
