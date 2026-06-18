"use client";

import { useState } from "react";
import { getAnalyzeRoute, getAnalyzeRouteAgents, getCompareRoutes } from "@/lib/api";
import type { AnalyzeRouteResponse, CompareRoutesResponse, OpenRouteFormValue } from "@/lib/types";
import OpenRouteForm from "@/components/OpenRouteForm";
import { RouteAnalysisReport, RouteComparisonList } from "@/components/RouteAnalysisCard";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";

const DEFAULT_FORM: OpenRouteFormValue = {
  destination: "",
  weekly_frequency: 3,
};

type Mode = "single" | "compare";

export default function OpenRoutePage() {
  const [form, setForm] = useState<OpenRouteFormValue>(DEFAULT_FORM);
  const [comparisonList, setComparisonList] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("single");
  const [singleResult, setSingleResult] = useState<AnalyzeRouteResponse | null>(null);
  const [compareResult, setCompareResult] = useState<CompareRoutesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ iata: string; city: string; country: string }[]>([]);

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
    try {
      const res = await getAnalyzeRoute(form);
      if (res.error) {
        setError(res.error);
        setSuggestions((res.suggestions ?? []) as { iata: string; city: string; country: string }[]);
        setSingleResult(null);
      } else {
        setSingleResult(res);
        setMode("single");
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
      setSingleResult({ ...singleResult, agent_evidence: res.agent_evidence });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAgentLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-on-surface">Open Route Analysis</h1>
        <p className="text-sm text-on-surface-variant">
          Strategic screening for any worldwide destination — not limited to Pacific Wings&apos; existing
          network. Figures are order-of-magnitude estimates (gravity-model demand ±40%, financials ±30%); see
          docs/data_methodology.md.
        </p>
      </div>

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
        <div className="space-y-2">
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

      {loading && <LoadingSpinner />}

      {!loading && mode === "single" && singleResult && (
        <div className="space-y-3">
          <RouteAnalysisReport result={singleResult} />
          {!singleResult.agent_evidence && (
            <button
              type="button"
              onClick={generateAgentAnalysis}
              disabled={agentLoading}
              className="rounded bg-tertiary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-tertiary/80 disabled:opacity-50"
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
