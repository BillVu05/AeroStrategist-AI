"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { MarketShare } from "@/lib/types";

const COLORS = ["#4cd7f6", "#1e40af", "#b8c4ff", "#22c55e", "#f59e0b", "#ffb4ab"];

function toPieData(shares: MarketShare) {
  return Object.entries(shares.shares_by_carrier).map(([name, value]) => ({ name, value }));
}

function SharePie({ title, shares }: { title: string; shares: MarketShare }) {
  const data = toPieData(shares);

  return (
    <div>
      <h4 className="mb-2 text-center font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
        {title}
      </h4>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => `${(Number(value) * 100).toFixed(1)}%`}
            contentStyle={{ background: "#1e2020", border: "1px solid rgba(255,255,255,0.1)" }}
            labelStyle={{ color: "#e2e2e2" }}
            itemStyle={{ color: "#e2e2e2" }}
          />
          <Legend wrapperStyle={{ color: "#c6c6cc" }} />
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
    <div className="glass-panel rounded-lg p-4">
      <h3 className="mb-2 font-label text-xs uppercase tracking-widest text-primary">
        Market share by carrier
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SharePie title="Baseline" shares={baseline} />
        <SharePie title="Scenario" shares={scenario} />
      </div>
    </div>
  );
}
