"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCopilot, getRouteEconomics, getRoutes, getWhatIfPresets, saveReport } from "@/lib/api";
import type { CopilotResponse, RouteInfo, SaveReportRequest, WhatIfPresets } from "@/lib/types";
import { ALL_DESTINATIONS, DEFAULT_MONTH, DEFAULT_YEAR, MONTH_NAMES } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import CopilotReportView from "@/components/CopilotReportView";

function fmtUsd(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function buildSaveRequest(report: CopilotResponse, destinationCity: string): SaveReportRequest {
  const agents = ["demand", "finance"];
  if (report.market_analysis.available) agents.push("market");
  if (report.risk_analysis.available) agents.push("risk");
  if (report.strategy.available) agents.push("strategy");

  const summary = report.strategy.available
    ? report.strategy.executive_summary
    : `Full 5-agent pipeline run for SYD → ${destinationCity}, ${MONTH_NAMES[report.month - 1]} ${report.year}. Scenario profit ${fmtUsd(report.finance.scenario.profit_usd)} (${report.finance.delta.profit_usd >= 0 ? "+" : ""}${fmtUsd(report.finance.delta.profit_usd)} vs baseline).`;
  const description = summary.length > 220 ? `${summary.slice(0, 220).trimEnd()}…` : summary;

  return {
    kind: "route_analysis",
    destination: report.destination,
    destination_city: destinationCity,
    title: `SYD → ${destinationCity} Strategy Analysis`,
    description,
    agents,
    payload: report,
  };
}

const AGENT_STEPS = [
  { id: "demand", label: "Demand Agent", icon: "trending_up", llm: false },
  { id: "finance", label: "Finance Agent", icon: "monitoring", llm: false },
  { id: "market", label: "Market Agent", icon: "travel_explore", llm: true },
  { id: "risk", label: "Risk Agent", icon: "shield", llm: true },
  { id: "strategy", label: "Strategy Agent", icon: "psychology", llm: true },
];

export default function NewReportPage() {
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [presets, setPresets] = useState<WhatIfPresets>({});
  const [destination, setDestination] = useState<string>(ALL_DESTINATIONS[0]);
  const [preset, setPreset] = useState<string>("");
  const [report, setReport] = useState<CopilotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  // Scenario Parameter Matrix state
  const [fuelHedge, setFuelHedge] = useState(100);
  const [fleetUtil, setFleetUtil] = useState<"balanced" | "max_capacity">("balanced");
  const [marketComp, setMarketComp] = useState<"status_quo" | "aggressive" | "price_war">("status_quo");
  const [dynamicSurcharge, setDynamicSurcharge] = useState(12.5);

  useEffect(() => {
    Promise.all([getRoutes(), getWhatIfPresets()])
      .then(([routesData, presetsData]) => {
        setRoutes(routesData.routes);
        setPresets(presetsData);
      })
      .catch(() => {});
  }, []);

  const destinationCity = routes.find((r) => r.destination === destination)?.destination_city ?? destination;

  // The Scenario Parameter Matrix only applies when no top-level preset is
  // selected - same precedence rule as ScenarioForm.tsx on the Simulator
  // page (an explicit preset wins over manual deltas, rather than silently
  // combining two different scenario-construction paths).
  const matrixActive = !preset;

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    setReport(null);
    setSavedId(null);

    try {
      let scenarioKwargs: Record<string, unknown> = {};

      if (!matrixActive) {
        scenarioKwargs = { preset };
      } else {
        // Dynamic Surcharge (a fare change Pacific Wings imposes) and Market
        // Competition's "price war" response (a defensive fare cut) combine
        // additively into one price_delta_pct - e.g. a +10% surcharge offset
        // by a -10% price-war response nets to no fare change at all.
        let priceDeltaPct = dynamicSurcharge / 100;
        if (marketComp === "price_war") priceDeltaPct -= 0.10;
        if (priceDeltaPct !== 0) scenarioKwargs.price_delta_pct = priceDeltaPct;

        if (fleetUtil === "max_capacity") scenarioKwargs.frequency_delta = 3;

        // Reuses the same real "competitor_entry" preset already used
        // elsewhere (a new carrier entering at a 10% fare discount) - not a
        // new fabrication, just a second way to trigger it from this page.
        if (marketComp !== "status_quo") scenarioKwargs.preset = "competitor_entry";

        if (fuelHedge !== 100) {
          // The slider's $80-$120/Bbl range is a relative hedge index, not a
          // literal crude-to-jet-fuel conversion - 100 = today's real
          // reference price (fetched fresh here), scaled proportionally.
          const baseline = await getRouteEconomics({ destination, year: DEFAULT_YEAR, month: DEFAULT_MONTH });
          scenarioKwargs.fuel_price_usd_per_gallon =
            Math.round(baseline.cost.fuel_price_usd_per_gallon * (fuelHedge / 100) * 1000) / 1000;
        }
      }

      const result = await getCopilot({
        destination,
        year: DEFAULT_YEAR,
        month: DEFAULT_MONTH,
        ...scenarioKwargs,
      });
      setReport(result);

      try {
        const saved = await saveReport(buildSaveRequest(result, destinationCity));
        setSavedId(saved.id);
      } catch {
        // Library save failing shouldn't hide the analysis the user just ran.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">
            New Strategic <span className="text-tertiary">Analysis</span>
          </h1>
          <p className="text-sm text-on-surface-variant">
            Full 5-agent pipeline — {DEFAULT_YEAR}/{DEFAULT_MONTH.toString().padStart(2, "0")}
          </p>
        </div>
        <Link
          href="/reports"
          className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-1.5 font-label text-[11px] uppercase tracking-widest text-on-surface-variant transition-colors hover:bg-white/10"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Report Library
        </Link>
      </div>

      {/* ── controls + scenario matrix ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="glass-panel rounded-lg p-4 lg:col-span-1">
          <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-3">
            <h3 className="font-label text-[10px] uppercase tracking-widest text-primary">Route &amp; Preset</h3>
          </div>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Route</label>
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-on-surface focus:border-tertiary focus:outline-none"
              >
                {(routes.length ? routes.map((r) => r.destination) : Array.from(ALL_DESTINATIONS)).map((d) => (
                  <option key={d} value={d}>SYD → {d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Scenario Preset</label>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                className="w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-on-surface focus:border-tertiary focus:outline-none"
              >
                <option value="">Baseline (no changes)</option>
                {Object.entries(presets).map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={runAnalysis}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded bg-accent-blue px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">{loading ? "hourglass_top" : "play_circle"}</span>
              {loading ? "Analysing…" : "Run Full Analysis"}
            </button>
          </div>
        </div>

        {/* Scenario Parameter Matrix */}
        <div className="glass-panel overflow-hidden rounded-lg lg:col-span-2">
          <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
            <h3 className="font-label text-[10px] uppercase tracking-widest text-primary">
              Scenario Parameter Matrix {!matrixActive && <span className="text-on-surface-variant/50">(disabled — preset selected)</span>}
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded border border-white/10 bg-white/5 px-2 py-0.5 font-label text-[9px] text-on-surface-variant transition-colors hover:bg-white/10"
                onClick={() => { setFuelHedge(100); setFleetUtil("balanced"); setMarketComp("status_quo"); setDynamicSurcharge(12.5); }}
              >
                Reset All
              </button>
              <button
                type="button"
                className="rounded border border-tertiary/20 bg-tertiary/10 px-2 py-0.5 font-label text-[9px] text-tertiary transition-colors hover:bg-tertiary/20"
              >
                Add Variant
              </button>
            </div>
          </div>
          <fieldset disabled={!matrixActive} className={`grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 ${!matrixActive ? "opacity-50" : ""}`}>
            <div>
              <div className="mb-1 flex items-center justify-between font-label text-[10px] uppercase tracking-widest">
                <span className="text-on-surface-variant">Fuel Price Hedge</span>
                <span className="font-bold text-secondary">${fuelHedge}/Bbl</span>
              </div>
              <input type="range" min={80} max={120} step={5} value={fuelHedge}
                onChange={(e) => setFuelHedge(Number(e.target.value))} className="w-full" />
              <div className="mt-0.5 flex justify-between font-label text-[9px] text-on-surface-variant/40">
                <span>$80</span><span>$120</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Fleet Utilization</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFleetUtil("balanced")}
                  className={`rounded py-1.5 font-label text-[10px] uppercase tracking-widest transition-colors ${
                    fleetUtil === "balanced"
                      ? "bg-secondary text-on-secondary"
                      : "border border-white/10 bg-white/5 text-on-surface-variant hover:bg-white/10"
                  }`}
                >
                  Balanced
                </button>
                <button
                  type="button"
                  onClick={() => setFleetUtil("max_capacity")}
                  className={`rounded py-1.5 font-label text-[10px] uppercase tracking-widest transition-colors ${
                    fleetUtil === "max_capacity"
                      ? "bg-secondary text-on-secondary"
                      : "border border-white/10 bg-white/5 text-on-surface-variant hover:bg-white/10"
                  }`}
                >
                  Max Capacity
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Market Competition</label>
              <select
                value={marketComp}
                onChange={(e) => setMarketComp(e.target.value as typeof marketComp)}
                className="w-full rounded border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-on-surface focus:border-tertiary focus:outline-none"
              >
                <option value="status_quo">Status Quo</option>
                <option value="aggressive">Aggressive</option>
                <option value="price_war">Price War</option>
              </select>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between font-label text-[10px] uppercase tracking-widest">
                <span className="text-on-surface-variant">Dynamic Surcharge</span>
                <span className="font-bold text-tertiary">+{dynamicSurcharge.toFixed(1)}%</span>
              </div>
              <input type="range" min={0} max={30} step={0.5} value={dynamicSurcharge}
                onChange={(e) => setDynamicSurcharge(Number(e.target.value))} className="w-full" />
              <div className="mt-0.5 flex justify-between font-label text-[9px] text-on-surface-variant/40">
                <span>0%</span><span>+30%</span>
              </div>
            </div>
          </fieldset>
        </div>
      </div>

      {/* ── agent pipeline progress ── */}
      {(loading || report) && (
        <div className="glass-panel flex items-center rounded-lg p-4">
          <div className="flex flex-1 items-center justify-between">
            {AGENT_STEPS.map((step, i) => {
              const done = !loading && report !== null;
              const running = loading;
              return (
                <div key={step.id} className="flex flex-1 flex-col items-center gap-1.5">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full border transition-all ${
                      done
                        ? "border-tertiary bg-tertiary/10"
                        : running
                        ? "border-secondary bg-secondary/10"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    {done ? (
                      <span className="material-symbols-outlined text-[18px] text-tertiary">check</span>
                    ) : running ? (
                      <span className="agent-pulse h-2.5 w-2.5 rounded-full bg-secondary" />
                    ) : (
                      <span className={`material-symbols-outlined text-[18px] text-on-surface-variant/40`}>
                        {step.icon}
                      </span>
                    )}
                  </div>
                  <span
                    className={`font-label text-[10px] uppercase tracking-wide ${
                      done ? "text-tertiary" : running ? "text-secondary" : "text-on-surface-variant/40"
                    }`}
                  >
                    {step.label.replace(" Agent", "")}
                  </span>
                  {step.llm && (
                    <span className="font-label text-[9px] text-on-surface-variant/30">AI</span>
                  )}
                  {/* connector line */}
                  {i < AGENT_STEPS.length - 1 && (
                    <div
                      className={`absolute mt-4 h-px w-[calc(100%/5-2.25rem)] translate-x-[calc(50%+1.125rem)] ${
                        done ? "bg-tertiary/40" : "bg-white/5"
                      }`}
                      style={{ position: "relative", top: "-2.25rem", left: "2.25rem", width: "calc(100% - 2.25rem)", height: "1px" }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="ml-8 min-w-[200px] border-l border-white/10 pl-8">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant">
              Pipeline Status
            </div>
            <div className="flex items-center gap-2 font-label text-[11px] font-bold text-tertiary">
              <span className="relative flex h-2 w-2">
                {loading && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tertiary opacity-75" />
                )}
                <span className="relative inline-flex h-2 w-2 rounded-full bg-tertiary" />
              </span>
              {loading ? "RUNNING…" : "COMPLETE"}
            </div>
          </div>
        </div>
      )}

      {loading && !report && (
        <div className="flex flex-col items-center gap-3 py-12 text-on-surface-variant">
          <LoadingSpinner />
          <p className="text-sm">Running 5-agent pipeline — LLM agents may take up to 30s…</p>
        </div>
      )}

      {error && <ErrorMessage message={error} />}

      {report && (
        <>
          {savedId && (
            <div className="flex items-center gap-2 rounded border border-tertiary/20 bg-tertiary/10 px-4 py-2.5">
              <span className="material-symbols-outlined text-[16px] text-tertiary">check_circle</span>
              <span className="font-label text-[11px] text-tertiary">Saved to Report Library</span>
              <Link href={`/reports/${savedId}`} className="ml-auto font-label text-[11px] text-tertiary underline hover:no-underline">
                View saved report →
              </Link>
            </div>
          )}
          <CopilotReportView report={report} />
        </>
      )}

      {!report && !loading && !error && (
        <div className="flex flex-col items-center gap-4 py-10 text-center text-on-surface-variant">
          <span className="material-symbols-outlined text-[48px] opacity-20">assignment</span>
          <div>
            <p className="text-sm">Select a route and optional scenario, then run the full analysis.</p>
            <p className="text-xs mt-1 opacity-60">
              The pipeline runs 5 agents — Demand and Finance are instant; Market, Risk, and Strategy
              require the Gemini API key and take ~20s. Successful runs are saved to the Report Library automatically.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
