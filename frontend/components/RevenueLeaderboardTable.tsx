import type { ProfitabilityRow } from "./RouteProfitabilityTable";

interface RevenueLeaderboardTableProps {
  rows: ProfitabilityRow[];
}

function fmtUsd(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function RevenueLeaderboardTable({ rows }: RevenueLeaderboardTableProps) {
  const sorted = [...rows].sort((a, b) => b.whatIf.baseline.profit_usd - a.whatIf.baseline.profit_usd);

  return (
    <div className="glass-panel overflow-hidden rounded-lg">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 p-4">
        <h3 className="text-lg font-semibold text-primary">Route Profitability Leaderboard</h3>
        <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
          Sorted by profit
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-black/20 font-label text-[10px] uppercase tracking-wider text-on-surface-variant">
            <tr>
              <th className="px-6 py-3 font-normal">Route</th>
              <th className="px-6 py-3 font-normal">Revenue</th>
              <th className="px-6 py-3 font-normal">Cost</th>
              <th className="px-6 py-3 font-normal">Profit</th>
              <th className="px-6 py-3 font-normal">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-sm">
            {sorted.map(({ route, whatIf }) => {
              const revenue = whatIf.baseline.revenue.total_revenue_usd;
              const cost = whatIf.baseline.cost.total_cost_usd;
              const profit = whatIf.baseline.profit_usd;
              const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

              return (
                <tr key={route.destination} className="transition-colors hover:bg-white/5">
                  <td className="px-6 py-4">
                    <div className="font-bold text-on-surface">SYD &rarr; {route.destination}</div>
                    <div className="font-label text-[10px] text-on-surface-variant/60">
                      {route.destination_name.toUpperCase()}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-on-surface">{fmtUsd(revenue)}</td>
                  <td className="px-6 py-4 text-on-surface-variant">{fmtUsd(cost)}</td>
                  <td className={`px-6 py-4 font-bold ${profit >= 0 ? "text-tertiary" : "text-error"}`}>
                    {fmtUsd(profit)}
                  </td>
                  <td className={`px-6 py-4 font-label ${margin >= 0 ? "text-tertiary" : "text-error"}`}>
                    {margin.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
