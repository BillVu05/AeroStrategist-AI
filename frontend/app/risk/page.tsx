"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMarketContext, getMonteCarlo, getRoutes, getWhatIf } from "@/lib/api";
import type { MarketContext, MonteCarloResponse, RouteInfo, WhatIfResponse } from "@/lib/types";
import { DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import KpiCard from "@/components/KpiCard";

type RiskStatus = "STABLE" | "MONITOR" | "CRITICAL";
type StressScenario = "oil_price_surge" | "regional_conflict" | "pandemic" | "recession";

const STRESS_SCENARIOS: { value: StressScenario; label: string }[] = [
  { value: "oil_price_surge",  label: "Oil Price Surge"   },
  { value: "regional_conflict", label: "Regional Conflict" },
  { value: "pandemic",         label: "Pandemic"          },
  { value: "recession",        label: "Recession"         },
];

interface RouteRisk {
  route: RouteInfo;
  whatIf: WhatIfResponse;
  market: MarketContext;
  fuelRisk: number;
  competitorRisk: number;
  economicRisk: number;
  capacityRisk: number;
  totalCoefficient: number;
  status: RiskStatus;
}

interface StressResult {
  result: MonteCarloResponse;
  baselineProfit: number;
  scenario: StressScenario;
  severity: number;
}

function computeRouteRisk(route: RouteInfo, whatIf: WhatIfResponse, market: MarketContext): RouteRisk {
  const fuelPrice = whatIf.baseline.cost.fuel_price_usd_per_gallon;
  const fuelRisk = Math.min(1, Math.max(0, (fuelPrice - 1) / 5));

  const ourFreq = route.weekly_frequency;
  const totalCompFreq = market.competitors.reduce((sum, c) => sum + c.weekly_frequency, 0);
  const competitorRisk = Math.min(1, totalCompFreq / Math.max(1, ourFreq + totalCompFreq));

  const economicRisk = Math.min(1, Math.max(0, 1 - market.gdp_growth_pct / 10));

  const lf = whatIf.baseline.demand.load_factor;
  const capacityRisk = lf > 0.9 ? 1 : lf > 0.75 ? 0.5 : 0.2;

  const total = fuelRisk * 0.35 + competitorRisk * 0.30 + economicRisk * 0.20 + capacityRisk * 0.15;
  const status: RiskStatus = total > 0.65 ? "CRITICAL" : total > 0.40 ? "MONITOR" : "STABLE";

  return { route, whatIf, market, fuelRisk, competitorRisk, economicRisk, capacityRisk, totalCoefficient: total, status };
}

function fmtUsd(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

const STATUS_STYLE: Record<RiskStatus, string> = {
  STABLE: "border-tertiary/20 bg-tertiary/10 text-tertiary",
  MONITOR: "border-secondary/20 bg-secondary/10 text-secondary",
  CRITICAL: "border-error/20 bg-error/10 text-error",
};

function RiskBar({ value, label }: { value: number; label: string }) {
  const isHigh = value > 0.65;
  const isMid = value > 0.40;
  return (
    <div className="space-y-1">
      <div className="flex justify-between font-label text-[10px] uppercase tracking-wider">
        <span className="text-on-surface-variant">{label}</span>
        <span className={isHigh ? "text-error" : isMid ? "text-secondary" : "text-tertiary"}>
          {(value * 100).toFixed(0)}%
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full ${isHigh ? "bg-error" : isMid ? "bg-secondary" : "bg-tertiary"}`}
          style={{ width: `${value * 100}%` }}
        />
      </div>
    </div>
  );
}

export default function RiskIntelligencePage() {
  const [risks, setRisks] = useState<RouteRisk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stressRoute, setStressRoute] = useState<string>("");
  const [stressScenario, setStressScenario] = useState<StressScenario>("oil_price_surge");
  const [stressSeverity, setStressSeverity] = useState(5);
  const [stressDuration, setStressDuration] = useState(6);
  const [stress, setStress] = useState<StressResult | null>(null);
  const [runningStress, setRunningStress] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const routesData = await getRoutes();
        const active = routesData.routes.filter((r) => r.status === "active");

        const results = await Promise.all(
          active.map(async (route) => {
            const [whatIf, market] = await Promise.all([
              getWhatIf({ destination: route.destination, year: DEFAULT_YEAR, month: DEFAULT_MONTH }),
              getMarketContext(route.destination, DEFAULT_YEAR),
            ]);
            return computeRouteRisk(route, whatIf, market);
          })
        );

        if (!cancelled) {
          setRisks(results);
          if (!stressRoute && active.length > 0) setStressRoute(active[0].destination);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runStressTest() {
    if (!stressRoute || !risks) return;
    const base = risks.find((r) => r.route.destination === stressRoute);
    if (!base) return;

    setRunningStress(true);
    setStress(null);
    try {
      const baseFuel = base.whatIf.baseline.cost.fuel_price_usd_per_gallon;
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
        baselineProfit: base.whatIf.baseline.profit_usd,
        scenario: stressScenario,
        severity: stressSeverity,
      });
    } finally {
      setRunningStress(false);
    }
  }

  if (error) return <ErrorMessage message={error} />;
  if (!risks) return <LoadingSpinner />;

  const sorted = [...risks].sort((a, b) => b.totalCoefficient - a.totalCoefficient);
  const avgRisk = risks.reduce((s, r) => s + r.totalCoefficient, 0) / risks.length;
  const avgFuel = risks.reduce((s, r) => s + r.whatIf.baseline.cost.fuel_price_usd_per_gallon, 0) / risks.length;
  const avgLoadFactor = risks.reduce((s, r) => s + r.whatIf.baseline.demand.load_factor, 0) / risks.length;
  const avgEconRisk = risks.reduce((s, r) => s + r.economicRisk, 0) / risks.length;
  const criticalCount = risks.filter((r) => r.status === "CRITICAL").length;
  const monitorCount = risks.filter((r) => r.status === "MONITOR").length;
  const stableCount = risks.filter((r) => r.status === "STABLE").length;
  const topRisk = sorted[0];

  const overallLabel = avgRisk > 0.65 ? "HIGH RISK" : avgRisk > 0.40 ? "MODERATE" : "STABLE";
  const overallColor = avgRisk > 0.65 ? "text-error" : avgRisk > 0.40 ? "text-secondary" : "text-tertiary";

  const advisories: { icon: string; title: string; body: string; accent: string; action1?: string; action2?: string }[] = [
    ...(avgFuel > 3.5
      ? [
          {
            icon: "local_gas_station",
            title: "Fuel Hedge Recommended",
            body: `Avg fuel at $${avgFuel.toFixed(2)}/gal. Consider hedging 3-month forward contracts to lock in current rates and cap downside.`,
            accent: "border-secondary/20 bg-secondary/10",
            action1: `/copilot?q=${encodeURIComponent("Generate a fuel hedging strategy for Pacific Wings")}`,
            action2: "/reports",
          },
        ]
      : []),
    ...(criticalCount > 0
      ? [
          {
            icon: "warning",
            title: `${criticalCount} Critical Route${criticalCount > 1 ? "s" : ""}`,
            body: `${topRisk.route.destination} has the highest risk coefficient (${(topRisk.totalCoefficient * 100).toFixed(0)}%). Review pricing and capacity immediately.`,
            accent: "border-error/20 bg-error/10",
            action1: `/copilot?q=${encodeURIComponent(`Analyze critical risk on SYD-${topRisk.route.destination} and recommend mitigations`)}`,
            action2: "/reports",
          },
        ]
      : []),
    {
      icon: "speed",
      title: "Capacity Advisory",
      body:
        avgLoadFactor > 0.85
          ? `Network load factor at ${(avgLoadFactor * 100).toFixed(1)}%. Near capacity — consider adding frequency on high-demand routes before bookings spill to competitors.`
          : `Network load factor at ${(avgLoadFactor * 100).toFixed(1)}%. Room to grow — targeted frequency increases on top routes could capture market share.`,
      accent: "border-tertiary/20 bg-tertiary/10",
      action1: `/copilot?q=${encodeURIComponent("Optimize capacity allocation across Pacific Wings routes")}`,
      action2: "/routes",
    },
    {
      icon: "trending_up",
      title: "GDP Exposure",
      body: `Economic risk index ${(avgEconRisk * 100).toFixed(0)}%. ${avgEconRisk > 0.5 ? "Slow GDP growth in key markets — hedge revenue with ancillary offers." : "Healthy GDP tailwinds support leisure and business demand across the network."}`,
      accent: avgEconRisk > 0.5 ? "border-secondary/20 bg-secondary/10" : "border-tertiary/20 bg-tertiary/10",
      action2: "/market",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">
            Risk Intelligence <span className="text-tertiary">&amp; Strategic Threat Monitoring</span>
          </h1>
          <p className="text-sm text-on-surface-variant">
            Pacific Wings network — {DEFAULT_YEAR}/{DEFAULT_MONTH.toString().padStart(2, "0")}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              const data = JSON.stringify({ generated: new Date().toISOString(), network: "Pacific Wings" });
              const blob = new Blob([data], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `risk_briefing_${DEFAULT_YEAR}_${DEFAULT_MONTH}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="glass-panel flex items-center gap-2 rounded px-3 py-2 font-label text-xs text-on-surface transition-colors hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Export Briefing
          </button>
          <Link
            href="/copilot?q=Generate+a+risk+mitigation+report+for+the+Pacific+Wings+network"
            className="flex items-center gap-2 rounded bg-accent-blue px-3 py-2 font-label text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            <span className="material-symbols-outlined text-[16px]">shield</span>
            Generate Mitigation Report
          </Link>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <KpiCard
          icon="shield"
          label="Network Risk Score"
          value={`${(avgRisk * 100).toFixed(0)}/100`}
          delta={overallLabel}
          deltaClass={overallColor}
        />
        <KpiCard
          icon="trending_down"
          label="Economic Risk"
          value={`${(avgEconRisk * 100).toFixed(0)}%`}
          delta={avgEconRisk > 0.5 ? "ELEVATED" : "LOW"}
          deltaClass={avgEconRisk > 0.5 ? "text-error" : "text-tertiary"}
        />
        <KpiCard
          icon="local_gas_station"
          label="Avg Fuel Price"
          value={`$${avgFuel.toFixed(2)}/gal`}
          delta={avgFuel > 3.5 ? "ELEVATED" : "NOMINAL"}
          deltaClass={avgFuel > 3.5 ? "text-secondary" : "text-tertiary"}
        />
        <KpiCard
          icon="flight"
          label="Fleet Utilization"
          value={`${(avgLoadFactor * 100).toFixed(1)}%`}
          delta={avgLoadFactor > 0.9 ? "CAPACITY RISK" : "OPTIMAL"}
          deltaClass={avgLoadFactor > 0.9 ? "text-error" : "text-tertiary"}
        />
        <KpiCard
          icon="warning"
          label="Needs Attention"
          value={`${monitorCount + criticalCount}`}
          delta={criticalCount > 0 ? `${criticalCount} CRITICAL` : "ALL CLEAR"}
          deltaClass={criticalCount > 0 ? "text-error" : "text-tertiary"}
        />
        <KpiCard
          icon="check_circle"
          label="Stable Routes"
          value={`${stableCount}`}
          delta={`${risks.length} TOTAL`}
          deltaClass="text-tertiary"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="glass-panel overflow-hidden rounded-lg">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
              <h3 className="text-lg font-semibold text-primary">Route Risk Analysis</h3>
              <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                {risks.length} active routes
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead className="bg-black/20 font-label text-[10px] uppercase tracking-wider text-on-surface-variant">
                  <tr>
                    <th className="px-4 py-3 font-normal">Route</th>
                    <th className="px-4 py-3 font-normal">Fuel</th>
                    <th className="px-4 py-3 font-normal">Competitor</th>
                    <th className="px-4 py-3 font-normal">Economic</th>
                    <th className="px-4 py-3 font-normal">Capacity</th>
                    <th className="px-4 py-3 font-normal">Total Coeff.</th>
                    <th className="px-4 py-3 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm">
                  {sorted.map((r) => (
                    <tr key={r.route.destination} className="transition-colors hover:bg-white/5">
                      <td className="px-4 py-3">
                        <div className="font-bold text-on-surface">SYD → {r.route.destination}</div>
                        <div className="font-label text-[10px] text-on-surface-variant/60">
                          {r.route.destination_city}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-label text-[10px] text-on-surface">
                        {r.fuelRisk.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-label text-[10px] text-on-surface">
                        {r.competitorRisk.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-label text-[10px] text-on-surface">
                        {r.economicRisk.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-label text-[10px] text-on-surface">
                        {r.capacityRisk.toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-bold ${
                            r.totalCoefficient > 0.65
                              ? "text-error"
                              : r.totalCoefficient > 0.40
                              ? "text-secondary"
                              : "text-tertiary"
                          }`}
                        >
                          {r.totalCoefficient.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded border px-2 py-0.5 font-label text-[10px] ${STATUS_STYLE[r.status]}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass-panel rounded-lg">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
              <h4 className="font-label text-[10px] uppercase tracking-widest text-primary">
                Stress-Test Simulator
              </h4>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <label className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Scenario</label>
                <select
                  value={stressScenario}
                  onChange={(e) => { setStressScenario(e.target.value as StressScenario); setStress(null); }}
                  className="mt-1 w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-on-surface focus:border-tertiary focus:outline-none"
                >
                  {STRESS_SCENARIOS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Route</label>
                <select
                  value={stressRoute}
                  onChange={(e) => { setStressRoute(e.target.value); setStress(null); }}
                  className="mt-1 w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-on-surface focus:border-tertiary focus:outline-none"
                >
                  {risks.map((r) => (
                    <option key={r.route.destination} value={r.route.destination}>
                      SYD → {r.route.destination} ({r.route.destination_city})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                    Duration (months)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={stressDuration}
                    onChange={(e) => setStressDuration(Math.max(1, Math.min(24, Number(e.target.value))))}
                    className="mt-1 w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-on-surface focus:border-tertiary focus:outline-none"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                      Severity
                    </label>
                    <span className="font-label text-[10px] font-bold text-secondary">{stressSeverity}/10</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={stressSeverity}
                    onChange={(e) => { setStressSeverity(Number(e.target.value)); setStress(null); }}
                    className="mt-2 w-full"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={runStressTest}
                disabled={runningStress}
                className="flex w-full items-center justify-center gap-2 rounded bg-accent-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">bolt</span>
                {runningStress ? "Running…" : "Run Stress Test"}
              </button>

              {stress && (() => {
                const medianProfit = stress.result.profit_usd.p50;
                const baselineProfit = stress.baselineProfit;
                const profitImpactPct = baselineProfit !== 0 ? ((medianProfit - baselineProfit) / Math.abs(baselineProfit)) * 100 : 0;
                const scenLabel = STRESS_SCENARIOS.find((s) => s.value === stress.scenario)?.label ?? "";
                return (
                  <div className="space-y-3">
                    <div className={`rounded border p-3 ${profitImpactPct < 0 ? "border-error/20 bg-error/10" : "border-tertiary/20 bg-tertiary/10"}`}>
                      <div className="mb-2 font-label text-[10px] uppercase tracking-widest text-on-surface-variant/60">
                        {scenLabel} · Severity {stress.severity}/10 · {stressDuration}mo horizon assumed · {stress.result.n_simulations} simulations
                      </div>
                      <div className="text-center">
                        <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50">
                          Median Profit Impact %
                        </div>
                        <div className={`font-label text-xl font-bold ${profitImpactPct < 0 ? "text-error" : "text-tertiary"}`}>
                          {profitImpactPct >= 0 ? "+" : ""}{profitImpactPct.toFixed(1)}%
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/10 pt-2 text-center">
                        <div>
                          <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50">
                            P10 – P90 Profit
                          </div>
                          <div className="font-label text-xs font-bold text-on-surface">
                            {fmtUsd(stress.result.profit_usd.p10)} – {fmtUsd(stress.result.profit_usd.p90)}
                          </div>
                        </div>
                        <div>
                          <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50">
                            Probability of Loss
                          </div>
                          <div className={`font-label text-xs font-bold ${stress.result.probability_of_loss > 0.2 ? "text-error" : "text-tertiary"}`}>
                            {(stress.result.probability_of_loss * 100).toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="glass-panel rounded-lg">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
              <h4 className="font-label text-[10px] uppercase tracking-widest text-primary">
                Strategic Advisory
              </h4>
              <span className="agent-pulse h-2 w-2 rounded-full bg-tertiary" />
            </div>
            <div className="space-y-3 p-4">
              {advisories.map((a, i) => (
                <div key={i} className={`rounded border p-3 ${a.accent}`}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-on-surface">{a.icon}</span>
                    <span className="font-label text-[10px] uppercase tracking-wider text-on-surface">{a.title}</span>
                  </div>
                  <p className="mb-2 text-xs text-on-surface-variant">{a.body}</p>
                  {(a.action1 || a.action2) && (
                    <div className="flex gap-2 border-t border-white/10 pt-2">
                      {a.action1 && (
                        <Link
                          href={a.action1}
                          className="flex items-center gap-1 rounded border border-white/20 bg-white/5 px-2 py-0.5 font-label text-[9px] text-on-surface transition-colors hover:bg-white/10"
                        >
                          <span className="material-symbols-outlined text-[12px]">bolt</span>
                          Execute Flow
                        </Link>
                      )}
                      {a.action2 && (
                        <Link
                          href={a.action2}
                          className="flex items-center gap-1 rounded border border-white/20 bg-white/5 px-2 py-0.5 font-label text-[9px] text-on-surface transition-colors hover:bg-white/10"
                        >
                          <span className="material-symbols-outlined text-[12px]">analytics</span>
                          View Analysis
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {sorted.map((r) => (
          <div key={r.route.destination} className="glass-panel rounded-lg">
            <div className="flex items-center justify-between border-b border-white/10 p-3">
              <span className="font-label text-[10px] uppercase tracking-widest text-primary">
                SYD → {r.route.destination}
              </span>
              <span className={`rounded border px-2 py-0.5 font-label text-[10px] ${STATUS_STYLE[r.status]}`}>
                {r.status}
              </span>
            </div>
            <div className="space-y-3 p-3">
              <RiskBar value={r.fuelRisk} label="Fuel Risk" />
              <RiskBar value={r.competitorRisk} label="Competitor" />
              <RiskBar value={r.economicRisk} label="Economic" />
              <RiskBar value={r.capacityRisk} label="Capacity" />
              <div className="border-t border-white/10 pt-2">
                <div className="flex justify-between font-label text-[10px] uppercase tracking-wider">
                  <span className="text-on-surface-variant">Total Coefficient</span>
                  <span
                    className={`font-bold ${
                      r.totalCoefficient > 0.65
                        ? "text-error"
                        : r.totalCoefficient > 0.40
                        ? "text-secondary"
                        : "text-tertiary"
                    }`}
                  >
                    {r.totalCoefficient.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
