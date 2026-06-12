"use client";

import { useEffect, useState } from "react";
import { getCopilot, getWhatIfPresets } from "@/lib/api";
import type { CopilotResponse, ScenarioInput, WhatIfPresets } from "@/lib/types";
import { ALL_DESTINATIONS, DEFAULT_MONTH, DEFAULT_YEAR } from "@/lib/constants";
import ScenarioForm from "@/components/ScenarioForm";
import CopilotReport from "@/components/CopilotReport";
import ErrorMessage from "@/components/ErrorMessage";

function deltaClass(value: number) {
  if (value > 0) return "text-green-600";
  if (value < 0) return "text-red-600";
  return "text-gray-500";
}

function StatCard({ label, value, raw }: { label: string; value: string; raw: number }) {
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold ${deltaClass(raw)}`}>{value}</dd>
    </div>
  );
}

export default function CopilotPage() {
  const [presets, setPresets] = useState<WhatIfPresets>({});
  const [input, setInput] = useState<ScenarioInput>({
    destination: ALL_DESTINATIONS[0],
    year: DEFAULT_YEAR,
    month: DEFAULT_MONTH,
  });
  const [result, setResult] = useState<CopilotResponse | null>(null);
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
      const res = await getCopilot(input);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-gray-900">AI Strategy Assistant</h1>

      <ScenarioForm
        value={input}
        onChange={setInput}
        presets={presets}
        onSubmit={runScenario}
        loading={loading}
        submitLabel="Ask AI Assistant"
      />

      {error && (
        <div className="mt-4">
          <ErrorMessage message={error} />
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Profit delta"
              value={`${result.finance.delta.profit_usd >= 0 ? "+" : ""}$${result.finance.delta.profit_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              raw={result.finance.delta.profit_usd}
            />
            <StatCard
              label="Passengers carried delta"
              value={`${result.demand.delta.passengers_carried >= 0 ? "+" : ""}${result.demand.delta.passengers_carried.toLocaleString()}`}
              raw={result.demand.delta.passengers_carried}
            />
            <StatCard
              label="Load factor delta"
              value={`${result.demand.delta.load_factor >= 0 ? "+" : ""}${(result.demand.delta.load_factor * 100).toFixed(1)}%`}
              raw={result.demand.delta.load_factor}
            />
          </div>

          <CopilotReport
            marketAnalysis={result.market_analysis}
            riskAnalysis={result.risk_analysis}
            strategy={result.strategy}
          />
        </div>
      )}
    </div>
  );
}
