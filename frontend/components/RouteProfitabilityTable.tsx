import type { RouteInfo, WhatIfResponse } from "@/lib/types";

export interface ProfitabilityRow {
  route: RouteInfo;
  whatIf: WhatIfResponse;
  /** Passengers carried in the prior month, for the trend arrow. */
  previousPassengers?: number;
}

interface RouteProfitabilityTableProps {
  rows: ProfitabilityRow[];
  selected: string | null;
  onSelect: (destination: string) => void;
}

function fmtUsd(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function riskBadge(profitUsd: number, revenueUsd: number) {
  const margin = revenueUsd > 0 ? profitUsd / revenueUsd : 0;
  if (profitUsd < 0) {
    return { label: "HIGH THREAT", cls: "bg-error-container text-on-error-container border-error/20" };
  }
  if (margin < 0.1) {
    return { label: "MEDIUM", cls: "bg-secondary/10 text-secondary border-secondary/20" };
  }
  return { label: "LOW", cls: "bg-tertiary/10 text-tertiary border-tertiary/20" };
}

function recommendation(row: ProfitabilityRow) {
  const { whatIf, route } = row;
  const profit = whatIf.baseline.profit_usd;
  const loadFactor = whatIf.baseline.demand.load_factor;

  if (profit < 0) {
    return { label: "SUSPEND ROUTE", icon: "cancel", cls: "text-error" };
  }
  if (route.status === "candidate") {
    return { label: "LAUNCH NOW", icon: "check_circle", cls: "text-tertiary" };
  }
  if (loadFactor > 0.85) {
    return { label: "ANALYZE CAPACITY", icon: "info", cls: "text-on-tertiary-container" };
  }
  return { label: "MAINTAIN", icon: "pause_circle", cls: "text-on-surface-variant" };
}

export default function RouteProfitabilityTable({ rows, selected, onSelect }: RouteProfitabilityTableProps) {
  return (
    <div className="glass-panel overflow-hidden rounded-lg">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 p-4">
        <h3 className="text-lg font-semibold text-primary">Route Profitability Index</h3>
        <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
          {rows.length} routes
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-black/20 font-label text-[10px] uppercase tracking-wider text-on-surface-variant">
            <tr>
              <th className="px-6 py-3 font-normal">Origin / Dest</th>
              <th className="px-6 py-3 font-normal">Est. Demand</th>
              <th className="px-6 py-3 font-normal">Revenue</th>
              <th className="px-6 py-3 font-normal">Risk</th>
              <th className="px-6 py-3 font-normal">Net Profit</th>
              <th className="px-6 py-3 font-normal">Recommendation</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-sm">
            {rows.map((row) => {
              const { route, whatIf, previousPassengers } = row;
              const passengers = whatIf.baseline.demand.passengers_carried;
              const trendPct =
                previousPassengers && previousPassengers > 0
                  ? ((passengers - previousPassengers) / previousPassengers) * 100
                  : null;
              const risk = riskBadge(whatIf.baseline.profit_usd, whatIf.baseline.revenue.total_revenue_usd);
              const rec = recommendation(row);

              return (
                <tr
                  key={route.destination}
                  onClick={() => onSelect(route.destination)}
                  className={`cursor-pointer transition-colors hover:bg-white/5 ${
                    selected === route.destination ? "bg-tertiary/5" : ""
                  }`}
                >
                  <td className="px-6 py-4">
                    <div className="font-bold text-on-surface">SYD → {route.destination}</div>
                    <div className="font-label text-[10px] text-on-surface-variant/60">
                      {route.destination_name.toUpperCase()}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-on-surface">
                    {passengers.toLocaleString()}
                    {trendPct !== null && (
                      <span className={`ml-2 font-label text-xs ${trendPct >= 0 ? "text-tertiary" : "text-error"}`}>
                        {trendPct >= 0 ? "+" : ""}
                        {trendPct.toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-on-surface">{fmtUsd(whatIf.baseline.revenue.total_revenue_usd)}</td>
                  <td className="px-6 py-4">
                    <span className={`rounded border px-2 py-0.5 text-[10px] ${risk.cls}`}>{risk.label}</span>
                  </td>
                  <td
                    className={`px-6 py-4 font-bold ${
                      whatIf.baseline.profit_usd >= 0 ? "text-tertiary" : "text-error"
                    }`}
                  >
                    {fmtUsd(whatIf.baseline.profit_usd)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`flex items-center gap-2 font-label text-xs ${rec.cls}`}>
                      <span className="material-symbols-outlined text-[16px]">{rec.icon}</span>
                      {rec.label}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(route.destination);
                      }}
                      className="font-label text-xs text-tertiary hover:underline"
                    >
                      DETAILS
                    </button>
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
