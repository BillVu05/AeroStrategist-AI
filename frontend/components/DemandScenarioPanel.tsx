"use client";

import { useState } from "react";
import { getWhatIf } from "@/lib/api";
import type { WhatIfResponse } from "@/lib/types";

interface DemandScenarioPanelProps {
  destination: string;
  year: number;
  month: number;
}

export default function DemandScenarioPanel({ destination, year, month }: DemandScenarioPanelProps) {
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

  const demand = result?.scenario.demand;
  const passengerDelta = result ? demand!.passengers_carried - result.baseline.demand.passengers_carried : null;

  return (
    <div className="glass-panel rounded-lg border-l-2 border-tertiary p-4">
      <h5 className="mb-4 flex items-center justify-between font-label text-[10px] uppercase tracking-widest text-primary">
        Forecast modifiers · {destination}
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
            min={-30}
            max={30}
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

        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="w-full rounded bg-accent-blue py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Running…" : "Run forecast"}
        </button>

        {error && <p className="text-xs text-error">{error}</p>}

        {demand && passengerDelta !== null && (
          <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-center">
            <div>
              <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Demand Δ</p>
              <p className={`text-sm font-semibold ${passengerDelta >= 0 ? "text-tertiary" : "text-error"}`}>
                {passengerDelta > 0 ? "+" : ""}
                {passengerDelta.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Load factor</p>
              <p className="text-sm font-semibold text-primary">{(demand.load_factor * 100).toFixed(1)}%</p>
            </div>
            <div>
              <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                Capacity-bound
              </p>
              <p className={`text-sm font-semibold ${demand.demand_constrained_by_capacity ? "text-error" : "text-tertiary"}`}>
                {demand.demand_constrained_by_capacity ? "Yes" : "No"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
