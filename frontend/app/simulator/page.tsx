"use client";

import { useEffect, useState } from "react";
import { getWhatIf, getWhatIfPresets } from "@/lib/api";
import type { ScenarioInput, WhatIfPresets, WhatIfResponse } from "@/lib/types";
import { ALL_DESTINATIONS, DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import ScenarioForm from "@/components/ScenarioForm";
import ComparisonCards from "@/components/ComparisonCards";
import ComparisonCharts from "@/components/ComparisonCharts";
import MarketShareChart from "@/components/MarketShareChart";
import ErrorMessage from "@/components/ErrorMessage";

export default function ScenarioSimulatorPage() {
  const [presets, setPresets] = useState<WhatIfPresets>({});
  const [input, setInput] = useState<ScenarioInput>({
    destination: ALL_DESTINATIONS[0],
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
      <h1 className="mb-4 text-2xl font-semibold text-on-surface">Scenario Simulator</h1>

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
        </div>
      )}
    </div>
  );
}
