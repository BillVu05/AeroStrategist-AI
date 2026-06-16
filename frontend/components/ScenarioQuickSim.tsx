"use client";

import { useState } from "react";
import { getWhatIf } from "@/lib/api";
import type { WhatIfResponse } from "@/lib/types";

interface ScenarioQuickSimProps {
  destination: string;
  year: number;
  month: number;
  baseFuelPrice: number;
}

function fmtUsd(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function deltaClass(value: number) {
  if (value > 0) return "text-tertiary";
  if (value < 0) return "text-error";
  return "text-on-surface-variant";
}

export default function ScenarioQuickSim({ destination, year, month, baseFuelPrice }: ScenarioQuickSimProps) {
  const [fuelPrice, setFuelPrice] = useState(baseFuelPrice);
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
        fuel_price_usd_per_gallon: fuelPrice,
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

  return (
    <div className="glass-panel rounded-lg border-l-2 border-tertiary p-4">
      <h5 className="mb-4 flex items-center justify-between font-label text-[10px] uppercase tracking-widest text-primary">
        Scenario simulator · {destination}
        <span className="material-symbols-outlined text-[16px] text-tertiary">science</span>
      </h5>
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="flex justify-between font-label text-[10px]">
            <span className="text-on-surface-variant">FUEL PRICE ($/gal)</span>
            <span className="font-bold text-tertiary">{fuelPrice.toFixed(2)}</span>
          </div>
          <input
            type="range"
            className="w-full"
            min={1}
            max={6}
            step={0.1}
            value={fuelPrice}
            onChange={(e) => setFuelPrice(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between font-label text-[10px]">
            <span className="text-on-surface-variant">FARE CHANGE (%)</span>
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
            <span className="text-on-surface-variant">FREQUENCY DELTA (flights/wk)</span>
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
          {loading ? "Running…" : "Run scenario"}
        </button>

        {error && <p className="text-xs text-error">{error}</p>}

        {result && (
          <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-center">
            <div>
              <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Profit Δ</p>
              <p className={`text-sm font-semibold ${deltaClass(result.delta.profit_usd)}`}>
                {fmtUsd(result.delta.profit_usd)}
              </p>
            </div>
            <div>
              <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Pax Δ</p>
              <p className={`text-sm font-semibold ${deltaClass(result.delta.passengers_carried)}`}>
                {result.delta.passengers_carried > 0 ? "+" : ""}
                {result.delta.passengers_carried.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Share Δ</p>
              <p className={`text-sm font-semibold ${deltaClass(result.delta.pacific_wings_share)}`}>
                {result.delta.pacific_wings_share > 0 ? "+" : ""}
                {(result.delta.pacific_wings_share * 100).toFixed(1)}pp
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
