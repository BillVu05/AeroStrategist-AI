import type { MarketContext, WhatIfResponse } from "@/lib/types";

interface CompetitorMatrixProps {
  destination: string;
  market: MarketContext;
  whatIf: WhatIfResponse;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function CompetitorMatrix({ destination, market, whatIf }: CompetitorMatrixProps) {
  const shares = whatIf.baseline.market_share.shares_by_carrier;
  const pacificShare = whatIf.baseline.market_share.pacific_wings_share;

  return (
    <div className="glass-panel space-y-4 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-primary">Competitor Matrix · {destination}</h4>
        <span className="material-symbols-outlined text-secondary">groups</span>
      </div>
      <div className="space-y-3">
        {market.competitors.length === 0 && (
          <div className="flex items-center justify-between rounded bg-white/5 p-2">
            <div className="text-sm text-on-surface-variant">No direct competitors on this route.</div>
          </div>
        )}
        {market.competitors.map((c) => {
          const share = shares[c.name];
          return (
            <div key={c.name} className="flex items-center justify-between rounded bg-white/5 p-2">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600/20 text-xs font-bold">
                  {initials(c.name)}
                </div>
                <div>
                  <div className="text-sm font-bold text-on-surface">{c.name}</div>
                  <div className="text-[10px] text-on-surface-variant/60">
                    {c.weekly_frequency}/wk · ${c.avg_fare_usd.toFixed(0)} · {c.rating.toFixed(1)}★
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-label text-xs text-on-surface">
                  {share !== undefined ? `${(share * 100).toFixed(0)}% share` : "—"}
                </div>
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-between rounded border border-tertiary/20 bg-tertiary/5 p-2">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-tertiary/20 text-xs font-bold text-tertiary">
              PW
            </div>
            <div>
              <div className="text-sm font-bold text-on-surface">Pacific Wings</div>
              <div className="text-[10px] text-tertiary/60">
                {market.current_weekly_frequency}/wk · {market.assigned_aircraft}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-label text-xs font-bold text-tertiary">{(pacificShare * 100).toFixed(0)}% share</div>
          </div>
        </div>
      </div>
    </div>
  );
}
