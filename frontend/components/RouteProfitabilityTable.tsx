import type { RouteInfo, WhatIfResponse } from "@/lib/types";
import { fmtUsd } from "@/lib/format";

export interface ProfitabilityRow {
  route: RouteInfo;
  whatIf: WhatIfResponse;
  /** Passengers carried in the prior month, for the trend arrow. */
  previousPassengers?: number;
  /** Profit in the prior month, for the profitability trend column. */
  previousProfit?: number;
}

interface RouteProfitabilityTableProps {
  rows: ProfitabilityRow[];
  selected: string | null;
  onSelect: (destination: string) => void;
}


function profitTrend(row: ProfitabilityRow) {
  if (row.previousProfit === undefined || row.previousProfit === 0) return null;
  return ((row.whatIf.baseline.profit_usd - row.previousProfit) / Math.abs(row.previousProfit)) * 100;
}

export default function RouteProfitabilityTable({ rows, selected, onSelect }: RouteProfitabilityTableProps) {
  return (
    <div className="glass-panel rim-light overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-6 py-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-tertiary">
          <span className="material-symbols-outlined">table_chart</span>
          Active Route Performance
        </h3>
        <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
          {rows.length} routes
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-white/5 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
              <th className="px-6 py-4 font-semibold">Route</th>
              <th className="px-6 py-4 font-semibold">Profitability</th>
              <th className="px-6 py-4 text-right font-semibold">Revenue (USD)</th>
              <th className="px-6 py-4 font-semibold">Load Factor</th>
              <th className="px-6 py-4 text-center font-semibold">Market Share</th>
              <th className="px-6 py-4" />
            </tr>
          </thead>
          <tbody className="text-sm">
            {rows.map((row) => {
              const { route, whatIf } = row;
              const isSelected = selected === route.destination;
              const trend = profitTrend(row);
              const loadFactor = whatIf.baseline.demand.load_factor;
              const share = whatIf.baseline.market_share.pacific_wings_share;
              const profitable = whatIf.baseline.profit_usd >= 0;

              return (
                <tr
                  key={route.destination}
                  onClick={() => onSelect(route.destination)}
                  className={`group cursor-pointer border-b border-white/5 transition-colors ${
                    isSelected ? "glass-panel-active" : "hover:bg-white/5"
                  }`}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded border transition-colors ${
                          isSelected
                            ? "border-white/20 bg-tertiary"
                            : "border-white/10 bg-surface-container-high group-hover:border-tertiary/50"
                        }`}
                      >
                        <span
                          className={`material-symbols-outlined text-sm ${
                            isSelected ? "text-on-tertiary" : "text-tertiary"
                          }`}
                        >
                          flight
                        </span>
                      </div>
                      <div>
                        <span className={`font-bold tracking-tight ${isSelected ? "text-tertiary" : "text-on-surface"}`}>
                          SYD-{route.destination}
                        </span>
                        <div className="font-label text-[10px] text-on-surface-variant/60">
                          {route.destination_name.toUpperCase()}
                          {route.status === "candidate" && <span className="ml-1 text-secondary">· CANDIDATE</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {trend !== null ? (
                      <div
                        className={`flex items-center gap-2 ${
                          trend >= 0 ? "text-tertiary" : "text-error"
                        } ${isSelected ? "font-bold" : ""}`}
                      >
                        <span className="material-symbols-outlined text-sm">
                          {trend >= 0 ? "trending_up" : "trending_down"}
                        </span>
                        {trend >= 0 ? "+" : ""}
                        {trend.toFixed(1)}%
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-on-surface-variant">
                        <span className="material-symbols-outlined text-sm">horizontal_rule</span>—
                      </div>
                    )}
                  </td>
                  <td className={`px-6 py-4 text-right font-bold ${profitable ? "text-on-surface" : "text-error"}`}>
                    {fmtUsd(whatIf.baseline.revenue.total_revenue_usd)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full bg-tertiary"
                        style={{ width: `${Math.min(loadFactor * 100, 100)}%`, opacity: isSelected ? 1 : 0.7 }}
                      />
                    </div>
                    <p className={`mt-1 text-right text-[10px] ${isSelected ? "text-tertiary" : "text-on-surface-variant"}`}>
                      {(loadFactor * 100).toFixed(1)}%
                    </p>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span
                      className={`rounded border px-2 py-0.5 text-[10px] ${
                        isSelected
                          ? "border-tertiary/40 bg-tertiary/20 font-bold text-tertiary"
                          : "border-white/10 bg-white/5"
                      }`}
                    >
                      {(share * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span
                      className={`material-symbols-outlined ${
                        isSelected
                          ? "text-tertiary"
                          : "text-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100"
                      }`}
                    >
                      {isSelected ? "analytics" : "chevron_right"}
                    </span>
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
