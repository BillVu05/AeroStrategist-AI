"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ScenarioResult } from "@/lib/types";

interface ComparisonChartsProps {
  baseline: ScenarioResult;
  scenario: ScenarioResult;
}

export default function ComparisonCharts({ baseline, scenario }: ComparisonChartsProps) {
  const data = [
    {
      metric: "Revenue",
      Baseline: baseline.revenue.total_revenue_usd,
      Scenario: scenario.revenue.total_revenue_usd,
    },
    {
      metric: "Cost",
      Baseline: baseline.cost.total_cost_usd,
      Scenario: scenario.cost.total_cost_usd,
    },
    {
      metric: "Profit",
      Baseline: baseline.profit_usd,
      Scenario: scenario.profit_usd,
    },
  ];

  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-900">Revenue, cost &amp; profit (USD)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="metric" />
          <YAxis tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`} />
          <Tooltip formatter={(value) => `$${Number(value).toLocaleString()}`} />
          <Legend />
          <Bar dataKey="Baseline" fill="#9ca3af" />
          <Bar dataKey="Scenario" fill="#2563eb" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
