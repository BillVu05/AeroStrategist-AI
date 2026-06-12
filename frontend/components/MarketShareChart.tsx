"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { MarketShare } from "@/lib/types";

const COLORS = ["#2563eb", "#f97316", "#16a34a", "#9333ea", "#dc2626", "#0891b2"];

function toPieData(shares: MarketShare) {
  return Object.entries(shares.shares_by_carrier).map(([name, value]) => ({ name, value }));
}

function SharePie({ title, shares }: { title: string; shares: MarketShare }) {
  const data = toPieData(shares);

  return (
    <div>
      <h4 className="mb-2 text-center text-sm font-medium text-gray-700">{title}</h4>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => `${(Number(value) * 100).toFixed(1)}%`} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

interface MarketShareChartProps {
  baseline: MarketShare;
  scenario: MarketShare;
}

export default function MarketShareChart({ baseline, scenario }: MarketShareChartProps) {
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-900">Market share by carrier</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SharePie title="Baseline" shares={baseline} />
        <SharePie title="Scenario" shares={scenario} />
      </div>
    </div>
  );
}
