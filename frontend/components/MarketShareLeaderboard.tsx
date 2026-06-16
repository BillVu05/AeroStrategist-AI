import type { MarketContext, RouteInfo, WhatIfResponse } from "@/lib/types";

export interface MarketRow {
  route: RouteInfo;
  whatIf: WhatIfResponse;
  market: MarketContext;
}

interface MarketShareLeaderboardProps {
  rows: MarketRow[];
}

export default function MarketShareLeaderboard({ rows }: MarketShareLeaderboardProps) {
  return (
    <div className="glass-panel overflow-hidden rounded-lg">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 p-4">
        <h3 className="text-lg font-semibold text-primary">Market Share Leaderboard</h3>
        <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
          {rows.length} routes
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-black/20 font-label text-[10px] uppercase tracking-wider text-on-surface-variant">
            <tr>
              <th className="px-6 py-3 font-normal">Route</th>
              <th className="px-6 py-3 font-normal">PW Share</th>
              <th className="px-6 py-3 font-normal">Top Competitor</th>
              <th className="px-6 py-3 font-normal">Competitor Share</th>
              <th className="px-6 py-3 font-normal">Share Gap</th>
              <th className="px-6 py-3 font-normal">PW Rating</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-sm">
            {rows.map(({ route, whatIf, market }) => {
              const pwShare = whatIf.baseline.market_share.pacific_wings_share;
              const shares = whatIf.baseline.market_share.shares_by_carrier;

              let topCompetitor: { name: string; share: number } | null = null;
              for (const [name, share] of Object.entries(shares)) {
                if (!topCompetitor || share > topCompetitor.share) topCompetitor = { name, share };
              }

              const gap = topCompetitor ? pwShare - topCompetitor.share : pwShare;

              return (
                <tr key={route.destination} className="transition-colors hover:bg-white/5">
                  <td className="px-6 py-4">
                    <div className="font-bold text-on-surface">SYD &rarr; {route.destination}</div>
                    <div className="font-label text-[10px] text-on-surface-variant/60">
                      {route.destination_name.toUpperCase()}
                    </div>
                  </td>
                  <td className="px-6 py-4 font-bold text-tertiary">{(pwShare * 100).toFixed(0)}%</td>
                  <td className="px-6 py-4 text-on-surface">{topCompetitor ? topCompetitor.name : "—"}</td>
                  <td className="px-6 py-4 text-on-surface">
                    {topCompetitor ? `${(topCompetitor.share * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className={`px-6 py-4 font-bold ${gap >= 0 ? "text-tertiary" : "text-error"}`}>
                    {gap >= 0 ? "+" : ""}
                    {(gap * 100).toFixed(0)}pp
                  </td>
                  <td className="px-6 py-4 text-on-surface">{market.competitors.length > 0 ? whatIf.baseline.scenario.pacific_wings_rating.toFixed(1) : "—"}★</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
