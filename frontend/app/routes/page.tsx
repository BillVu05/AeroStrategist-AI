"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  getAnalyzeRoute,
  getAnalyzeRouteAgents,
  getCompareRoutes,
  getDemandForecast,
  getMarketContext,
  getRoutes,
  getWhatIf,
  saveReport,
} from "@/lib/api";
import type {
  AnalyzeRouteResponse,
  CompareRoutesResponse,
  MarketContext,
  OpenRouteFormValue,
  RoutesResponse,
  SaveReportRequest,
} from "@/lib/types";
import { DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import RouteProfitabilityTable, { type ProfitabilityRow } from "@/components/RouteProfitabilityTable";
import MiniBarPanel from "@/components/MiniBarPanel";
import OpenRouteForm from "@/components/OpenRouteForm";
import { RouteAnalysisReport, RouteComparisonList } from "@/components/RouteAnalysisCard";

const PREVIOUS_MONTH = DEFAULT_MONTH === 1 ? 12 : DEFAULT_MONTH - 1;
const PREVIOUS_YEAR = DEFAULT_MONTH === 1 ? DEFAULT_YEAR - 1 : DEFAULT_YEAR;

interface BaseData {
  routesData: RoutesResponse;
  rows: ProfitabilityRow[];
}

interface SelectedData {
  market: MarketContext;
  demandSeries: { label: string; value: number }[];
}

function fmtUsd(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
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

function riskBadge(row: ProfitabilityRow) {
  const { profit_usd, revenue } = row.whatIf.baseline;
  const margin = revenue.total_revenue_usd > 0 ? profit_usd / revenue.total_revenue_usd : 0;
  if (profit_usd < 0) return { label: "HIGH RISK", cls: "border-error/40 bg-error-container/40 text-on-error-container" };
  if (margin < 0.1) return { label: "MODERATE RISK", cls: "border-secondary/40 bg-secondary/10 text-secondary" };
  return { label: "LOW RISK", cls: "border-tertiary/40 bg-tertiary/10 text-tertiary" };
}

function recommendation(row: ProfitabilityRow) {
  const { whatIf, route } = row;
  const profit = whatIf.baseline.profit_usd;
  const margin =
    whatIf.baseline.revenue.total_revenue_usd > 0 ? profit / whatIf.baseline.revenue.total_revenue_usd : 0;
  const loadFactor = whatIf.baseline.demand.load_factor;

  if (profit < 0) {
    return {
      label: "REVIEW ROUTE - OPERATING AT A LOSS",
      body: `Monthly loss of ${fmtUsd(profit)} at ${(loadFactor * 100).toFixed(1)}% load. Stress-test fare and frequency changes in Scenario Lab before deciding.`,
    };
  }
  if (route.status === "candidate") {
    return {
      label: "CANDIDATE ROUTE - LAUNCH CASE POSITIVE",
      body: `Projected ${fmtUsd(profit)} monthly profit at ${(margin * 100).toFixed(0)}% margin. Validate with a full feasibility analysis below.`,
    };
  }
  if (loadFactor > 0.85) {
    return {
      label: "ANALYZE CAPACITY - DEMAND EXCEEDS SUPPLY",
      body: `Load factor ${(loadFactor * 100).toFixed(1)}% suggests unmet demand. Model added frequency or a larger gauge in Scenario Lab.`,
    };
  }
  return {
    label: "MAINTAIN CAPACITY - STABLE PERFORMANCE",
    body: `${fmtUsd(profit)} monthly profit at ${(margin * 100).toFixed(0)}% margin and ${(loadFactor * 100).toFixed(1)}% load. No structural change indicated.`,
  };
}

// ── Analyze New Route (absorbed from the old /open-route page) ───────────────

const DEFAULT_FORM: OpenRouteFormValue = {
  destination: "",
  weekly_frequency: 3,
};

function buildSaveRequest(result: AnalyzeRouteResponse, id?: string): SaveReportRequest {
  const agents = ["demand", "finance"];
  if (result.agent_evidence?.market) agents.push("market");
  if (result.agent_evidence?.risk) agents.push("risk");
  if (result.agent_evidence?.strategy) agents.push("strategy");

  const summary = result.agent_evidence?.strategy?.available
    ? result.agent_evidence.strategy.executive_summary
    : `${result.verdict}${result.pros?.[0] ? ` — ${result.pros[0]}` : ""}`;
  const description = summary.length > 220 ? `${summary.slice(0, 220).trimEnd()}…` : summary;

  return {
    kind: "open_route",
    destination: result.route.destination,
    destination_city: result.route.destination_city,
    title: `${result.route.destination_city} New Route Feasibility`,
    description,
    agents,
    payload: result,
    id,
  };
}

function AnalyzeNewRouteSection() {
  const [form, setForm] = useState<OpenRouteFormValue>(DEFAULT_FORM);
  const [comparisonList, setComparisonList] = useState<string[]>([]);
  const [mode, setMode] = useState<"single" | "compare">("single");
  const [singleResult, setSingleResult] = useState<AnalyzeRouteResponse | null>(null);
  const [compareResult, setCompareResult] = useState<CompareRoutesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ iata: string; city: string; country: string }[]>([]);
  const [savedReportId, setSavedReportId] = useState<string | null>(null);

  function addToComparison() {
    const dest = form.destination.trim().toUpperCase();
    if (dest && !comparisonList.includes(dest)) {
      setComparisonList([...comparisonList, dest]);
    }
  }

  function removeFromComparison(iata: string) {
    setComparisonList(comparisonList.filter((d) => d !== iata));
  }

  async function analyze() {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setSavedReportId(null);
    try {
      const res = await getAnalyzeRoute(form);
      if (res.error) {
        setError(res.error);
        setSuggestions((res.suggestions ?? []) as { iata: string; city: string; country: string }[]);
        setSingleResult(null);
      } else {
        setSingleResult(res);
        setMode("single");
        try {
          const saved = await saveReport(buildSaveRequest(res));
          setSavedReportId(saved.id);
        } catch {
          // Library save failing shouldn't hide the analysis the user just ran.
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function compare() {
    setLoading(true);
    setError(null);
    try {
      const res = await getCompareRoutes({
        destinations: comparisonList,
        weekly_frequency: form.weekly_frequency,
        fuel_price_usd_per_gallon: form.fuel_price_usd_per_gallon,
      });
      setCompareResult(res);
      setMode("compare");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function generateAgentAnalysis() {
    if (!singleResult) return;
    setAgentLoading(true);
    try {
      const res = await getAnalyzeRouteAgents(form);
      const merged = { ...singleResult, agent_evidence: res.agent_evidence };
      setSingleResult(merged);
      try {
        // Upserts the same library entry created in analyze() rather than
        // creating a duplicate - this is an enrichment of one analysis, not
        // a second one.
        const saved = await saveReport(buildSaveRequest(merged, savedReportId ?? undefined));
        setSavedReportId(saved.id);
      } catch {
        // Library save failing shouldn't hide the analysis the user just ran.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAgentLoading(false);
    }
  }

  return (
    <div className="glass-panel relative overflow-hidden rounded-xl p-6">
      <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-tertiary/10 blur-3xl" />
      <h3 className="mb-1 flex items-center gap-2 text-xl font-semibold text-on-surface">
        <span className="material-symbols-outlined text-tertiary">rocket_launch</span>
        Analyze New Route
      </h3>
      <p className="mb-4 text-sm text-on-surface-variant">
        Strategic screening for any worldwide destination — not limited to the existing network. Figures are
        order-of-magnitude estimates (gravity-model demand ±40%, financials ±30%); see docs/data_methodology.md.
      </p>

      <OpenRouteForm
        value={form}
        onChange={setForm}
        comparisonList={comparisonList}
        onAddToComparison={addToComparison}
        onRemoveFromComparison={removeFromComparison}
        onAnalyze={analyze}
        onCompare={compare}
        loading={loading}
      />

      {error && (
        <div className="mt-4 space-y-2">
          <ErrorMessage message={error} />
          {suggestions.length > 0 && (
            <div className="glass-panel rounded-lg p-3 text-sm text-on-surface-variant">
              Did you mean:{" "}
              {suggestions.map((s, i) => (
                <span key={s.iata}>
                  <button
                    type="button"
                    className="text-tertiary hover:underline"
                    onClick={() => setForm({ ...form, destination: s.iata })}
                  >
                    {s.city} ({s.iata})
                  </button>
                  {i < suggestions.length - 1 ? ", " : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="mt-4">
          <LoadingSpinner />
        </div>
      )}

      {!loading && mode === "single" && singleResult && (
        <div className="mt-4 space-y-3">
          {savedReportId && (
            <div className="flex items-center gap-2 rounded border border-tertiary/20 bg-tertiary/10 px-4 py-2.5">
              <span className="material-symbols-outlined text-[16px] text-tertiary">check_circle</span>
              <span className="font-label text-[11px] text-tertiary">Saved to Report Library</span>
              <Link
                href={`/reports/${savedReportId}`}
                className="ml-auto font-label text-[11px] text-tertiary underline hover:no-underline"
              >
                View saved report →
              </Link>
            </div>
          )}
          <RouteAnalysisReport result={singleResult} />
          {!singleResult.agent_evidence && (
            <button
              type="button"
              onClick={generateAgentAnalysis}
              disabled={agentLoading}
              className="rounded bg-tertiary px-4 py-2 text-sm font-medium text-on-tertiary transition-colors hover:bg-tertiary/80 disabled:opacity-50"
            >
              {agentLoading ? "Generating AI analysis…" : "Generate AI analysis (Market / Risk / Strategy)"}
            </button>
          )}
        </div>
      )}

      {!loading && mode === "compare" && compareResult && <RouteComparisonList result={compareResult} />}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RouteExplorerPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <RouteExplorerPageInner />
    </Suspense>
  );
}

function RouteExplorerPageInner() {
  const searchParams = useSearchParams();
  const presetDest = searchParams.get("dest");

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
            return {
              route,
              whatIf,
              previousPassengers: prevWhatIf.baseline.demand.passengers_carried,
              previousProfit: prevWhatIf.baseline.profit_usd,
            };
          })
        );

        if (!cancelled) {
          setBase({ routesData, rows });
          const presetValid = presetDest && routesData.routes.some((r) => r.destination === presetDest);
          setSelected(presetValid ? presetDest : routesData.routes[0]?.destination ?? null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setSelectedData(null);

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

  const { routesData, rows } = base;
  const selectedRow = rows.find((r) => r.route.destination === selected) ?? null;

  const cabinLabels: Record<string, string> = { economy: "ECONOMY", premium_economy: "PREMIUM ECON", business: "BUSINESS" };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-end justify-between gap-4 md:flex-row">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">Route Explorer</h1>
          <p className="flex items-center gap-2 text-sm text-on-surface-variant">
            <span className="material-symbols-outlined text-sm">location_on</span>
            {routesData.origin.iata} network intelligence ·{" "}
            <span className="text-tertiary">{rows.length} routes</span> · {DEFAULT_YEAR}/
            {DEFAULT_MONTH.toString().padStart(2, "0")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(rows)}
          className="glass-panel flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-on-surface transition-colors hover:bg-white/10"
        >
          <span className="material-symbols-outlined text-[18px] text-tertiary">download</span>
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Left: master table + new-route analysis */}
        <div className="flex flex-col gap-4 xl:col-span-8">
          <RouteProfitabilityTable rows={rows} selected={selected} onSelect={setSelected} />
          <AnalyzeNewRouteSection />
        </div>

        {/* Right: detail panel for the selected route */}
        <div className="xl:col-span-4">
          {selectedRow ? (
            <div className="glass-panel rim-light flex flex-col gap-6 overflow-hidden rounded-xl p-6">
              <div>
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded border border-tertiary/40 bg-tertiary/20 px-2 py-0.5 font-label text-[9px] font-bold tracking-tighter text-tertiary">
                        SELECTED ROUTE
                      </span>
                      <span className="font-label text-[10px] uppercase text-on-surface-variant">
                        {selectedRow.route.destination_name}
                      </span>
                    </div>
                    <h3 className="text-[32px] font-extrabold leading-tight tracking-tighter text-on-surface">
                      SYD <span className="text-tertiary">→</span> {selectedRow.route.destination}
                    </h3>
                  </div>
                  <span className={`rounded border px-3 py-1 font-label text-[10px] font-bold ${riskBadge(selectedRow).cls}`}>
                    {riskBadge(selectedRow).label}
                  </span>
                </div>

                {/* Revenue by cabin */}
                <div className="mb-6">
                  <label className="mb-3 block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                    Revenue by Cabin
                  </label>
                  <div className="space-y-3">
                    {Object.entries(selectedRow.whatIf.baseline.revenue.cabin_breakdown).map(([cabin, data]) => {
                      const total = selectedRow.whatIf.baseline.revenue.ticket_revenue_usd;
                      const pct = total > 0 ? (data.revenue_usd / total) * 100 : 0;
                      const highlight = cabin === "business";
                      return (
                        <div key={cabin}>
                          <div className="mb-1 flex justify-between text-[11px]">
                            <span className={`font-bold ${highlight ? "text-tertiary" : "text-on-surface"}`}>
                              {cabinLabels[cabin] ?? cabin.toUpperCase()}
                            </span>
                            <span className="text-on-surface-variant">
                              {fmtUsd(data.revenue_usd)} ({pct.toFixed(0)}%)
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/5">
                            <div
                              className={`h-full ${highlight ? "bg-tertiary" : "bg-on-surface-variant opacity-60"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Demand trend */}
                <div className="mb-6">
                  {selectedData ? (
                    <MiniBarPanel
                      title={`Demand forecast · ${selectedRow.route.destination}`}
                      icon="trending_up"
                      data={selectedData.demandSeries}
                    />
                  ) : (
                    <LoadingSpinner />
                  )}
                </div>

                {/* Competitor presence */}
                <div className="mb-6">
                  <label className="mb-3 block font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                    Competitor Presence
                  </label>
                  {selectedData ? (
                    selectedData.market.competitors.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedData.market.competitors.map((c) => {
                          const share =
                            selectedRow.whatIf.baseline.market_share.shares_by_carrier[c.name];
                          return (
                            <div
                              key={c.name}
                              className="glass-panel flex items-center gap-2 rounded-lg border-l-2 border-l-error px-3 py-2"
                            >
                              <span className="text-[10px] font-bold uppercase text-on-surface">{c.name}</span>
                              <div className="h-1 w-8 rounded-full bg-white/10">
                                <div
                                  className="h-full bg-error"
                                  style={{ width: `${Math.min((share ?? 0) * 100 * 2, 100)}%` }}
                                />
                              </div>
                              <span className="font-label text-[9px] text-on-surface-variant">
                                {share !== undefined ? `${(share * 100).toFixed(0)}%` : "—"}
                              </span>
                            </div>
                          );
                        })}
                        <div className="glass-panel flex items-center gap-2 rounded-lg border-l-2 border-l-tertiary px-3 py-2">
                          <span className="text-[10px] font-bold uppercase text-tertiary">Pacific Wings</span>
                          <span className="font-label text-[9px] font-bold text-tertiary">
                            {(selectedRow.whatIf.baseline.market_share.pacific_wings_share * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-on-surface-variant">No direct competitors on this route.</p>
                    )
                  ) : (
                    <p className="font-label text-[10px] text-on-surface-variant/60">Loading market context…</p>
                  )}
                </div>

                {/* Recommendation */}
                <div className="mb-6 rounded-xl border border-tertiary/20 bg-tertiary/5 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-tertiary">lightbulb</span>
                    <span className="font-label text-[10px] font-bold uppercase tracking-widest text-tertiary">
                      Boardroom Recommendation
                    </span>
                  </div>
                  <p className="mb-1 text-sm font-bold text-on-surface">{recommendation(selectedRow).label}</p>
                  <p className="text-[11px] leading-relaxed text-on-surface-variant">
                    {recommendation(selectedRow).body}
                  </p>
                </div>

                <Link
                  href={`/scenario-lab?dest=${selectedRow.route.destination}`}
                  className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl bg-secondary-container py-4 font-bold text-white shadow-lg transition-all hover:brightness-110 active:scale-[0.98]"
                >
                  <span className="font-label text-sm uppercase tracking-widest">Run Scenario on this Route</span>
                  <span className="material-symbols-outlined">analytics</span>
                </Link>
              </div>
            </div>
          ) : (
            <LoadingSpinner />
          )}
        </div>
      </div>
    </div>
  );
}
