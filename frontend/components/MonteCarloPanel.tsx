"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getMonteCarlo } from "@/lib/api";
import type { MonteCarloResponse, ScenarioInput } from "@/lib/types";

interface MonteCarloPanelProps {
  input: ScenarioInput;
}

const N_SIMULATIONS = 500;

function fmtUsd(v: number) {
  const sign = v < 0 ? "-" : "";
  return `${sign}$${(Math.abs(v) / 1000).toFixed(0)}k`;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-2 text-center">
      <p className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">{label}</p>
      <p className={`text-sm font-bold ${accent ?? "text-on-surface"}`}>{value}</p>
    </div>
  );
}

export default function MonteCarloPanel({ input }: MonteCarloPanelProps) {
  const [result, setResult] = useState<MonteCarloResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await getMonteCarlo({
        destination: input.destination,
        year: input.year,
        month: input.month,
        n_simulations: N_SIMULATIONS,
        price_delta_pct: input.price_delta_pct,
        frequency_delta: input.frequency_delta,
        aircraft_type: input.aircraft_type,
        rating_delta: input.rating_delta,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const histogramData = result
    ? result.profit_histogram.counts.map((count, i) => {
        const lo = result.profit_histogram.bin_edges[i];
        const hi = result.profit_histogram.bin_edges[i + 1];
        return { bin: fmtUsd((lo + hi) / 2), count };
      })
    : [];

  return (
    <div className="glass-panel rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-label text-xs uppercase tracking-widest text-primary">
          Monte Carlo Risk Simulation
        </h3>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded bg-accent-blue px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Simulating…" : `Run ${N_SIMULATIONS} simulations`}
        </button>
      </div>

      {error && <p className="text-xs text-error">{error}</p>}

      {!result && !error && (
        <p className="text-xs text-on-surface-variant">
          Randomizes fuel price, GDP growth, and competitor entry across many trials to show a range of
          outcomes instead of one number — current manual deltas (price/frequency/aircraft/rating) are held
          fixed across all trials.
        </p>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="P10 profit" value={fmtUsd(result.profit_usd.p10)} />
            <Stat label="Median profit" value={fmtUsd(result.profit_usd.p50)} />
            <Stat label="P90 profit" value={fmtUsd(result.profit_usd.p90)} />
            <Stat
              label="Probability of loss"
              value={`${(result.probability_of_loss * 100).toFixed(1)}%`}
              accent={result.probability_of_loss > 0.2 ? "text-error" : "text-tertiary"}
            />
          </div>

          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={histogramData}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
              <XAxis dataKey="bin" stroke="#c6c6cc" tick={{ fill: "#c6c6cc", fontSize: 10 }} interval={2} />
              <YAxis stroke="#c6c6cc" tick={{ fill: "#c6c6cc" }} allowDecimals={false} />
              <Tooltip
                formatter={(value) => [`${value} trials`, "Count"]}
                contentStyle={{ background: "#1e2020", border: "1px solid rgba(255,255,255,0.1)" }}
                labelStyle={{ color: "#e2e2e2" }}
                itemStyle={{ color: "#e2e2e2" }}
              />
              <Bar dataKey="count" fill="#4cd7f6" />
            </BarChart>
          </ResponsiveContainer>

          <details className="text-xs text-on-surface-variant">
            <summary className="cursor-pointer font-label uppercase tracking-widest text-on-surface-variant/70">
              What&apos;s randomized, and why
            </summary>
            <ul className="mt-2 space-y-1.5">
              {Object.entries(result.assumptions).map(([key, a]) => (
                <li key={key}>
                  <span className="font-medium text-on-surface">{key}</span>: {a.distribution} — {a.source}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
