import type { ScenarioResult, WhatIfResponse } from "@/lib/types";

interface ComparisonCardsProps {
  baseline: ScenarioResult;
  scenario: ScenarioResult;
  delta: WhatIfResponse["delta"];
}

function fmtUsd(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function deltaClass(value: number) {
  if (value > 0) return "text-green-600";
  if (value < 0) return "text-red-600";
  return "text-gray-500";
}

function signed(value: string, raw: number) {
  return raw > 0 ? `+${value}` : value;
}

export default function ComparisonCards({ baseline, scenario, delta }: ComparisonCardsProps) {
  const revenueDelta = scenario.revenue.total_revenue_usd - baseline.revenue.total_revenue_usd;
  const costDelta = scenario.cost.total_cost_usd - baseline.cost.total_cost_usd;
  const loadFactorDelta = scenario.demand.load_factor - baseline.demand.load_factor;

  const rows: { label: string; baseline: string; scenario: string; delta: string; deltaRaw: number }[] = [
    {
      label: "Profit",
      baseline: fmtUsd(baseline.profit_usd),
      scenario: fmtUsd(scenario.profit_usd),
      delta: signed(fmtUsd(delta.profit_usd), delta.profit_usd),
      deltaRaw: delta.profit_usd,
    },
    {
      label: "Revenue",
      baseline: fmtUsd(baseline.revenue.total_revenue_usd),
      scenario: fmtUsd(scenario.revenue.total_revenue_usd),
      delta: signed(fmtUsd(revenueDelta), revenueDelta),
      deltaRaw: revenueDelta,
    },
    {
      label: "Cost",
      baseline: fmtUsd(baseline.cost.total_cost_usd),
      scenario: fmtUsd(scenario.cost.total_cost_usd),
      delta: signed(fmtUsd(costDelta), costDelta),
      deltaRaw: -costDelta, // higher cost is a worse outcome
    },
    {
      label: "Passengers carried",
      baseline: baseline.demand.passengers_carried.toLocaleString(),
      scenario: scenario.demand.passengers_carried.toLocaleString(),
      delta: signed(delta.passengers_carried.toLocaleString(), delta.passengers_carried),
      deltaRaw: delta.passengers_carried,
    },
    {
      label: "Load factor",
      baseline: fmtPct(baseline.demand.load_factor),
      scenario: fmtPct(scenario.demand.load_factor),
      delta: signed(fmtPct(loadFactorDelta), loadFactorDelta),
      deltaRaw: loadFactorDelta,
    },
    {
      label: "Pacific Wings market share",
      baseline: fmtPct(baseline.market_share.pacific_wings_share),
      scenario: fmtPct(scenario.market_share.pacific_wings_share),
      delta: signed(fmtPct(delta.pacific_wings_share), delta.pacific_wings_share),
      deltaRaw: delta.pacific_wings_share,
    },
  ];

  return (
    <div className="overflow-x-auto rounded border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="p-3">Metric</th>
            <th className="p-3 text-right">Baseline</th>
            <th className="p-3 text-right">Scenario</th>
            <th className="p-3 text-right">Delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-gray-100 last:border-0">
              <td className="p-3 text-gray-700">{row.label}</td>
              <td className="p-3 text-right font-medium">{row.baseline}</td>
              <td className="p-3 text-right font-medium">{row.scenario}</td>
              <td className={`p-3 text-right font-medium ${deltaClass(row.deltaRaw)}`}>{row.delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
