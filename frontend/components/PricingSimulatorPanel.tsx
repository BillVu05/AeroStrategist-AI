"use client";

import { useState } from "react";
import { getWhatIf } from "@/lib/api";
import type { WhatIfResponse } from "@/lib/types";

interface PricingSimulatorPanelProps {
  destination: string;
  year: number;
  month: number;
}

function fmtUsdDelta(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function deltaClass(value: number) {
  if (value > 0) return "text-tertiary";
  if (value < 0) return "text-error";
  return "text-on-surface-variant";
}

export default function PricingSimulatorPanel({ destination, year, month }: PricingSimulatorPanelProps) {
  const [priceDeltaPct, setPriceDeltaPct] = useState(0);
  const [frequencyDelta, setFrequencyDelta] = useState(0);
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await getWhatIf({
        destination,
        year,
        month,
        price_delta_pct: priceDeltaPct / 100,
        frequency_delta: frequencyDelta,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const revenueImpact = result
    ? result.scenario.revenue.total_revenue_usd - result.baseline.revenue.total_revenue_usd
    : null;

  return (
    <div className="glass-panel rounded-lg border-l-2 border-tertiary p-4">
      <h5 className="mb-4 flex items-center justify-between font-label text-[10px] uppercase tracking-widest text-primary">
        AI pricing simulator · {destination}
        <span className="material-symbols-outlined text-[16px] text-tertiary">tune</span>
      </h5>
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="flex justify-between font-label text-[10px]">
            <span className="text-on-surface-variant">TICKET PRICE ADJUSTMENT (%)</span>
            <span className="font-bold text-tertiary">
              {priceDeltaPct > 0 ? "+" : ""}
              {priceDeltaPct}
            </span>
          </div>
          <input
            type="range"
            className="w-full"
            min={-20}
            max={20}
            step={1}
            value={priceDeltaPct}
            onChange={(e) => setPriceDeltaPct(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between font-label text-[10px]">
            <span className="text-on-surface-variant">FLIGHT FREQUENCY (Δ/wk)</span>
            <span className="font-bold text-tertiary">
              {frequencyDelta > 0 ? "+" : ""}
              {frequencyDelta}
            </span>
          </div>
          <input
            type="range"
            className="w-full"
            min={-5}
            max={5}
            step={1}
            value={frequencyDelta}
            onChange={(e) => setFrequencyDelta(Number(e.target.value))}
          />
        </div>

        {/* Demand elasticity display */}
        <div className="flex items-center justify-between rounded border border-white/10 bg-black/20 px-3 py-2">
          <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Demand Elasticity
          </span>
          <span className="font-label text-sm font-bold text-secondary">
            {Math.abs(priceDeltaPct) > 0
              ? `${(0.82 + priceDeltaPct * 0.003).toFixed(2)}β`
              : "0.82β"}
          </span>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="w-full rounded bg-accent-blue py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Running…" : "Apply Strategy to Network"}
        </button>

        {error && <p className="text-xs text-error">{error}</p>}

        {result && revenueImpact !== null && (
          <div className="space-y-2 border-t border-white/10 pt-3">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60 mb-2">
              Impact Projections
            </div>
            {[
              { label: "Revenue impact", value: fmtUsdDelta(revenueImpact), cls: deltaClass(revenueImpact) },
              { label: "Profit impact", value: fmtUsdDelta(result.delta.profit_usd), cls: deltaClass(result.delta.profit_usd) },
              { label: "Load factor", value: `${(result.scenario.demand.load_factor * 100).toFixed(1)}%`, cls: "text-primary" },
              {
                label: "Passenger count",
                value: `${result.delta.passengers_carried > 0 ? "+" : ""}${result.delta.passengers_carried.toLocaleString()}`,
                cls: deltaClass(result.delta.passengers_carried),
              },
            ].map(({ label, value, cls }) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="font-label text-[10px] text-on-surface-variant">{label}</span>
                <span className={`font-label text-xs font-bold ${cls}`}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
