"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDemandForecast, getMarketContext, getRoutes, getWhatIf } from "@/lib/api";
import type { DemandForecastResponse, MarketContext, RouteInfo } from "@/lib/types";
import { DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import MarketShareLeaderboard, { type MarketRow } from "@/components/MarketShareLeaderboard";
import DemandDriversPanel from "@/components/DemandDriversPanel";
import TrendLinePanel from "@/components/TrendLinePanel";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Rolling forecast horizon: current month + the 11 that follow.
const HORIZON = Array.from({ length: 12 }, (_, i) => {
  const m0 = DEFAULT_MONTH - 1 + i;
  const year = DEFAULT_YEAR + Math.floor(m0 / 12);
  const month = (m0 % 12) + 1;
  return { year, month, label: `${MONTH_LABELS[m0 % 12]} '${String(year).slice(2)}` };
});

interface Signal {
  route: RouteInfo;
  competitor: string;
  frequency: number;
  fare: number;
  rating: number;
  pressure: boolean;
}

interface MarketDemandData {
  marketRows: MarketRow[];
  signals: Signal[];
  driversMarket: MarketContext;
  avgConfidencePct: number;
}

interface ForecastData {
  paxSeries: { label: string; value: number }[];
  annualPax: number;
  peakMonth: { label: string; value: number };
  avgLoadFactor: number;
}

function fmtPax(value: number) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

export default function MarketDemandPage() {
  const [data, setData] = useState<MarketDemandData | null>(null);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const routesData = await getRoutes();
        const activeRoutes = routesData.routes.filter((r) => r.status === "active");

        const perRoute = await Promise.all(
          routesData.routes.map(async (route) => {
            const [whatIf, market, demand] = await Promise.all([
              getWhatIf({ destination: route.destination, year: DEFAULT_YEAR, month: DEFAULT_MONTH }),
              getMarketContext(route.destination, DEFAULT_YEAR),
              getDemandForecast({ destination: route.destination, year: DEFAULT_YEAR, month: DEFAULT_MONTH }),
            ]);
            return { route, whatIf, market, demand };
          })
        );

        const marketRows: MarketRow[] = perRoute.map(({ route, whatIf, market }) => ({ route, whatIf, market }));

        const signals: Signal[] = perRoute
          .flatMap(({ route, market }) =>
            market.competitors.map((c) => ({
              route,
              competitor: c.name,
              frequency: c.weekly_frequency,
              fare: c.avg_fare_usd,
              rating: c.rating,
              pressure: market.competitors.length > 2,
            }))
          )
          .sort((a, b) => b.frequency - a.frequency)
          .slice(0, 6);

        // Demand drivers for the busiest market by predicted passengers.
        const busiest = perRoute.reduce((best, r) =>
          r.demand.predicted_passengers > best.demand.predicted_passengers ? r : best
        );

        const avgConfidencePct =
          perRoute.reduce((sum, r) => sum + r.demand.confidence_pct, 0) / perRoute.length;

        if (!cancelled) {
          setData({ marketRows, signals, driversMarket: busiest.market, avgConfidencePct });
        }

        // 12-month network forecast (active routes x 12 slow model calls) -
        // loaded after the fast sections so it doesn't block the whole page.
        const yearlyForecasts: DemandForecastResponse[][] = await Promise.all(
          activeRoutes.map((route) =>
            Promise.all(
              HORIZON.map((h) =>
                getDemandForecast({ destination: route.destination, year: h.year, month: h.month })
              )
            )
          )
        );

        const paxSeries = HORIZON.map((h, i) => ({
          label: h.label,
          value: yearlyForecasts.reduce((sum, months) => sum + months[i].predicted_passengers, 0),
        }));
        const avgLoadFactor =
          yearlyForecasts.reduce(
            (sum, months) => sum + months.reduce((s, m) => s + m.predicted_load_factor, 0) / months.length,
            0
          ) / yearlyForecasts.length;

        const annualPax = paxSeries.reduce((sum, m) => sum + m.value, 0);
        const peakMonth = paxSeries.reduce((best, m) => (m.value > best.value ? m : best));

        if (!cancelled) {
          setForecast({ paxSeries, annualPax, peakMonth, avgLoadFactor });
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

  const { marketRows, signals, driversMarket, avgConfidencePct } = data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-on-surface">
          Market <span className="text-tertiary">&amp; Demand Intelligence</span>
        </h1>
        <p className="text-sm text-on-surface-variant">
          Competitive landscape and demand outlook — {DEFAULT_YEAR}/{DEFAULT_MONTH.toString().padStart(2, "0")}
        </p>
      </div>

      {/* Market share leaderboard */}
      <MarketShareLeaderboard rows={marketRows} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Competitor signals feed */}
        <div className="glass-panel flex flex-col rounded-2xl lg:col-span-7">
          <div className="flex items-center justify-between border-b border-white/10 p-4">
            <h3 className="flex items-center gap-3 text-lg font-semibold text-on-surface">
              <span className="material-symbols-outlined text-tertiary">rss_feed</span>
              Competitor Signals Feed
            </h3>
            <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant/40">
              {signals.length} signals
            </span>
          </div>
          <div className="flex-1 space-y-5 p-4">
            {signals.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No competitor data available.</p>
            ) : (
              signals.map((s, i) => (
                <div key={i} className="group flex gap-4">
                  <div
                    className={`w-1 self-stretch rounded-full opacity-40 transition-opacity group-hover:opacity-100 ${
                      s.pressure ? "bg-error" : "bg-tertiary"
                    }`}
                  />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-label text-[11px] uppercase text-tertiary">{s.competitor}</span>
                      <span className="font-label text-[10px] text-on-surface-variant/60">
                        SYD → {s.route.destination} · {s.route.destination_city}
                      </span>
                    </div>
                    <p className="text-sm text-on-surface transition-colors group-hover:text-white">
                      Operating {s.frequency}×/week at ${s.fare.toFixed(0)} average fare ({s.rating.toFixed(1)}★
                      service rating).
                    </p>
                    <div className="flex gap-2 pt-1">
                      <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 font-label text-[10px] text-on-surface-variant">
                        {s.route.destination} corridor
                      </span>
                      {s.pressure && (
                        <span className="rounded border border-error/20 bg-error-container/20 px-2 py-0.5 font-label text-[10px] text-error">
                          Contested market
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-white/5 bg-white/[0.02] p-3 text-center">
            <Link
              href="/routes"
              className="font-label text-[11px] uppercase tracking-widest text-on-surface-variant transition-colors hover:text-tertiary"
            >
              View deep-dive in Route Explorer →
            </Link>
          </div>
        </div>

        {/* Demand driver breakdown */}
        <div className="lg:col-span-5">
          <DemandDriversPanel market={driversMarket} />
        </div>
      </div>

      {/* 12-month demand forecast */}
      <section className="glass-panel rounded-2xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-on-surface">12-Month Demand Forecast</h3>
            <p className="text-sm text-on-surface-variant">
              Predicted network passenger volume, {HORIZON[0].label} – {HORIZON[11].label} (active routes)
            </p>
          </div>
        </div>
        {forecast ? (
          <>
            <TrendLinePanel
              title="Network demand · next 12 months"
              icon="trending_up"
              data={forecast.paxSeries}
              formatValue={fmtPax}
            />
            <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="space-y-1">
                <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Peak Month</p>
                <p className="text-lg font-bold text-on-surface">{forecast.peakMonth.label}</p>
                <p className="font-label text-[10px] text-tertiary">{fmtPax(forecast.peakMonth.value)} passengers</p>
              </div>
              <div className="space-y-1">
                <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Annual Passengers
                </p>
                <p className="text-lg font-bold text-on-surface">{fmtPax(forecast.annualPax)}</p>
                <p className="font-label text-[10px] text-on-surface-variant/60">Sum of monthly forecasts</p>
              </div>
              <div className="space-y-1">
                <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Est. Load Factor
                </p>
                <p className="text-lg font-bold text-on-surface">{(forecast.avgLoadFactor * 100).toFixed(1)}%</p>
                <p className="font-label text-[10px] text-on-surface-variant/60">Network yearly average</p>
              </div>
              <div className="space-y-1">
                <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Model Confidence
                </p>
                <p className="text-lg font-bold text-on-surface">{avgConfidencePct.toFixed(0)}%</p>
                <p className="font-label text-[10px] text-on-surface-variant/60">Avg across current-month forecasts</p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-10">
            <LoadingSpinner />
            <p className="font-label text-[10px] text-on-surface-variant/60">
              Running 12-month demand model for every active route…
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
