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
    <div className="rounded border border-gray-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-900">Monthly profit by route (USD)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="destination" />
          <YAxis tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`} />
          <Tooltip formatter={(value) => `$${Number(value).toLocaleString()}`} />
          <Bar dataKey="profit_usd" fill="#2563eb" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
