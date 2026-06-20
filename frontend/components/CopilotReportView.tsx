// Renders a completed /copilot (5-agent pipeline) result. Shared between
// /reports/new (right after a fresh run) and /reports/[id] (viewing a saved
// report from the Strategic Report Library), so both stay pixel-identical
// without duplicating ~600 lines of JSX.

import type { CopilotResponse } from "@/lib/types";
import { MONTH_NAMES } from "@/lib/constants";
import AvailabilityNotice from "@/components/AvailabilityNotice";

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

function fmtDelta(v: number, fmt: (x: number) => string) {
  return `${v >= 0 ? "+" : ""}${fmt(v)}`;
}

function parseRecommendation(summary: string): "PROCEED" | "CAUTION" | "NO-GO" {
  const lower = summary.toLowerCase();
  if (lower.includes("do not proceed") || lower.includes("not proceed")) return "NO-GO";
  if (lower.includes("caution") || lower.includes("proceed with caution")) return "CAUTION";
  return "PROCEED";
}

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

export default function CopilotReportView({ report }: { report: CopilotResponse }) {
  const rec = report.strategy.available ? parseRecommendation(report.strategy.executive_summary) : null;
  const recStyle: Record<"PROCEED" | "CAUTION" | "NO-GO", string> = {
    PROCEED: "border-tertiary text-tertiary hover:bg-tertiary/10",
    CAUTION: "border-secondary text-secondary hover:bg-secondary/10",
    "NO-GO": "border-error text-error hover:bg-error/10",
  };

  return (
    <>
      {/* ── strategy summary ── */}
      <div className="glass-panel relative overflow-hidden rounded-lg">
        <SectionHeader icon="psychology" label={`Strategy Agent · SYD → ${report.destination}`} />
        <div className="relative p-5">
          {rec && (
            <span
              className={`absolute right-5 top-5 rounded border bg-transparent px-4 py-1.5 font-label text-[10px] font-bold uppercase tracking-widest transition-colors ${recStyle[rec]}`}
            >
              {rec}
            </span>
          )}
          {report.strategy.available ? (
            <p className="max-w-2xl text-sm leading-relaxed text-on-surface whitespace-pre-wrap">
              {report.strategy.executive_summary}
            </p>
          ) : (
            <AvailabilityNotice text={report.strategy.executive_summary} />
          )}
          <div className="mt-6 flex gap-8 border-t border-white/10 pt-4">
            <div className="flex flex-col">
              <span className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50">
                Confidence Score
              </span>
              <span
                className={`font-label text-xl font-bold ${
                  report.demand.baseline.confidence_pct >= 70
                    ? "text-tertiary"
                    : report.demand.baseline.confidence_pct >= 50
                    ? "text-secondary"
                    : "text-error"
                }`}
              >
                {report.demand.baseline.confidence_pct}%
              </span>
            </div>
            <div className="flex flex-col border-l border-white/10 pl-8">
              <span className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50">
                Est. Revenue Impact
              </span>
              <span
                className={`font-label text-xl font-bold ${
                  report.finance.delta.revenue_usd >= 0 ? "text-tertiary" : "text-error"
                }`}
              >
                {report.finance.delta.revenue_usd >= 0 ? "+" : ""}
                {fmtUsd(report.finance.delta.revenue_usd)}
              </span>
            </div>
          </div>
          {report.demand.baseline.confidence_notes.length > 0 && (
            <div className="mt-3 border-t border-white/10 pt-2">
              {report.demand.baseline.confidence_notes.map((note, i) => (
                <p key={i} className="font-label text-[9px] text-on-surface-variant/60">• {note}</p>
              ))}
            </div>
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

            {(() => {
              const riskVectors = [
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
              ];
              // Resilience score is the inverse of the average of the same 4 real risk
              // vectors rendered as bars below - a derived aggregate, not a new fabrication.
              const avgRisk = riskVectors.reduce((s, r) => s + r.value, 0) / riskVectors.length;
              const resilienceScore = Math.round((1 - avgRisk) * 100);
              const circumference = 2 * Math.PI * 58;
              const threatLevel = avgRisk > 0.65 ? "HIGH" : avgRisk > 0.4 ? "MODERATE" : "LOW";

              return (
                <div className="border-t border-white/10 pt-4">
                  <div className="mb-4 flex flex-col items-center">
                    <div className="relative flex h-32 w-32 items-center justify-center">
                      <svg className="h-full w-full -rotate-90">
                        <circle cx="64" cy="64" r="58" fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                        <circle
                          cx="64"
                          cy="64"
                          r="58"
                          fill="transparent"
                          stroke="#4cd7f6"
                          strokeWidth="8"
                          strokeDasharray={circumference}
                          strokeDashoffset={circumference * (1 - resilienceScore / 100)}
                          className="drop-shadow-[0_0_8px_rgba(76,215,246,0.5)] transition-all"
                        />
                      </svg>
                      <div className="absolute flex flex-col items-center">
                        <span className="text-2xl font-bold text-on-surface">{resilienceScore}</span>
                        <span className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant">
                          Resilience
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <span className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50">
                        Threat Level
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 font-label text-[9px] font-bold ${
                          threatLevel === "HIGH"
                            ? "bg-error/10 text-error"
                            : threatLevel === "MODERATE"
                            ? "bg-secondary/10 text-secondary"
                            : "bg-tertiary/10 text-tertiary"
                        }`}
                      >
                        {threatLevel}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {riskVectors.map(({ label, value }) => {
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
              );
            })()}
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
                label: "Scenario Δ",
                value: (() => {
                  const base = report.demand.baseline.passengers_carried;
                  const delta = report.demand.delta.passengers_carried;
                  const pct = base > 0 ? (delta / base) * 100 : 0;
                  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
                })(),
                sub: "Baseline vs Scenario",
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
            { label: "Period", value: `${MONTH_NAMES[report.month - 1]} ${report.year}` },
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
  );
}
