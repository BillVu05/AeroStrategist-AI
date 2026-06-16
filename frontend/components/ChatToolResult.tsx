import type { ChatToolCall } from "@/lib/types";

// ─── helpers ────────────────────────────────────────────────────────────────

function deltaClass(v: number) {
  if (v > 0) return "text-tertiary";
  if (v < 0) return "text-error";
  return "text-on-surface-variant";
}

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

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── tool-specific renderers ────────────────────────────────────────────────

type SimBaseline = {
  demand: { passengers_carried: number; load_factor: number };
  revenue: { total_revenue_usd: number };
  cost: { fuel_cost_usd: number; total_cost_usd: number };
  profit_usd: number;
  market_share: { pacific_wings_share: number };
};

function SimulateRouteResult({ args, result }: { args: Record<string, unknown>; result: Record<string, unknown> }) {
  const delta = result.delta as { profit_usd: number; passengers_carried: number; pacific_wings_share: number } | undefined;
  const baseline = result.baseline as SimBaseline | undefined;

  if (!delta) return null;

  // Rich boardroom card when baseline data is available
  if (baseline) {
    const profit = baseline.profit_usd;
    const revenue = baseline.revenue.total_revenue_usd;
    const margin = revenue > 0 ? profit / revenue : 0;
    const lf = baseline.demand.load_factor;
    const share = baseline.market_share.pacific_wings_share;
    const fuelRatio = baseline.cost.total_cost_usd > 0
      ? baseline.cost.fuel_cost_usd / baseline.cost.total_cost_usd
      : 0.4;

    const hasDelta = Math.abs(delta.profit_usd) > 50;

    const demandScore = Math.round((lf - 0.5) * 80);
    const revenueScore = Math.round(margin * 80);
    const marketScore = Math.round((share - 0.15) * 100);
    const costScore = Math.round((0.45 - fuelRatio) * 80);

    const confidence = Math.max(40, Math.min(95, Math.round(
      (margin > 0 ? 40 : 20) + (lf * 30) + (Math.max(0, margin) * 80)
    )));

    const verdict = profit > 0 && margin > 0.10 ? "PROCEED"
      : profit > 0 ? "CAUTION"
      : "NO-GO";

    const vc = verdict === "PROCEED"
      ? { bg: "bg-tertiary/10", border: "border-tertiary/30", text: "text-tertiary" }
      : verdict === "CAUTION"
      ? { bg: "bg-secondary/10", border: "border-secondary/30", text: "text-secondary" }
      : { bg: "bg-error/10", border: "border-error/30", text: "text-error" };

    const factors = [
      { label: "Demand", score: demandScore },
      { label: "Revenue", score: revenueScore },
      { label: "Market", score: marketScore },
      { label: "Fuel/Cost", score: costScore },
    ];

    return (
      <div className="glass-panel rounded-lg overflow-hidden">
        <div className="border-b border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between">
          <span className="font-label text-[10px] uppercase tracking-widest text-primary">
            Strategy Analysis · SYD → {String(args.destination ?? "").toUpperCase()}
          </span>
          <span className="font-label text-[10px] text-on-surface-variant">
            {String(args.year ?? 2024)}-{String(args.month ?? 6).padStart(2, "0")}
          </span>
        </div>

        <div className="p-3 space-y-3">
          {/* verdict + confidence */}
          <div className="flex items-center justify-between">
            <div className={`flex items-center gap-2 rounded border ${vc.border} ${vc.bg} px-3 py-1.5`}>
              <span className={`material-symbols-outlined text-[16px] ${vc.text}`}>
                {verdict === "PROCEED" ? "check_circle" : verdict === "CAUTION" ? "warning" : "cancel"}
              </span>
              <span className={`font-label text-xs font-bold tracking-widest ${vc.text}`}>{verdict}</span>
            </div>
            <div className="text-right">
              <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Confidence</div>
              <div className={`text-2xl font-bold leading-none ${vc.text}`}>
                {confidence}<span className="text-sm font-normal">%</span>
              </div>
            </div>
          </div>

          {/* key metrics */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Revenue", value: fmtUsd(revenue), cls: "text-on-surface" },
              { label: "Profit", value: fmtUsd(profit), cls: profit >= 0 ? "text-tertiary" : "text-error" },
              { label: "Load Factor", value: `${(lf * 100).toFixed(0)}%`, cls: lf >= 0.75 ? "text-tertiary" : lf >= 0.5 ? "text-on-surface" : "text-secondary" },
              { label: "Mkt Share", value: `${(share * 100).toFixed(1)}%`, cls: "text-on-surface" },
            ].map((m) => (
              <div key={m.label} className="glass-panel rounded p-2">
                <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">{m.label}</div>
                <div className={`text-sm font-bold ${m.cls}`}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* decision factor bars */}
          <div className="border-t border-white/10 pt-3 space-y-2">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60 mb-1">Decision Factors</div>
            {factors.map((f) => {
              const pct = Math.min(Math.abs(f.score) / 40 * 100, 100);
              const pos = f.score >= 0;
              return (
                <div key={f.label} className="flex items-center gap-2">
                  <span className="font-label text-[10px] w-14 shrink-0 text-on-surface-variant">{f.label}</span>
                  <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${pos ? "bg-tertiary/70" : "bg-error/60"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`font-label text-[10px] w-8 text-right shrink-0 ${pos ? "text-tertiary" : "text-error"}`}>
                    {pos ? "+" : ""}{f.score}%
                  </span>
                </div>
              );
            })}
          </div>

          {/* scenario delta (only if a real scenario was run) */}
          {hasDelta && (
            <div className="border-t border-white/10 pt-3">
              <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60 mb-2">Scenario Impact</div>
              <dl className="grid grid-cols-3 gap-2">
                {[
                  { label: "Profit Δ", value: `${delta.profit_usd >= 0 ? "+" : ""}${fmtUsd(delta.profit_usd)}`, raw: delta.profit_usd },
                  { label: "Passengers Δ", value: `${delta.passengers_carried >= 0 ? "+" : ""}${fmtPax(delta.passengers_carried)}`, raw: delta.passengers_carried },
                  { label: "Share Δ", value: `${delta.pacific_wings_share >= 0 ? "+" : ""}${(delta.pacific_wings_share * 100).toFixed(1)}pp`, raw: delta.pacific_wings_share },
                ].map((t) => (
                  <div key={t.label} className="glass-panel rounded p-2">
                    <dt className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">{t.label}</dt>
                    <dd className={`text-sm font-bold ${deltaClass(t.raw)}`}>{t.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Fallback: compact 3-tile view
  const tiles = [
    { label: "Profit Δ", value: `${delta.profit_usd >= 0 ? "+" : ""}${fmtUsd(delta.profit_usd)}`, raw: delta.profit_usd },
    { label: "Passengers Δ", value: `${delta.passengers_carried >= 0 ? "+" : ""}${fmtPax(delta.passengers_carried)}`, raw: delta.passengers_carried },
    { label: "Share Δ", value: `${delta.pacific_wings_share >= 0 ? "+" : ""}${(delta.pacific_wings_share * 100).toFixed(1)}pp`, raw: delta.pacific_wings_share },
  ];
  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="mb-2 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
        Simulation · {String(args.destination ?? "")} {String(args.year ?? 2024)}-{String(args.month ?? 6).padStart(2, "0")}
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="glass-panel rounded-lg px-3 py-2">
            <dt className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">{t.label}</dt>
            <dd className={`mt-0.5 text-sm font-semibold ${deltaClass(t.raw)}`}>{t.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ForecastDemandTrendResult({ result }: { result: Record<string, unknown> }) {
  const destination = result.destination as string;
  const forecast = result.forecast as Record<number, {
    annual_passengers: number;
    annual_revenue_usd: number;
    annual_profit_usd: number;
    avg_load_factor: number;
    peak_month: number;
    yoy_growth_pct: number | null;
    monthly: { month: number; passengers: number; load_factor: number }[];
  }>;
  if (!forecast) return null;

  const years = Object.keys(forecast).map(Number).sort((a, b) => a - b);
  const maxPax = Math.max(...years.map((y) => forecast[y].annual_passengers), 1);

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-widest text-primary">
          Demand Forecast · {destination}
        </span>
        <span className="font-label text-[10px] text-on-surface-variant">
          {years[0]}–{years[years.length - 1]}
        </span>
      </div>

      {/* annual bar chart */}
      <div className="p-3">
        <div className="flex h-24 items-end gap-2 mb-2">
          {years.map((y) => {
            const row = forecast[y];
            const pct = Math.max((row.annual_passengers / maxPax) * 100, 4);
            return (
              <div key={y} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full flex flex-col items-center justify-end" style={{ height: "80px" }}>
                  <div
                    className="w-full rounded-t bg-tertiary/60 hover:bg-tertiary transition-colors"
                    style={{ height: `${pct}%` }}
                    title={`${fmtPax(row.annual_passengers)} pax`}
                  />
                </div>
                <span className="font-label text-[10px] text-on-surface-variant">{y}</span>
              </div>
            );
          })}
        </div>

        {/* year-by-year metrics */}
        <div className="border-t border-white/10 pt-3 space-y-0">
          <div className="grid grid-cols-4 gap-1 mb-1">
            {["Year", "Annual Pax", "Revenue", "YoY"].map((h) => (
              <span key={h} className="font-label text-[9px] uppercase tracking-wider text-on-surface-variant/60">{h}</span>
            ))}
          </div>
          {years.map((y) => {
            const row = forecast[y];
            return (
              <div key={y} className="grid grid-cols-4 gap-1 py-1.5 border-t border-white/5 text-xs">
                <span className="font-bold text-on-surface">{y}</span>
                <span className="text-on-surface">{fmtPax(row.annual_passengers)}</span>
                <span className="text-on-surface">{fmtUsd(row.annual_revenue_usd)}</span>
                <span className={row.yoy_growth_pct === null ? "text-on-surface-variant" : deltaClass(row.yoy_growth_pct ?? 0)}>
                  {row.yoy_growth_pct === null ? "—" : `${row.yoy_growth_pct >= 0 ? "+" : ""}${row.yoy_growth_pct}%`}
                </span>
              </div>
            );
          })}
        </div>

        {/* monthly sparklines for each year */}
        <div className="border-t border-white/10 pt-3 mt-2 grid grid-cols-2 gap-3">
          {years.map((y) => {
            const monthly = forecast[y].monthly;
            const maxM = Math.max(...monthly.map((m) => m.passengers), 1);
            return (
              <div key={y}>
                <div className="font-label text-[9px] uppercase tracking-wider text-on-surface-variant mb-1">{y} monthly</div>
                <div className="flex h-8 items-end gap-px">
                  {monthly.map((m) => (
                    <div
                      key={m.month}
                      className="flex-1 bg-tertiary/40 hover:bg-tertiary/70 transition-colors rounded-t-sm"
                      style={{ height: `${Math.max((m.passengers / maxM) * 100, 4)}%` }}
                      title={`${MONTH_SHORT[m.month - 1]}: ${fmtPax(m.passengers)}`}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-0.5 font-label text-[8px] text-on-surface-variant/50">
                  <span>Jan</span><span>Jun</span><span>Dec</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* peak month callout */}
        <div className="border-t border-white/10 pt-2 mt-2 flex gap-2 flex-wrap">
          {years.map((y) => {
            const row = forecast[y];
            return (
              <div key={y} className="flex items-center gap-1.5 rounded border border-tertiary/20 bg-tertiary/5 px-2 py-1">
                <span className="font-label text-[9px] text-on-surface-variant">{y} peak:</span>
                <span className="font-label text-[9px] font-bold text-tertiary">{MONTH_SHORT[row.peak_month - 1]}</span>
                <span className="font-label text-[9px] text-on-surface-variant">
                  · {(row.avg_load_factor * 100).toFixed(0)}% avg LF
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RankFutureOpportunitiesResult({ result }: { result: Record<string, unknown> }) {
  const year = result.year as number;
  const month = result.month as number;
  const routes = result.routes as {
    destination: string;
    destination_city: string;
    status: string;
    projected_passengers: number;
    projected_revenue_usd: number;
    projected_profit_usd: number;
    projected_load_factor: number;
    projected_market_share_pct: number;
  }[];
  if (!routes) return null;

  const maxProfit = Math.max(...routes.map((r) => Math.abs(r.projected_profit_usd)), 1);

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-widest text-primary">
          Route Opportunities · {year}
        </span>
        <span className="font-label text-[10px] text-on-surface-variant">
          {MONTH_SHORT[(month ?? 6) - 1]} {year}
        </span>
      </div>
      <div className="divide-y divide-white/5">
        {routes.map((r, i) => {
          const barPct = (Math.abs(r.projected_profit_usd) / maxProfit) * 100;
          const profitPositive = r.projected_profit_usd >= 0;
          return (
            <div key={r.destination} className="px-3 py-2.5 hover:bg-white/5 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-label text-[10px] text-on-surface-variant/50">#{i + 1}</span>
                  <span className="text-sm font-bold text-on-surface">SYD → {r.destination}</span>
                  <span className="font-label text-[9px] text-on-surface-variant/60">{r.destination_city}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 font-label text-[9px] ${
                      r.status === "active"
                        ? "border-tertiary/20 bg-tertiary/10 text-tertiary"
                        : "border-secondary/20 bg-secondary/10 text-secondary"
                    }`}
                  >
                    {r.status.toUpperCase()}
                  </span>
                  <span className={`text-sm font-bold ${profitPositive ? "text-tertiary" : "text-error"}`}>
                    {fmtUsd(r.projected_profit_usd)}
                  </span>
                </div>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/10 mb-1.5">
                <div
                  className={`h-full rounded-full ${profitPositive ? "bg-tertiary/60" : "bg-error/60"}`}
                  style={{ width: `${barPct}%` }}
                />
              </div>
              <div className="flex gap-3 font-label text-[9px] text-on-surface-variant/60">
                <span>{fmtPax(r.projected_passengers)} pax</span>
                <span>{fmtUsd(r.projected_revenue_usd)} rev</span>
                <span>{(r.projected_load_factor * 100).toFixed(0)}% LF</span>
                <span>{r.projected_market_share_pct}% share</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── main export ─────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  list_routes: "Routes consulted",
  list_what_if_presets: "What-if presets consulted",
  get_market_context: "Market context consulted",
  simulate_route: "Simulation",
  forecast_demand_trend: "Demand forecast",
  rank_future_opportunities: "Future opportunity ranking",
};

export default function ChatToolResult({ toolCall }: { toolCall: ChatToolCall }) {
  const { name, args, result } = toolCall;

  if (result.error) {
    return (
      <div className="rounded-lg border border-secondary/30 bg-secondary-container/20 px-3 py-2 text-xs text-secondary">
        {name}({JSON.stringify(args)}): {String(result.error)}
      </div>
    );
  }

  if (name === "simulate_route") return <SimulateRouteResult args={args} result={result} />;
  if (name === "forecast_demand_trend") return <ForecastDemandTrendResult result={result} />;
  if (name === "rank_future_opportunities") return <RankFutureOpportunitiesResult result={result} />;

  return (
    <details className="glass-panel rounded-lg text-xs">
      <summary className="cursor-pointer px-3 py-2 text-on-surface-variant">
        {TOOL_LABELS[name] ?? name}
      </summary>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 pb-2 text-on-surface-variant">
        {JSON.stringify(result, null, 2)}
      </pre>
    </details>
  );
}
