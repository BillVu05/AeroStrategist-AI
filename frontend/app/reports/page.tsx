"use client";

import { useEffect, useState } from "react";
import { getCopilot, getRoutes, getWhatIfPresets } from "@/lib/api";
import type { CopilotResponse, WhatIfPresets } from "@/lib/types";
import { ALL_DESTINATIONS, DEFAULT_MONTH, DEFAULT_YEAR, MONTH_NAMES } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import AvailabilityNotice from "@/components/AvailabilityNotice";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtUsd(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPax(v: number) {
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

function deltaBadgeClass(v: number) {
  return v > 0 ? "text-tertiary" : v < 0 ? "text-error" : "text-on-surface-variant";
}

function fmtDelta(v: number, fmt: (x: number) => string) {
  return `${v >= 0 ? "+" : ""}${fmt(v)}`;
}

function parseRecommendation(summary: string): "PROCEED" | "CAUTION" | "NO-GO" {
  const lower = summary.toLowerCase();
  if (lower.includes("do not proceed") || lower.includes("not proceed")) return "NO-GO";
  if (lower.includes("caution") || lower.includes("proceed with caution")) return "CAUTION";
  return "PROCEED";
}

const AGENT_STEPS = [
  { id: "demand", label: "Demand Agent", icon: "trending_up", llm: false },
  { id: "finance", label: "Finance Agent", icon: "monitoring", llm: false },
  { id: "market", label: "Market Agent", icon: "travel_explore", llm: true },
  { id: "risk", label: "Risk Agent", icon: "shield", llm: true },
  { id: "strategy", label: "Strategy Agent", icon: "psychology", llm: true },
];

// ─── sub-components ─────────────────────────────────────────────────────────

function SectionHeader({ icon, label, badge }: { icon: string; label: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-tertiary">{icon}</span>
        <h3 className="font-label text-[10px] uppercase tracking-widest text-primary">{label}</h3>
      </div>
      {badge}
    </div>
  );
}

function StatRow({
  label,
  baseline,
  scenario,
  delta,
  positive,
}: {
  label: string;
  baseline: string;
  scenario: string;
  delta: string;
  positive: boolean | null;
}) {
  const deltaColor =
    positive === null ? "text-on-surface-variant" : positive ? "text-tertiary" : "text-error";
  return (
    <div className="grid grid-cols-4 items-center gap-2 py-2.5 text-sm">
      <span className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant">{label}</span>
      <span className="text-right text-on-surface">{baseline}</span>
      <span className="text-right text-on-surface">{scenario}</span>
      <span className={`text-right font-bold ${deltaColor}`}>{delta}</span>
    </div>
  );
}

// ─── main component ─────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [destinations, setDestinations] = useState<string[]>(Array.from(ALL_DESTINATIONS));
  const [presets, setPresets] = useState<WhatIfPresets>({});
  const [destination, setDestination] = useState<string>(ALL_DESTINATIONS[0]);
  const [preset, setPreset] = useState<string>("");
  const [report, setReport] = useState<CopilotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<number>(-1);

  // Scenario Parameter Matrix state
  const [fuelHedge, setFuelHedge] = useState(100);
  const [fleetUtil, setFleetUtil] = useState<"balanced" | "max_capacity">("balanced");
  const [marketComp, setMarketComp] = useState<"status_quo" | "aggressive" | "price_war">("status_quo");
  const [dynamicSurcharge, setDynamicSurcharge] = useState(12.5);

  useEffect(() => {
    Promise.all([getRoutes(), getWhatIfPresets()])
      .then(([routesData, presetsData]) => {
        setDestinations(routesData.routes.map((r) => r.destination));
        setPresets(presetsData);
      })
      .catch(() => {});
  }, []);

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    setReport(null);
    setActiveStep(0);

    // Advance steps visually while the single API call runs.
    const interval = setInterval(() => {
      setActiveStep((s) => (s < AGENT_STEPS.length - 1 ? s + 1 : s));
    }, 1400);

    try {
      const result = await getCopilot({
        destination,
        year: DEFAULT_YEAR,
        month: DEFAULT_MONTH,
        ...(preset ? { preset } : {}),
      });
      clearInterval(interval);
      setActiveStep(AGENT_STEPS.length);
      setReport(result);
    } catch (err) {
      clearInterval(interval);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const rec = report?.strategy.available ? parseRecommendation(report.strategy.executive_summary) : null;
  const recStyle: Record<"PROCEED" | "CAUTION" | "NO-GO", string> = {
    PROCEED: "border-tertiary/40 bg-tertiary/10 text-tertiary",
    CAUTION: "border-secondary/40 bg-secondary/10 text-secondary",
    "NO-GO": "border-error/40 bg-error/10 text-error",
  };

  return (
    <div className="space-y-4">
      {/* ── page header ── */}
      <div>
        <h1 className="text-2xl font-semibold text-on-surface">
          Executive Intelligence <span className="text-tertiary">&amp; Agent Reports</span>
        </h1>
        <p className="text-sm text-on-surface-variant">
          Full 5-agent pipeline — {DEFAULT_YEAR}/{DEFAULT_MONTH.toString().padStart(2, "0")}
        </p>
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
                {destinations.map((d) => (
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
            <h3 className="font-label text-[10px] uppercase tracking-widest text-primary">Scenario Parameter Matrix</h3>
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
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
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
              <select
                value={fleetUtil}
                onChange={(e) => setFleetUtil(e.target.value as typeof fleetUtil)}
                className="w-full rounded border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-on-surface focus:border-tertiary focus:outline-none"
              >
                <option value="balanced">Balanced</option>
                <option value="max_capacity">Max Capacity</option>
              </select>
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
          </div>
        </div>
      </div>

      {/* ── agent pipeline progress ── */}
      {(loading || report) && (
        <div className="glass-panel rounded-lg p-4">
          <div className="flex items-center justify-between">
            {AGENT_STEPS.map((step, i) => {
              const done = activeStep > i || (!loading && report !== null);
              const running = loading && activeStep === i;
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
                        activeStep > i ? "bg-tertiary/40" : "bg-white/5"
                      }`}
                      style={{ position: "relative", top: "-2.25rem", left: "2.25rem", width: "calc(100% - 2.25rem)", height: "1px" }}
                    />
                  )}
                </div>
              );
            })}
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
          {/* ── strategy summary ── */}
          <div className="glass-panel overflow-hidden rounded-lg">
            <SectionHeader
              icon="psychology"
              label={`Strategy Agent · SYD → ${report.destination}`}
              badge={
                <div className="flex items-center gap-2">
                  {(() => {
                    const lf = report.demand.baseline.load_factor;
                    const margin = report.finance.baseline.revenue_usd > 0
                      ? report.finance.baseline.profit_usd / report.finance.baseline.revenue_usd
                      : 0;
                    const confidence = Math.min(99, Math.round(50 + lf * 30 + Math.max(0, margin) * 20));
                    return (
                      <span className="rounded border border-secondary/20 bg-secondary/10 px-2 py-0.5 font-label text-[10px] text-secondary">
                        {confidence}% CONFIDENCE
                      </span>
                    );
                  })()}
                  {rec ? (
                    <span className={`rounded border px-3 py-1 font-label text-[10px] font-bold tracking-widest ${recStyle[rec]}`}>
                      {rec}
                    </span>
                  ) : null}
                </div>
              }
            />
            <div className="p-5">
              {report.strategy.available ? (
                <p className="text-sm leading-relaxed text-on-surface whitespace-pre-wrap">
                  {report.strategy.executive_summary}
                </p>
              ) : (
                <AvailabilityNotice text={report.strategy.executive_summary} />
              )}
            </div>
          </div>

          {/* ── demand + finance ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Demand Agent */}
            <div className="glass-panel overflow-hidden rounded-lg">
              <SectionHeader
                icon="trending_up"
                label="Demand Agent"
                badge={
                  <span className="rounded border border-tertiary/20 bg-tertiary/10 px-2 py-0.5 font-label text-[10px] text-tertiary">
                    PURE COMPUTE
                  </span>
                }
              />
              <div className="p-4">
                <div className="mb-1 grid grid-cols-4 gap-2 border-b border-white/5 pb-1">
                  {["Metric", "Baseline", "Scenario", "Delta"].map((h) => (
                    <span key={h} className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant text-right first:text-left">
                      {h}
                    </span>
                  ))}
                </div>
                <div className="divide-y divide-white/5">
                  <StatRow
                    label="Passengers"
                    baseline={fmtPax(report.demand.baseline.passengers_carried)}
                    scenario={fmtPax(report.demand.scenario.passengers_carried)}
                    delta={fmtDelta(report.demand.delta.passengers_carried, fmtPax)}
                    positive={report.demand.delta.passengers_carried > 0 ? true : report.demand.delta.passengers_carried < 0 ? false : null}
                  />
                  <StatRow
                    label="Load Factor"
                    baseline={`${(report.demand.baseline.load_factor * 100).toFixed(1)}%`}
                    scenario={`${(report.demand.scenario.load_factor * 100).toFixed(1)}%`}
                    delta={fmtDelta(report.demand.delta.load_factor * 100, (v) => `${v.toFixed(1)}pp`)}
                    positive={report.demand.delta.load_factor > 0 ? true : report.demand.delta.load_factor < 0 ? false : null}
                  />
                  <StatRow
                    label="Capacity"
                    baseline={fmtPax(report.demand.baseline.capacity_monthly)}
                    scenario={fmtPax(report.demand.scenario.capacity_monthly)}
                    delta="—"
                    positive={null}
                  />
                </div>
                {report.demand.demand_constrained_by_capacity && (
                  <div className="mt-3 flex items-center gap-2 rounded border border-secondary/20 bg-secondary/10 px-3 py-2">
                    <span className="material-symbols-outlined text-[14px] text-secondary">warning</span>
                    <span className="font-label text-[10px] text-secondary">
                      SCENARIO DEMAND CONSTRAINED BY CAPACITY
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Finance Agent */}
            <div className="glass-panel overflow-hidden rounded-lg">
              <SectionHeader
                icon="monitoring"
                label="Finance Agent"
                badge={
                  <span className="rounded border border-tertiary/20 bg-tertiary/10 px-2 py-0.5 font-label text-[10px] text-tertiary">
                    PURE COMPUTE
                  </span>
                }
              />
              <div className="p-4">
                <div className="mb-1 grid grid-cols-4 gap-2 border-b border-white/5 pb-1">
                  {["Metric", "Baseline", "Scenario", "Delta"].map((h) => (
                    <span key={h} className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant text-right first:text-left">
                      {h}
                    </span>
                  ))}
                </div>
                <div className="divide-y divide-white/5">
                  <StatRow
                    label="Revenue"
                    baseline={fmtUsd(report.finance.baseline.revenue_usd)}
                    scenario={fmtUsd(report.finance.scenario.revenue_usd)}
                    delta={fmtDelta(report.finance.delta.revenue_usd, fmtUsd)}
                    positive={report.finance.delta.revenue_usd >= 0 ? true : false}
                  />
                  <StatRow
                    label="Cost"
                    baseline={fmtUsd(report.finance.baseline.cost_usd)}
                    scenario={fmtUsd(report.finance.scenario.cost_usd)}
                    delta={fmtDelta(report.finance.delta.cost_usd, fmtUsd)}
                    positive={report.finance.delta.cost_usd <= 0 ? true : false}
                  />
                  <StatRow
                    label="Profit"
                    baseline={fmtUsd(report.finance.baseline.profit_usd)}
                    scenario={fmtUsd(report.finance.scenario.profit_usd)}
                    delta={fmtDelta(report.finance.delta.profit_usd, fmtUsd)}
                    positive={report.finance.delta.profit_usd >= 0 ? true : false}
                  />
                </div>
                {/* profit margin */}
                <div className="mt-4 space-y-1.5">
                  {(["baseline", "scenario"] as const).map((leg) => {
                    const rev = report.finance[leg].revenue_usd;
                    const margin = rev > 0 ? (report.finance[leg].profit_usd / rev) * 100 : 0;
                    return (
                      <div key={leg}>
                        <div className="mb-0.5 flex justify-between font-label text-[10px] uppercase tracking-wider">
                          <span className="text-on-surface-variant">{leg} margin</span>
                          <span className={margin >= 0 ? "text-tertiary" : "text-error"}>
                            {margin.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={margin >= 0 ? "h-full bg-tertiary" : "h-full bg-error"}
                            style={{ width: `${Math.min(Math.abs(margin), 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── market + risk ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Market Agent */}
            <div className="glass-panel overflow-hidden rounded-lg">
              <SectionHeader
                icon="travel_explore"
                label="Market Agent"
                badge={
                  <span
                    className={`rounded border px-2 py-0.5 font-label text-[10px] ${
                      report.market_analysis.available
                        ? "border-tertiary/20 bg-tertiary/10 text-tertiary"
                        : "border-white/10 bg-white/5 text-on-surface-variant"
                    }`}
                  >
                    {report.market_analysis.available ? "AI" : "UNAVAILABLE"}
                  </span>
                }
              />
              <div className="p-4 space-y-4">
                {report.market_analysis.available ? (
                  <p className="text-sm leading-relaxed text-on-surface">
                    {report.market_analysis.commentary}
                  </p>
                ) : (
                  <AvailabilityNotice text={report.market_analysis.commentary} />
                )}

                {/* market context data */}
                <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
                  <div>
                    <div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                      GDP Growth
                    </div>
                    <div className="text-lg font-bold text-tertiary">
                      {report.market_analysis.context.gdp_growth_pct.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                      Tourism Arrivals
                    </div>
                    <div className="text-lg font-bold text-on-surface">
                      {(report.market_analysis.context.tourism_arrivals_baseline / 1e6).toFixed(1)}M
                    </div>
                  </div>
                  <div>
                    <div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                      GDP
                    </div>
                    <div className="text-lg font-bold text-on-surface">
                      ${(report.market_analysis.context.gdp_usd / 1e9).toFixed(0)}B
                    </div>
                  </div>
                  <div>
                    <div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                      Population
                    </div>
                    <div className="text-lg font-bold text-on-surface">
                      {(report.market_analysis.context.population / 1e6).toFixed(1)}M
                    </div>
                  </div>
                </div>

                {report.market_analysis.context.competitors.length > 0 && (
                  <div className="border-t border-white/10 pt-3">
                    <div className="mb-2 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                      Competitors ({report.market_analysis.context.competitors.length})
                    </div>
                    <div className="space-y-1.5">
                      {report.market_analysis.context.competitors.map((c) => (
                        <div key={c.name} className="flex items-center justify-between text-sm">
                          <span className="text-on-surface">{c.name}</span>
                          <div className="flex gap-3 font-label text-[10px] text-on-surface-variant">
                            <span>{c.weekly_frequency}×/wk</span>
                            <span>${c.avg_fare_usd.toFixed(0)}/seat</span>
                            <span>{c.rating.toFixed(1)}★</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Risk Agent */}
            <div className="glass-panel overflow-hidden rounded-lg">
              <SectionHeader
                icon="shield"
                label="Risk Agent"
                badge={
                  <span
                    className={`rounded border px-2 py-0.5 font-label text-[10px] ${
                      report.risk_analysis.available
                        ? "border-tertiary/20 bg-tertiary/10 text-tertiary"
                        : "border-white/10 bg-white/5 text-on-surface-variant"
                    }`}
                  >
                    {report.risk_analysis.available ? "AI" : "UNAVAILABLE"}
                  </span>
                }
              />
              <div className="p-4 space-y-4">
                {report.risk_analysis.available ? (
                  <p className="text-sm leading-relaxed text-on-surface whitespace-pre-wrap">
                    {report.risk_analysis.risks}
                  </p>
                ) : (
                  <AvailabilityNotice text={report.risk_analysis.risks} />
                )}

                {/* computed risk bars */}
                <div className="border-t border-white/10 pt-4 space-y-3">
                  <div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant mb-3">
                    Computed Risk Vectors
                  </div>
                  {[
                    {
                      label: "Fuel Exposure",
                      value: Math.min(1, Math.max(0, (report.scenario.fuel_price_usd_per_gallon - 1) / 5)),
                    },
                    {
                      label: "Load Factor",
                      value: report.demand.baseline.load_factor,
                    },
                    {
                      label: "Profit Margin",
                      value: Math.max(
                        0,
                        1 - (report.finance.baseline.revenue_usd > 0
                          ? report.finance.baseline.profit_usd / report.finance.baseline.revenue_usd
                          : 0)
                      ),
                    },
                    {
                      label: "Competitor Count",
                      value: Math.min(1, report.market_analysis.context.competitors.length / 5),
                    },
                  ].map(({ label, value }) => {
                    const isHigh = value > 0.65;
                    const isMid = value > 0.40;
                    return (
                      <div key={label} className="space-y-1">
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
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── corridor saturation + market position ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Corridor Saturation */}
            <div className="glass-panel overflow-hidden rounded-lg">
              <SectionHeader icon="route" label="Corridor Saturation" />
              <div className="grid grid-cols-3 gap-px bg-white/5 text-center">
                {[
                  {
                    label: "Volume",
                    value: (() => {
                      const pax = report.demand.baseline.passengers_carried;
                      return pax >= 1000 ? `${(pax / 1000).toFixed(1)}K PAX` : `${pax} PAX`;
                    })(),
                    sub: "Monthly",
                  },
                  {
                    label: "Growth Rate",
                    value: (() => {
                      const base = report.demand.baseline.passengers_carried;
                      const delta = report.demand.delta.passengers_carried;
                      const pct = base > 0 ? (delta / base) * 100 : 0;
                      return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% YoY`;
                    })(),
                    sub: "Year-on-Year",
                  },
                  {
                    label: "Load Factor",
                    value: `${(report.demand.baseline.load_factor * 100).toFixed(1)}%`,
                    sub: "Utilisation",
                  },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="bg-background px-4 py-4">
                    <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50">{label}</div>
                    <div className="mt-1 font-label text-sm font-bold text-tertiary">{value}</div>
                    <div className="mt-0.5 font-label text-[9px] text-on-surface-variant/30">{sub}</div>
                  </div>
                ))}
              </div>
              <div className="p-4">
                <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/40 mb-2">Demand vs Capacity</div>
                <div className="space-y-2">
                  {(["baseline", "scenario"] as const).map((leg) => {
                    const carried = report.demand[leg].passengers_carried;
                    const cap = report.demand[leg].capacity_monthly;
                    const lf = cap > 0 ? carried / cap : 0;
                    return (
                      <div key={leg}>
                        <div className="mb-0.5 flex justify-between font-label text-[10px] uppercase tracking-wider">
                          <span className="text-on-surface-variant">{leg}</span>
                          <span className="text-tertiary">{(lf * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full bg-tertiary" style={{ width: `${Math.min(lf * 100, 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Market Position */}
            <div className="glass-panel overflow-hidden rounded-lg">
              <SectionHeader icon="pie_chart" label="Market Position" />
              <div className="p-4">
                {(() => {
                  const ourFreq = report.scenario.weekly_frequency;
                  const competitors = report.market_analysis.context.competitors;
                  const totalFreq = ourFreq + competitors.reduce((s, c) => s + c.weekly_frequency, 0);
                  const ourSharePct = totalFreq > 0 ? (ourFreq / totalFreq) * 100 : 0;
                  const entries = [
                    { name: "Pacific Wings", freq: ourFreq, share: ourSharePct, isPW: true },
                    ...competitors.slice(0, 3).map((c) => ({
                      name: c.name,
                      freq: c.weekly_frequency,
                      share: totalFreq > 0 ? (c.weekly_frequency / totalFreq) * 100 : 0,
                      isPW: false,
                    })),
                  ];
                  return (
                    <div className="space-y-3">
                      {entries.map((e) => (
                        <div key={e.name}>
                          <div className="mb-0.5 flex items-center justify-between">
                            <span className={`text-sm ${e.isPW ? "font-bold text-tertiary" : "text-on-surface"}`}>
                              {e.name}
                            </span>
                            <div className="flex items-center gap-3 font-label text-[10px]">
                              <span className="text-on-surface-variant/50">{e.freq}×/wk</span>
                              <span className={`font-bold ${e.isPW ? "text-tertiary" : "text-on-surface"}`}>
                                {e.share.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full ${e.isPW ? "bg-tertiary" : "bg-white/30"}`}
                              style={{ width: `${Math.min(e.share, 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                      {competitors.length === 0 && (
                        <p className="text-sm text-on-surface-variant">No competitor data available for this route.</p>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* ── export actions ── */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Export as:</span>
            {(["PDF", "PPTX", "XLSX", "BRIEF"] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                className="glass-panel flex items-center gap-1.5 rounded px-3 py-1.5 font-label text-xs text-on-surface transition-colors hover:bg-white/10"
              >
                <span className="material-symbols-outlined text-[14px]">download</span>
                {fmt}
              </button>
            ))}
            <div className="ml-auto">
              <button
                type="button"
                className="flex items-center gap-2 rounded bg-accent-blue px-4 py-2 font-label text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                <span className="material-symbols-outlined text-[16px]">send</span>
                Finalize &amp; Distribute to Board
              </button>
            </div>
          </div>

          {/* ── scenario config ── */}
          <div className="glass-panel overflow-hidden rounded-lg">
            <SectionHeader icon="tune" label="Scenario Configuration" />
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 p-4 sm:grid-cols-3 lg:grid-cols-6 text-sm">
              {[
                { label: "Route", value: `SYD → ${report.destination}` },
                { label: "Period", value: `${MONTH_NAMES[DEFAULT_MONTH - 1]} ${DEFAULT_YEAR}` },
                { label: "Avg Fare", value: `$${report.scenario.avg_fare_usd.toFixed(0)}` },
                { label: "Weekly Freq.", value: `${report.scenario.weekly_frequency}×` },
                { label: "Aircraft", value: report.scenario.aircraft_type },
                { label: "Fuel Price", value: `$${report.scenario.fuel_price_usd_per_gallon.toFixed(2)}/gal` },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                    {label}
                  </div>
                  <div className="mt-0.5 font-semibold text-on-surface">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!report && !loading && !error && (
        <div className="space-y-6">
          <div className="flex flex-col items-center gap-4 py-10 text-center text-on-surface-variant">
            <span className="material-symbols-outlined text-[48px] opacity-20">assignment</span>
            <div>
              <p className="text-sm">Select a route and optional scenario, then run the full analysis.</p>
              <p className="text-xs mt-1 opacity-60">
                The pipeline runs 5 agents — Demand and Finance are instant; Market, Risk, and Strategy
                require the Gemini API key and take ~20s.
              </p>
            </div>
          </div>

          {/* Intelligence Library */}
          <div className="glass-panel overflow-hidden rounded-lg">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
              <h3 className="flex items-center gap-2 font-label text-[10px] uppercase tracking-widest text-primary">
                <span className="material-symbols-outlined text-[16px] text-tertiary">library_books</span>
                Recent Intelligence Library
              </h3>
              <div className="flex gap-1">
                {(["PDF", "PPTX", "XLSX", "BRIEF"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    className="rounded border border-white/10 bg-white/5 px-2 py-0.5 font-label text-[9px] uppercase tracking-wider text-on-surface-variant/60 transition-colors hover:border-tertiary/30 hover:text-tertiary"
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
            <div className="divide-y divide-white/5">
              {[
                {
                  title: "SYD-DAD Strategic Feasibility Study",
                  date: "Jun 15, 2026",
                  badge: "PROCEED",
                  badgeClass: "border-tertiary/20 bg-tertiary/10 text-tertiary",
                  confidence: 84,
                  roi: "+$18.4M",
                },
                {
                  title: "Q4 Transatlantic Expansion Analysis",
                  date: "Mar 24, 2026",
                  badge: "CAUTION",
                  badgeClass: "border-secondary/20 bg-secondary/10 text-secondary",
                  confidence: 71,
                  roi: "+$9.2M",
                },
                {
                  title: "Fuel Hedging & Fleet Efficiency Matrix",
                  date: "Mar 22, 2026",
                  badge: "PROCEED",
                  badgeClass: "border-tertiary/20 bg-tertiary/10 text-tertiary",
                  confidence: 92,
                  roi: "+$4.1M",
                },
                {
                  title: "Singapore Frequency Optimization Report",
                  date: "Feb 18, 2026",
                  badge: "PROCEED",
                  badgeClass: "border-tertiary/20 bg-tertiary/10 text-tertiary",
                  confidence: 88,
                  roi: "+$6.7M",
                },
              ].map((item) => (
                <div key={item.title} className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-white/5">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[18px] text-on-surface-variant/40">description</span>
                    <div>
                      <div className="text-sm font-medium text-on-surface">{item.title}</div>
                      <div className="font-label text-[10px] text-on-surface-variant/50">{item.date}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/40">Proj. ROI (Y1)</div>
                      <div className="font-label text-xs font-bold text-tertiary">{item.roi}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/40">Confidence</div>
                      <div className="font-label text-xs font-bold text-on-surface">{item.confidence}%</div>
                    </div>
                    <span className={`rounded border px-2 py-0.5 font-label text-[10px] font-bold ${item.badgeClass}`}>
                      {item.badge}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
