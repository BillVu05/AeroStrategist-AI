// Structured rendering for agents/open_route_analyst.py's analyze_open_route()
// / compare_route_alternatives() output shape - shared between the chat
// agent's tool-result cards (ChatToolResult.tsx) and the standalone
// /open-route page, so both stay in sync with the backend response shape
// for free.

import type { AnalyzeRouteResponse, CompareRoutesResponse, OpenRouteAgentEvidence } from "@/lib/types";

function fmtUsd(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPax(v: number) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

const AGENT_META: Record<string, { icon: string; label: string }> = {
  demand: { icon: "trending_up", label: "Demand Agent" },
  finance: { icon: "monitoring", label: "Finance Agent" },
  market: { icon: "travel_explore", label: "Market Agent" },
  risk: { icon: "shield", label: "Risk Agent" },
  strategy: { icon: "psychology", label: "Strategy Agent" },
};

function AgentBlock({
  agent,
  unavailable,
  highlight,
  children,
}: {
  agent: keyof typeof AGENT_META;
  unavailable?: boolean;
  highlight?: boolean;
  children: string;
}) {
  const meta = AGENT_META[agent];
  return (
    <div className={`glass-panel rounded p-2.5 ${highlight ? "border border-tertiary/20" : ""}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`material-symbols-outlined text-[12px] ${unavailable ? "text-on-surface-variant/40" : "text-tertiary"}`}>
          {meta.icon}
        </span>
        <span className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/70">
          {meta.label}
        </span>
      </div>
      <p className="text-[11px] text-on-surface-variant leading-relaxed whitespace-pre-wrap">{children}</p>
    </div>
  );
}

function AgentEvidenceSection({ evidence }: { evidence: OpenRouteAgentEvidence }) {
  const { demand, finance, market, risk, strategy } = evidence;
  if (!demand && !finance && !market && !risk && !strategy) return null;

  return (
    <div className="border-t border-white/10 pt-3">
      <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60 mb-2">
        Five-Agent Evidence
      </div>
      <div className="space-y-2">
        {demand && (
          <AgentBlock agent="demand">
            {`Estimated ${fmtPax(demand.bilateral_market_estimate_annual_pax)} bilateral market; Pacific Wings captures ~${demand.pacific_wings_market_share_estimate_pct}% share (${fmtPax(demand.annual_passengers_pacific_wings)} pax/yr, ${(demand.load_factor_estimate * 100).toFixed(0)}% LF). Confidence range: ${fmtPax(demand.confidence_range_annual[0])}–${fmtPax(demand.confidence_range_annual[1])}.`}
          </AgentBlock>
        )}
        {finance && (
          <AgentBlock agent="finance">
            {`${fmtUsd(finance.annual_revenue_usd)} revenue, ${fmtUsd(finance.annual_cost_usd)} cost → ${fmtUsd(finance.annual_profit_usd)} profit (${finance.operating_margin_pct.toFixed(1)}% margin). Breakeven LF ${(finance.breakeven_load_factor * 100).toFixed(0)}%.`}
          </AgentBlock>
        )}
        {market && (
          <AgentBlock agent="market" unavailable={!market.available}>
            {market.commentary}
          </AgentBlock>
        )}
        {risk && (
          <AgentBlock agent="risk" unavailable={!risk.available}>
            {risk.risks}
          </AgentBlock>
        )}
        {strategy && (
          <AgentBlock agent="strategy" unavailable={!strategy.available} highlight>
            {strategy.executive_summary}
          </AgentBlock>
        )}
      </div>
    </div>
  );
}

export function RouteAnalysisReport({ result }: { result: AnalyzeRouteResponse }) {
  const { route, market, operations: ops, demand_estimate: demand, financials: fin, risk, scoring, verdict, pros, cons, agent_evidence: agentEvidence } = result;

  if (!route || !fin || !scoring) return null;

  const verdictCfg =
    verdict === "PROCEED"
      ? { bg: "bg-tertiary/10", border: "border-tertiary/30", text: "text-tertiary", icon: "check_circle" }
      : verdict === "PROCEED WITH CAUTION"
      ? { bg: "bg-secondary/10", border: "border-secondary/30", text: "text-secondary", icon: "warning" }
      : { bg: "bg-error/10", border: "border-error/30", text: "text-error", icon: "cancel" };

  const riskLabel = (v: number) => v === 0 ? "Low" : v === 1 ? "Mod" : v === 2 ? "High" : "Critical";
  const riskClass = (v: number) => v === 0 ? "text-tertiary" : v === 1 ? "text-secondary" : "text-error";

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-widest text-primary">
          New Route Analysis · SYD → {route.destination}
        </span>
        <span className="font-label text-[10px] text-on-surface-variant">
          {route.destination_city}, {route.destination_country}
        </span>
      </div>

      <div className="p-3 space-y-3">
        {/* verdict + score */}
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 rounded border ${verdictCfg.border} ${verdictCfg.bg} px-3 py-1.5`}>
            <span className={`material-symbols-outlined text-[16px] ${verdictCfg.text}`}>{verdictCfg.icon}</span>
            <span className={`font-label text-xs font-bold tracking-widest ${verdictCfg.text}`}>{verdict}</span>
          </div>
          <div className="text-right">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Score</div>
            <div className={`text-2xl font-bold leading-none ${verdictCfg.text}`}>
              {scoring.composite_score}<span className="text-sm font-normal">/100</span>
            </div>
          </div>
        </div>

        {/* score factor bars */}
        <div className="space-y-1.5">
          {[
            { label: "Demand", score: scoring.demand_score },
            { label: "Financial", score: scoring.financial_score },
            { label: "Strategic", score: scoring.strategic_score },
          ].map((f) => (
            <div key={f.label} className="flex items-center gap-2">
              <span className="font-label text-[10px] w-16 shrink-0 text-on-surface-variant">{f.label}</span>
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-tertiary/60" style={{ width: `${f.score}%` }} />
              </div>
              <span className="font-label text-[10px] w-7 text-right text-on-surface-variant">{f.score}</span>
            </div>
          ))}
        </div>

        {/* key metrics */}
        <div className="grid grid-cols-4 gap-2">
          <div className="glass-panel rounded p-2">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Market</div>
            <div className="text-sm font-bold text-on-surface">{fmtPax(market?.bilateral_market_estimate_annual_pax ?? 0)}</div>
          </div>
          <div className="glass-panel rounded p-2">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">PW Pax/yr</div>
            <div className="text-sm font-bold text-on-surface">{fmtPax(demand?.annual_passengers_pacific_wings ?? 0)}</div>
          </div>
          <div className="glass-panel rounded p-2">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Profit</div>
            <div className={`text-sm font-bold ${fin.annual_profit_usd >= 0 ? "text-tertiary" : "text-error"}`}>
              {fmtUsd(fin.annual_profit_usd)}
            </div>
          </div>
          <div className="glass-panel rounded p-2">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Margin</div>
            <div className={`text-sm font-bold ${fin.operating_margin_pct >= 8 ? "text-tertiary" : fin.operating_margin_pct >= 0 ? "text-secondary" : "text-error"}`}>
              {fin.operating_margin_pct.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* route & ops strip */}
        <div className="border-t border-white/10 pt-2 flex gap-4 font-label text-[10px] text-on-surface-variant flex-wrap">
          <span>{route.distance_km.toLocaleString()} km</span>
          <span>{route.flight_hours.toFixed(1)} hrs</span>
          <span>{ops?.aircraft_type}</span>
          <span>{ops?.weekly_frequency}×/week</span>
          <span>{((demand?.load_factor_estimate ?? 0) * 100).toFixed(0)}% LF (est.)</span>
          <span>BEP: {((fin.breakeven_load_factor) * 100).toFixed(0)}% LF</span>
        </div>

        {/* risk grid */}
        {risk && (
          <div className="border-t border-white/10 pt-2">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60 mb-1.5">Risk Profile</div>
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { label: "Geopolitical", val: risk.geopolitical_risk },
                { label: "Currency", val: risk.currency_risk },
                { label: "Demand", val: risk.demand_risk },
                { label: "Competition", val: risk.competition_risk },
                { label: "Financial", val: risk.financial_risk },
              ].map((r) => (
                <div key={r.label} className="glass-panel rounded p-1.5 text-center">
                  <div className="font-label text-[8px] text-on-surface-variant/50 truncate">{r.label}</div>
                  <div className={`font-label text-[10px] font-bold ${riskClass(r.val)}`}>{riskLabel(r.val)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* pros / cons */}
        {((pros?.length ?? 0) > 0 || (cons?.length ?? 0) > 0) && (
          <div className="border-t border-white/10 pt-2 grid grid-cols-2 gap-2">
            {(pros?.length ?? 0) > 0 && (
              <div>
                <div className="font-label text-[9px] uppercase tracking-widest text-tertiary/70 mb-1">Pros</div>
                <ul className="space-y-1">
                  {pros!.map((p, i) => (
                    <li key={i} className="flex gap-1.5 font-label text-[10px] text-on-surface-variant">
                      <span className="material-symbols-outlined text-[11px] text-tertiary/70 mt-px shrink-0">check</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(cons?.length ?? 0) > 0 && (
              <div>
                <div className="font-label text-[9px] uppercase tracking-widest text-error/70 mb-1">Cons</div>
                <ul className="space-y-1">
                  {cons!.map((c, i) => (
                    <li key={i} className="flex gap-1.5 font-label text-[10px] text-on-surface-variant">
                      <span className="material-symbols-outlined text-[11px] text-error/70 mt-px shrink-0">close</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* five-agent narrative evidence */}
        {agentEvidence && <AgentEvidenceSection evidence={agentEvidence} />}
      </div>
    </div>
  );
}

export function RouteComparisonList({ result }: { result: CompareRoutesResponse }) {
  const routes = result.ranked_routes;
  const freq = result.weekly_frequency;
  const errors = result.errors;

  if (!routes) return null;
  const maxScore = Math.max(...routes.map((r) => r.composite_score), 1);

  const verdictStyle = (v: string) =>
    v === "PROCEED"
      ? "border-tertiary/30 bg-tertiary/10 text-tertiary"
      : v === "PROCEED WITH CAUTION"
      ? "border-secondary/30 bg-secondary/10 text-secondary"
      : "border-error/30 bg-error/10 text-error";

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-widest text-primary">
          Route Comparison · {routes.length} Destinations
        </span>
        <span className="font-label text-[10px] text-on-surface-variant">{freq}×/week</span>
      </div>
      <div className="divide-y divide-white/5">
        {routes.map((r, i) => {
          const barPct = (r.composite_score / maxScore) * 100;
          return (
            <div key={r.destination} className="px-3 py-2.5 hover:bg-white/5 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-label text-[10px] text-on-surface-variant/40">#{i + 1}</span>
                  <span className="text-sm font-bold text-on-surface">SYD → {r.destination}</span>
                  <span className="font-label text-[9px] text-on-surface-variant/60">{r.city}</span>
                  {!r.in_range && (
                    <span className="font-label text-[8px] border border-error/30 bg-error/10 text-error rounded px-1">OUT OF RANGE</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded border px-1.5 py-0.5 font-label text-[9px] ${verdictStyle(r.verdict)}`}>
                    {r.verdict === "PROCEED WITH CAUTION" ? "CAUTION" : r.verdict}
                  </span>
                  <span className="font-label text-[11px] font-bold text-on-surface">
                    {r.composite_score}<span className="text-[9px] text-on-surface-variant">/100</span>
                  </span>
                </div>
              </div>
              {/* score bar */}
              <div className="h-1 overflow-hidden rounded-full bg-white/10 mb-1.5">
                <div className="h-full rounded-full bg-tertiary/60" style={{ width: `${barPct}%` }} />
              </div>
              {/* metrics strip */}
              <div className="flex gap-3 flex-wrap font-label text-[9px] text-on-surface-variant/60 mb-1">
                <span>{r.distance_km.toLocaleString()} km</span>
                <span>{r.aircraft_type}</span>
                <span>{fmtPax(r.annual_passengers)} pax</span>
                <span className={r.annual_profit_usd >= 0 ? "text-tertiary/80" : "text-error/80"}>
                  {fmtUsd(r.annual_profit_usd)} profit
                </span>
                <span>{r.operating_margin_pct.toFixed(1)}% margin</span>
              </div>
              {/* top pro */}
              {r.top_pro && r.top_pro !== "—" && (
                <div className="flex gap-1 font-label text-[9px] text-on-surface-variant/50">
                  <span className="material-symbols-outlined text-[10px] text-tertiary/60 shrink-0 mt-px">check</span>
                  <span>{r.top_pro}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {errors && errors.length > 0 && (
        <div className="border-t border-white/10 px-3 py-2">
          {errors.map((e) => (
            <div key={e.destination} className="font-label text-[9px] text-error/70">
              {e.destination}: {e.error}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
