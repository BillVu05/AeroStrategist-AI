"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getMonteCarlo,
  getNetworkFutureAnalysis,
  getRoutes,
  getWhatIf,
  getWhatIfPresets,
} from "@/lib/api";
import type {
  MonteCarloResponse,
  NetworkFutureAnalysisResponse,
  RouteInfo,
  ScenarioInput,
  WhatIfPresets,
  WhatIfResponse,
} from "@/lib/types";
import { ALL_DESTINATIONS, DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import ScenarioForm from "@/components/ScenarioForm";
import ComparisonCards from "@/components/ComparisonCards";
import ComparisonCharts from "@/components/ComparisonCharts";
import MarketShareChart from "@/components/MarketShareChart";
import MonteCarloPanel from "@/components/MonteCarloPanel";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";

type Tab = "whatif" | "stress" | "longrange";

const TABS: { id: Tab; label: string }[] = [
  { id: "whatif", label: "What-if Analysis" },
  { id: "stress", label: "Stress Test" },
  { id: "longrange", label: "Long-range Projection" },
];

function fmtUsd(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPax(v: number) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

export default function ScenarioLabPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ScenarioLabInner />
    </Suspense>
  );
}

function ScenarioLabInner() {
  const presetDest = useSearchParams().get("dest");
  const initialDestination =
    presetDest && (ALL_DESTINATIONS as readonly string[]).includes(presetDest) ? presetDest : ALL_DESTINATIONS[0];

  const [tab, setTab] = useState<Tab>("whatif");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-on-surface">Scenario Lab</h1>
        <p className="text-sm text-on-surface-variant">
          What-if simulation, stress testing and long-range projection — the single place inputs change and
          outcomes are modeled.
        </p>
      </div>

      <div className="flex gap-8 border-b border-white/5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-2 pb-3 text-[15px] font-semibold transition-all ${
              tab === t.id
                ? "border-b-2 border-tertiary text-tertiary"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "whatif" && <WhatIfTab initialDestination={initialDestination} />}
      {tab === "stress" && <StressTestTab initialDestination={initialDestination} />}
      {tab === "longrange" && <LongRangeTab />}
    </div>
  );
}

// ── What-if (from the old /simulator page) ───────────────────────────────────

function WhatIfTab({ initialDestination }: { initialDestination: string }) {
  const [presets, setPresets] = useState<WhatIfPresets>({});
  const [input, setInput] = useState<ScenarioInput>({
    destination: initialDestination,
    year: DEFAULT_YEAR,
    month: DEFAULT_MONTH,
  });
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWhatIfPresets()
      .then(setPresets)
      .catch((err) => setError(err.message));
  }, []);

  async function runScenario() {
    setLoading(true);
    setError(null);
    try {
      const res = await getWhatIf(input);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <ScenarioForm
        value={input}
        onChange={setInput}
        presets={presets}
        onSubmit={runScenario}
        loading={loading}
        submitLabel="Run Simulation"
      />

      {error && (
        <div className="mt-4">
          <ErrorMessage message={error} />
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          {result.preset && (
            <div className="rounded-lg border border-tertiary/20 bg-tertiary/10 p-3 text-sm text-tertiary">
              <span className="font-medium">{result.preset.label}</span> — {result.preset.description}
            </div>
          )}

          <ComparisonCards baseline={result.baseline} scenario={result.scenario} delta={result.delta} />
          <ComparisonCharts baseline={result.baseline} scenario={result.scenario} />
          <MarketShareChart baseline={result.baseline.market_share} scenario={result.scenario.market_share} />
          <MonteCarloPanel input={input} />
        </div>
      )}
    </div>
  );
}

// ── Stress Test (from the old /risk page) ────────────────────────────────────

type StressScenario = "oil_price_surge" | "regional_conflict" | "pandemic" | "recession";

const STRESS_SCENARIOS: { value: StressScenario; label: string; icon: string }[] = [
  { value: "oil_price_surge", label: "Oil Price Surge", icon: "local_gas_station" },
  { value: "regional_conflict", label: "Regional Conflict", icon: "gpp_maybe" },
  { value: "pandemic", label: "Pandemic", icon: "coronavirus" },
  { value: "recession", label: "Recession", icon: "trending_down" },
];

interface StressResult {
  result: MonteCarloResponse;
  baselineProfit: number;
  scenario: StressScenario;
  severity: number;
  duration: number;
}

