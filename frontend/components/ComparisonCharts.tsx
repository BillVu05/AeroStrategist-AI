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
    <div className="glass-panel rounded-lg p-4">
      <h3 className="mb-2 font-label text-xs uppercase tracking-widest text-primary">
        Revenue, cost &amp; profit (USD)
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
          <XAxis dataKey="metric" stroke="#c6c6cc" tick={{ fill: "#c6c6cc" }} />
          <YAxis
            stroke="#c6c6cc"
            tick={{ fill: "#c6c6cc" }}
            tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`}
          />
          <Tooltip
            formatter={(value) => `$${Number(value).toLocaleString()}`}
            contentStyle={{ background: "#1e2020", border: "1px solid rgba(255,255,255,0.1)" }}
            labelStyle={{ color: "#e2e2e2" }}
            itemStyle={{ color: "#e2e2e2" }}
          />
          <Legend wrapperStyle={{ color: "#c6c6cc" }} />
          <Bar dataKey="Baseline" fill="#909096" />
          <Bar dataKey="Scenario" fill="#4cd7f6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
