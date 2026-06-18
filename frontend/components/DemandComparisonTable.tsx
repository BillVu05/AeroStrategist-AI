import type { RouteInfo } from "@/lib/types";

export interface DemandComparisonRow {
  route: RouteInfo;
  monthlyDemand: number;
  monthlyDemandLow: number;
  monthlyDemandHigh: number;
  avgFareUsd: number;
  loadFactor: number;
  yoyGrowthPct: number;
}

interface DemandComparisonTableProps {
  rows: DemandComparisonRow[];
}

function outlookBadge(row: DemandComparisonRow) {
  if (row.loadFactor > 0.95) {
    return { label: "CAPACITY CRITICAL", cls: "bg-error-container text-on-error-container border-error/20" };
  }
  if (row.yoyGrowthPct > 10) {
    return { label: "HIGH OPPORTUNITY", cls: "bg-tertiary/10 text-tertiary border-tertiary/20" };
  }
  if (row.yoyGrowthPct > 0) {
    return { label: "GROWING", cls: "bg-secondary/10 text-secondary border-secondary/20" };
  }
  return { label: "SOFTENING", cls: "bg-white/5 text-on-surface-variant border-white/10" };
}

export default function DemandComparisonTable({ rows }: DemandComparisonTableProps) {
  const sorted = [...rows].sort((a, b) => b.monthlyDemand - a.monthlyDemand);

  return (
    <div className="glass-panel overflow-hidden rounded-lg">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 p-4">
        <h3 className="text-lg font-semibold text-primary">Market-Wide Demand Comparison</h3>
        <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
          {rows.length} routes
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-black/20 font-label text-[10px] uppercase tracking-wider text-on-surface-variant">
            <tr>
              <th className="px-6 py-3 font-normal">Route</th>
              <th className="px-6 py-3 font-normal">Monthly Demand</th>
              <th className="px-6 py-3 font-normal" title="80% empirical prediction interval from the demand model's real holdout residuals">
                80% Range
              </th>
              <th className="px-6 py-3 font-normal">Avg Fare</th>
              <th className="px-6 py-3 font-normal">Load Factor</th>
              <th className="px-6 py-3 font-normal">YoY Growth</th>
              <th className="px-6 py-3 font-normal">Outlook</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-sm">
            {sorted.map((row) => {
              const badge = outlookBadge(row);
              return (
                <tr key={row.route.destination} className="transition-colors hover:bg-white/5">
                  <td className="px-6 py-4">
                    <div className="font-bold text-on-surface">SYD &rarr; {row.route.destination}</div>
                    <div className="font-label text-[10px] text-on-surface-variant/60">
                      {row.route.destination_name.toUpperCase()}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-on-surface">{Math.round(row.monthlyDemand).toLocaleString()}</td>
                  <td className="px-6 py-4 text-on-surface-variant">
                    {Math.round(row.monthlyDemandLow).toLocaleString()} &ndash; {Math.round(row.monthlyDemandHigh).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-on-surface">${row.avgFareUsd.toFixed(0)}</td>
                  <td className="px-6 py-4 text-on-surface">{(row.loadFactor * 100).toFixed(1)}%</td>
                  <td className={`px-6 py-4 font-bold ${row.yoyGrowthPct >= 0 ? "text-tertiary" : "text-error"}`}>
                    {row.yoyGrowthPct >= 0 ? "+" : ""}
                    {row.yoyGrowthPct.toFixed(1)}%
                  </td>
                  <td className="px-6 py-4">
                    <span className={`rounded border px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
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