function StressTestTab({ initialDestination }: { initialDestination: string }) {
  const [routes, setRoutes] = useState<RouteInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stressRoute, setStressRoute] = useState<string>("");
  const [stressScenario, setStressScenario] = useState<StressScenario>("oil_price_surge");
  const [stressSeverity, setStressSeverity] = useState(5);
  const [stressDuration, setStressDuration] = useState(6);
  const [stress, setStress] = useState<StressResult | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRoutes()
      .then((data) => {
        if (cancelled) return;
        const active = data.routes.filter((r) => r.status === "active");
        setRoutes(active);
        setStressRoute(
          active.some((r) => r.destination === initialDestination)
            ? initialDestination
            : active[0]?.destination ?? ""
        );
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [initialDestination]);

  async function runStressTest() {
    if (!stressRoute) return;
    setRunning(true);
    setStress(null);
    setError(null);
    try {
      const baseline = await getWhatIf({ destination: stressRoute, year: DEFAULT_YEAR, month: DEFAULT_MONTH });
      const baseFuel = baseline.baseline.cost.fuel_price_usd_per_gallon;
      // Illustrative severity-to-shock mapping (not fitted to real data) -
      // shifts the real Monte Carlo fuel-price/fare assumptions to represent
      // each scenario type, then lets the real fuel/GDP/competitor sampling
      // (simulation/monte_carlo.py) produce the outcome distribution around
      // that shock, instead of a single deterministic point estimate.
      let params: { price_delta_pct?: number; fuel_price_center?: number } = {};
      switch (stressScenario) {
        case "oil_price_surge":
          params = { fuel_price_center: baseFuel * (1 + stressSeverity * 0.07) };
          break;
        case "regional_conflict":
          params = {
            price_delta_pct: -(stressSeverity * 0.04),
            fuel_price_center: baseFuel * (1 + stressSeverity * 0.03),
          };
          break;
        case "pandemic":
          params = { price_delta_pct: -(stressSeverity * 0.07) };
          break;
        case "recession":
          params = { price_delta_pct: -(stressSeverity * 0.03) };
          break;
      }
      const result = await getMonteCarlo({
        destination: stressRoute,
        year: DEFAULT_YEAR,
        month: DEFAULT_MONTH,
        n_simulations: 500,
        ...params,
      });
      setStress({
        result,
        baselineProfit: baseline.baseline.profit_usd,
        scenario: stressScenario,
        severity: stressSeverity,
        duration: stressDuration,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  if (error && !routes) return <ErrorMessage message={error} />;
  if (!routes) return <LoadingSpinner />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Stress injector */}
      <div className="lg:col-span-4">
        <div className="glass-panel rounded-2xl border-error/20 p-6">
          <h3 className="mb-6 flex items-center gap-2 text-lg font-semibold text-error">
            <span className="material-symbols-outlined">warning</span>
            Stress Injector
          </h3>
          <div className="space-y-6">
            <div>
              <label className="mb-3 block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                Event Type
              </label>
              <div className="grid grid-cols-1 gap-2">
                {STRESS_SCENARIOS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => {
                      setStressScenario(s.value);
                      setStress(null);
                    }}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left text-sm transition-all ${
                      stressScenario === s.value
                        ? "border-error/30 bg-error-container/20 text-error"
                        : "border-white/10 bg-white/5 text-on-surface hover:bg-white/10"
                    }`}
                  >
                    <span className="material-symbols-outlined">{s.icon}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                Route
              </label>
              <select
                value={stressRoute}
                onChange={(e) => {
                  setStressRoute(e.target.value);
                  setStress(null);
                }}
                className="w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-on-surface focus:border-tertiary focus:outline-none"
              >
                {routes.map((r) => (
                  <option key={r.destination} value={r.destination}>
                    SYD → {r.destination} ({r.destination_city})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-2 flex justify-between">
                <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Severity
                </span>
                <span className="font-label text-xs font-bold text-error">{stressSeverity}/10</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={stressSeverity}
                onChange={(e) => {
                  setStressSeverity(Number(e.target.value));
                  setStress(null);
                }}
                className="w-full"
              />
            </div>
            <div>
              <div className="mb-2 flex justify-between">
                <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Duration (months)
                </span>
                <span className="font-label text-xs text-on-surface">{stressDuration}</span>
              </div>
              <input
                type="range"
                min={1}
                max={24}
                value={stressDuration}
                onChange={(e) => setStressDuration(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <button
              type="button"
              onClick={runStressTest}
              disabled={running}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">bolt</span>
              {running ? "Running 500 simulations…" : "Run Stress Test"}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="space-y-4 lg:col-span-8">
        {error && <ErrorMessage message={error} />}
        {!stress && !running && (
          <div className="glass-panel flex h-64 flex-col items-center justify-center gap-3 rounded-2xl text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/40">query_stats</span>
            <p className="max-w-sm text-sm text-on-surface-variant">
              Configure an adverse event and run the stress test to see the Monte Carlo profit distribution
              under shock conditions.
            </p>
          </div>
        )}
        {running && <LoadingSpinner />}
        {stress &&
          (() => {
            const medianProfit = stress.result.profit_usd.p50;
            const profitImpactPct =
              stress.baselineProfit !== 0
                ? ((medianProfit - stress.baselineProfit) / Math.abs(stress.baselineProfit)) * 100
                : 0;
            const scenLabel = STRESS_SCENARIOS.find((s) => s.value === stress.scenario)?.label ?? "";
            const negative = profitImpactPct < 0;
            return (
              <>
                <div className="glass-panel rounded-2xl p-6">
                  <div className="mb-6 flex items-center justify-between">
                    <h4 className="font-label text-[11px] uppercase tracking-widest text-on-surface-variant">
                      Shock outcome · SYD → {stress.result.destination}
                    </h4>
                    <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant/60">
                      {scenLabel} · Severity {stress.severity}/10 · {stress.duration}mo horizon assumed ·{" "}
                      {stress.result.n_simulations} simulations
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div
                      className={`glass-panel rounded-2xl p-6 ${
                        negative ? "border-error/10 bg-error-container/5" : "border-tertiary/10 bg-tertiary/5"
                      }`}
                    >
                      <p
                        className={`mb-2 font-label text-[10px] uppercase tracking-widest ${
                          negative ? "text-error" : "text-tertiary"
                        }`}
                      >
                        Median Profit Impact
                      </p>
                      <p className={`text-[28px] font-bold ${negative ? "text-error" : "text-tertiary"}`}>
                        {profitImpactPct >= 0 ? "+" : ""}
                        {profitImpactPct.toFixed(1)}%
                      </p>
                      <p className="mt-1 font-label text-[10px] text-on-surface-variant">
                        {fmtUsd(stress.baselineProfit)} → {fmtUsd(medianProfit)} / month
                      </p>
                    </div>
                    <div className="glass-panel rounded-2xl p-6">
                      <p className="mb-2 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                        P10 – P90 Profit Corridor
                      </p>
                      <p className="text-[22px] font-bold text-on-surface">
                        {fmtUsd(stress.result.profit_usd.p10)}
                        <span className="mx-1 text-on-surface-variant">–</span>
                        {fmtUsd(stress.result.profit_usd.p90)}
                      </p>
                      <p className="mt-1 font-label text-[10px] text-on-surface-variant">Monthly, under shock</p>
                    </div>
                    <div className="glass-panel rounded-2xl p-6">
                      <p className="mb-2 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                        Probability of Loss
                      </p>
                      <p
                        className={`text-[28px] font-bold ${
                          stress.result.probability_of_loss > 0.2 ? "text-error" : "text-tertiary"
                        }`}
                      >
                        {(stress.result.probability_of_loss * 100).toFixed(1)}%
                      </p>
                      <p className="mt-1 font-label text-[10px] text-on-surface-variant">
                        Share of simulations ending unprofitable
                      </p>
                    </div>
                  </div>
                </div>

                {/* Histogram of simulated profit */}
                <div className="glass-panel rounded-2xl p-6">
                  <h4 className="mb-4 font-label text-[11px] uppercase tracking-widest text-on-surface-variant">
                    Simulated Profit Distribution
                  </h4>
                  <div className="flex h-32 items-end gap-1">
                    {stress.result.profit_histogram.counts.map((count, i) => {
                      const max = Math.max(...stress.result.profit_histogram.counts);
                      const edge = stress.result.profit_histogram.bin_edges[i];
                      return (
                        <div
                          key={i}
                          className={`flex-1 rounded-t ${edge < 0 ? "bg-error/60" : "bg-tertiary/60"}`}
                          style={{ height: `${max > 0 ? (count / max) * 100 : 0}%` }}
                          title={`${fmtUsd(edge)}: ${count}`}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-2 flex justify-between font-label text-[9px] text-on-surface-variant/60">
                    <span>{fmtUsd(stress.result.profit_histogram.bin_edges[0])}</span>
                    <span>
                      {fmtUsd(
                        stress.result.profit_histogram.bin_edges[
                          stress.result.profit_histogram.bin_edges.length - 1
                        ]
                      )}
                    </span>
                  </div>
                </div>
              </>
            );
          })()}
      </div>
    </div>
  );
}

// ── Long-range Projection (from the old /future page) ───────────────────────

const HORIZON_YEARS = 4;

function LongRangeTab() {
  const [network, setNetwork] = useState<NetworkFutureAnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNetworkFutureAnalysis(DEFAULT_YEAR, DEFAULT_YEAR + HORIZON_YEARS)
      .then((res) => !cancelled && setNetwork(res))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorMessage message={error} />;
  if (!network) return <LoadingSpinner />;

  const cagrs = network.routes.map((r) => r.passenger_cagr_pct).filter((v): v is number => v !== null);
  const avgCagr = cagrs.length > 0 ? cagrs.reduce((a, b) => a + b, 0) / cagrs.length : null;

  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-2xl p-6">
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h4 className="text-lg font-semibold text-tertiary">
              {HORIZON_YEARS + 1}-Year Strategic Projection ({network.from_year}–{network.to_year})
            </h4>
            <p className="text-sm text-on-surface-variant">
              Demand-model projection across the network, macro trends applied per market
            </p>
          </div>
          {avgCagr !== null && (
            <div className="text-right">
              <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                Avg Passenger CAGR
              </p>
              <p className="text-lg font-bold text-tertiary">
                {avgCagr >= 0 ? "+" : ""}
                {avgCagr.toFixed(1)}%
              </p>
            </div>
          )}
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-white/[0.02] p-6">
            <div className="mb-2 flex items-start justify-between">
              <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                Projected Revenue
              </span>
              <span className="material-symbols-outlined text-tertiary">account_balance_wallet</span>
            </div>
            <p className="text-2xl font-bold text-on-surface">
              {fmtUsd(network.active_network_totals.projected_revenue_usd)}
            </p>
            <p className="mt-1 font-label text-[10px] text-on-surface-variant/60">Active network, cumulative over horizon</p>
          </div>
          <div className="rounded-xl bg-white/[0.02] p-6">
            <div className="mb-2 flex items-start justify-between">
              <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                Projected Profit
              </span>
              <span className="material-symbols-outlined text-secondary">payments</span>
            </div>
            <p
              className={`text-2xl font-bold ${
                network.active_network_totals.projected_profit_usd >= 0 ? "text-on-surface" : "text-error"
              }`}
            >
              {fmtUsd(network.active_network_totals.projected_profit_usd)}
            </p>
            <p className="mt-1 font-label text-[10px] text-on-surface-variant/60">Active network, cumulative over horizon</p>
          </div>
          <div className="rounded-xl bg-white/[0.02] p-6">
            <div className="mb-2 flex items-start justify-between">
              <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                Projected Passengers
              </span>
              <span className="material-symbols-outlined text-tertiary">groups</span>
            </div>
            <p className="text-2xl font-bold text-on-surface">
              {fmtPax(network.active_network_totals.projected_passengers)}
            </p>
            <p className="mt-1 font-label text-[10px] text-on-surface-variant/60">Active network, cumulative over horizon</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-white/5 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                <th className="px-4 py-3 font-semibold">Route</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Pax CAGR</th>
                <th className="px-4 py-3 text-right font-semibold">
                  Pax {network.from_year} → {network.to_year}
                </th>
                <th className="px-4 py-3 text-right font-semibold">End Load Factor</th>
                <th className="px-4 py-3 text-right font-semibold">Cumul. Profit</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {network.routes.map((r) => (
                <tr key={r.destination} className="border-b border-white/5 transition-colors hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="font-bold text-on-surface">SYD → {r.destination}</div>
                    <div className="font-label text-[10px] text-on-surface-variant/60">{r.destination_city}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded border px-2 py-0.5 font-label text-[10px] ${
                        r.status === "active"
                          ? "border-tertiary/20 bg-tertiary/10 text-tertiary"
                          : "border-secondary/20 bg-secondary/10 text-secondary"
                      }`}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-bold ${
                      (r.passenger_cagr_pct ?? 0) >= 0 ? "text-tertiary" : "text-error"
                    }`}
                  >
                    {r.passenger_cagr_pct !== null
                      ? `${r.passenger_cagr_pct >= 0 ? "+" : ""}${r.passenger_cagr_pct.toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-on-surface">
                    {fmtPax(r.start_year_passengers)} → {fmtPax(r.end_year_passengers)}
                  </td>
                  <td className="px-4 py-3 text-right text-on-surface">
                    {(r.end_year_load_factor * 100).toFixed(1)}%
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-bold ${
                      r.total_projected_profit_usd >= 0 ? "text-on-surface" : "text-error"
                    }`}
                  >
                    {fmtUsd(r.total_projected_profit_usd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
