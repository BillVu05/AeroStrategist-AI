"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface ProfitByRouteChartProps {
  data: { destination: string; profit_usd: number }[];
}

export default function ProfitByRouteChart({ data }: ProfitByRouteChartProps) {
  return (
    <div className="glass-panel rounded-lg p-4">
      <h3 className="mb-2 font-label text-xs uppercase tracking-widest text-primary">
        Monthly profit by route (USD)
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
          <XAxis dataKey="destination" stroke="#c6c6cc" tick={{ fill: "#c6c6cc" }} />
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
          <Bar dataKey="profit_usd" fill="#4cd7f6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
