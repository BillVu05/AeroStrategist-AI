import type { AnalyzeRouteResponse, ChatToolCall, CompareRoutesResponse } from "@/lib/types";
import { RouteAnalysisReport, RouteComparisonList } from "./RouteAnalysisCard";

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
  demand: { passengers_carried: number; load_factor: number; confidence_pct: number; confidence_notes: string[] };
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

    const hasDelta = Math.abs(delta.profit_usd) > 50;

    const verdict = profit > 0 && margin > 0.10 ? "PROCEED"
      : profit > 0 ? "CAUTION"
      : "NO-GO";

    const vc = verdict === "PROCEED"
      ? { bg: "bg-tertiary/10", border: "border-tertiary/30", text: "text-tertiary" }
      : verdict === "CAUTION"
      ? { bg: "bg-secondary/10", border: "border-secondary/30", text: "text-secondary" }
      : { bg: "bg-error/10", border: "border-error/30", text: "text-error" };

    const confidencePct = baseline.demand.confidence_pct;
    const confidenceColor = confidencePct >= 70 ? "text-tertiary" : confidencePct >= 50 ? "text-secondary" : "text-error";

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
              <div className={`text-lg font-bold leading-none ${confidenceColor}`}>{confidencePct}%</div>
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

          {baseline.demand.confidence_notes.length > 0 && (
            <div className="border-t border-white/10 pt-2">
              {baseline.demand.confidence_notes.map((note, i) => (
                <p key={i} className="font-label text-[9px] text-on-surface-variant/60">• {note}</p>
              ))}
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

function ProjectMacroResult({ args, result }: { args: Record<string, unknown>; result: Record<string, unknown> }) {
  const destination = result.destination as string;
  const fromYear = result.from_year as number;
  const toYear   = result.to_year as number;
  const yearly   = result.yearly as Record<string, {
    gdp_usd: number;
    gdp_growth_pct: number;
    tourism_arrivals: number;
    fuel_price_usd_per_gallon: number;
    demand_multiplier: number;
    data_source: string;
  }> | undefined;
  if (!yearly) return null;

  const years = Object.keys(yearly).sort();
  const lastMult = yearly[years[years.length - 1]]?.demand_multiplier ?? 1;
  const maxMult = Math.max(...years.map((y) => yearly[y].demand_multiplier), 1);

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-widest text-primary">
          Macro Projection · {destination}
        </span>
        <span className="font-label text-[10px] text-on-surface-variant">{fromYear}–{toYear}</span>
      </div>
      <div className="p-3 space-y-3">
        {/* market size multiplier bar */}
        <div>
          <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60 mb-1.5">
            Market Size Multiplier — {lastMult.toFixed(2)}× by {toYear}
          </div>
          <div className="flex items-end gap-1.5" style={{ height: 40 }}>
            {years.map((y) => {
              const mult = yearly[y].demand_multiplier;
              const pct = Math.max((mult / maxMult) * 100, 4);
              const isProj = yearly[y].data_source === "projected";
              return (
                <div key={y} className="flex flex-1 flex-col items-center gap-0.5">
                  <div className="w-full flex flex-col justify-end" style={{ height: 32 }}>
                    <div
                      className={`w-full rounded-t ${isProj ? "bg-tertiary/50" : "bg-tertiary/80"}`}
                      style={{ height: `${pct}%` }}
                      title={`${y}: ${mult.toFixed(3)}×`}
                    />
                  </div>
                  <span className="font-label text-[8px] text-on-surface-variant/40">{y}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* key metrics table */}
        <div className="border-t border-white/10 pt-2">
          <div className="grid grid-cols-5 gap-1 mb-1">
            {["Year", "GDP", "GDP Gr.", "Tourism", "Fuel"].map((h) => (
              <span key={h} className="font-label text-[9px] uppercase tracking-wider text-on-surface-variant/50">{h}</span>
            ))}
          </div>
          {years.map((y) => {
            const row = yearly[y];
            const isProj = row.data_source === "projected";
            const gdp = row.gdp_usd >= 1e12 ? `$${(row.gdp_usd/1e12).toFixed(2)}T` : `$${(row.gdp_usd/1e9).toFixed(0)}B`;
            return (
              <div key={y} className="grid grid-cols-5 gap-1 py-1 border-t border-white/5 text-[11px]">
                <span className={`font-bold ${isProj ? "text-on-surface/70" : "text-on-surface"}`}>{y}</span>
                <span className="text-on-surface">{gdp}</span>
                <span className={row.gdp_growth_pct >= 0 ? "text-tertiary" : "text-error"}>
                  {row.gdp_growth_pct >= 0 ? "+" : ""}{row.gdp_growth_pct.toFixed(1)}%
                </span>
                <span className="text-on-surface">{(row.tourism_arrivals/1e6).toFixed(1)}M</span>
                <span className="text-on-surface">${row.fuel_price_usd_per_gallon.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AnalyzeLongTermResult({ args, result }: { args: Record<string, unknown>; result: Record<string, unknown> }) {
  const destination = result.destination as string;
  const fromYear = result.from_year as number;
  const toYear   = result.to_year as number;
  const cagr     = result.passenger_cagr_pct as number | null;
  const yearly   = result.yearly as Record<string, {
    annual_passengers: number;
    annual_revenue_usd: number;
    annual_profit_usd: number;
    avg_load_factor: number;
    yoy_growth_pct: number | null;
    demand_multiplier: number;
  }> | undefined;
  if (!yearly) return null;

  const years = Object.keys(yearly).sort();
  const maxRev = Math.max(...years.map((y) => yearly[y].annual_revenue_usd), 1);
  const totalProfit = years.reduce((s, y) => s + yearly[y].annual_profit_usd, 0);

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-widest text-primary">
          Long-Term Analysis · {destination}
        </span>
        <div className="flex items-center gap-3">
          {cagr !== null && (
            <span className={`font-label text-[10px] font-bold ${cagr >= 0 ? "text-tertiary" : "text-error"}`}>
              {cagr >= 0 ? "+" : ""}{cagr.toFixed(1)}% CAGR
            </span>
          )}
          <span className="font-label text-[10px] text-on-surface-variant">{fromYear}–{toYear}</span>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* revenue bar chart */}
        <div className="flex items-end gap-1.5" style={{ height: 64 }}>
          {years.map((y) => {
            const pct = Math.max((yearly[y].annual_revenue_usd / maxRev) * 100, 3);
            return (
              <div key={y} className="flex flex-1 flex-col items-center gap-0.5">
                <div className="w-full flex flex-col justify-end" style={{ height: 56 }}>
                  <div
                    className="w-full rounded-t bg-tertiary/50 hover:bg-tertiary/80 transition-colors"
                    style={{ height: `${pct}%` }}
                    title={fmtUsd(yearly[y].annual_revenue_usd)}
                  />
                </div>
                <span className="font-label text-[8px] text-on-surface-variant/40">{y}</span>
              </div>
            );
          })}
        </div>

        {/* table */}
        <div className="border-t border-white/10 pt-2">
          <div className="grid grid-cols-5 gap-1 mb-1">
            {["Year", "Pax", "Revenue", "Profit", "YoY"].map((h) => (
              <span key={h} className="font-label text-[9px] uppercase tracking-wider text-on-surface-variant/50">{h}</span>
            ))}
          </div>
          {years.map((y) => {
            const row = yearly[y];
            return (
              <div key={y} className="grid grid-cols-5 gap-1 py-1 border-t border-white/5 text-[11px]">
                <span className="font-bold text-on-surface">{y}</span>
                <span className="text-on-surface">{fmtPax(row.annual_passengers)}</span>
                <span className="text-on-surface">{fmtUsd(row.annual_revenue_usd)}</span>
                <span className={row.annual_profit_usd >= 0 ? "text-tertiary" : "text-error"}>
                  {fmtUsd(row.annual_profit_usd)}
                </span>
                <span className={row.yoy_growth_pct === null ? "text-on-surface-variant" : deltaClass(row.yoy_growth_pct)}>
                  {row.yoy_growth_pct === null ? "—" : `${row.yoy_growth_pct >= 0 ? "+" : ""}${row.yoy_growth_pct.toFixed(1)}%`}
                </span>
              </div>
            );
          })}
        </div>

        {/* summary tiles */}
        <div className="border-t border-white/10 pt-2 grid grid-cols-3 gap-2">
          <div className="glass-panel rounded p-2">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Cumul. Profit</div>
            <div className={`text-sm font-bold ${totalProfit >= 0 ? "text-tertiary" : "text-error"}`}>{fmtUsd(totalProfit)}</div>
          </div>
          <div className="glass-panel rounded p-2">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Passenger CAGR</div>
            <div className={`text-sm font-bold ${(cagr ?? 0) >= 0 ? "text-tertiary" : "text-error"}`}>
              {cagr !== null ? `${cagr >= 0 ? "+" : ""}${cagr.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="glass-panel rounded p-2">
            <div className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Market {toYear}</div>
            <div className="text-sm font-bold text-tertiary">
              {(yearly[years[years.length-1]]?.demand_multiplier ?? 1).toFixed(2)}×
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RankNetworkLongTermResult({ result }: { result: Record<string, unknown> }) {
  const fromYear = result.from_year as number;
  const toYear   = result.to_year as number;
  const routes   = result.routes as {
    destination: string;
    destination_city: string;
    status: string;
    passenger_cagr_pct: number | null;
    demand_multiplier_end_year: number;
    total_projected_profit_usd: number;
    total_projected_revenue_usd: number;
    start_year_profit_usd: number;
    end_year_profit_usd: number;
  }[];
  if (!routes) return null;

  const maxProfit = Math.max(...routes.map((r) => Math.abs(r.total_projected_profit_usd)), 1);

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-widest text-primary">
          Network Long-Term Ranking
        </span>
        <span className="font-label text-[10px] text-on-surface-variant">{fromYear}–{toYear}</span>
      </div>
      <div className="divide-y divide-white/5">
        {routes.map((r, i) => {
          const barPct = (Math.abs(r.total_projected_profit_usd) / maxProfit) * 100;
          const positive = r.total_projected_profit_usd >= 0;
          return (
            <div key={r.destination} className="px-3 py-2.5 hover:bg-white/5 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-label text-[10px] text-on-surface-variant/40">#{i+1}</span>
                  <span className="text-sm font-bold text-on-surface">SYD → {r.destination}</span>
                  <span className="font-label text-[9px] text-on-surface-variant/60">{r.destination_city}</span>
                  <span className={`rounded border px-1.5 py-0.5 font-label text-[9px] ${
                    r.status === "active"
                      ? "border-tertiary/20 bg-tertiary/10 text-tertiary"
                      : "border-secondary/20 bg-secondary/10 text-secondary"
                  }`}>{r.status.toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-3">
                  {r.passenger_cagr_pct !== null && (
                    <span className={`font-label text-[10px] ${r.passenger_cagr_pct >= 0 ? "text-tertiary" : "text-error"}`}>
                      {r.passenger_cagr_pct >= 0 ? "+" : ""}{r.passenger_cagr_pct.toFixed(1)}% CAGR
                    </span>
                  )}
                  <span className="font-label text-[10px] text-on-surface-variant">
                    {r.demand_multiplier_end_year.toFixed(2)}× mkt
                  </span>
                  <span className={`text-sm font-bold ${positive ? "text-tertiary" : "text-error"}`}>
                    {fmtUsd(r.total_projected_profit_usd)}
                  </span>
                </div>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/10 mb-1">
                <div className={`h-full rounded-full ${positive ? "bg-tertiary/60" : "bg-error/60"}`} style={{ width: `${barPct}%` }} />
              </div>
              <div className="flex gap-3 font-label text-[9px] text-on-surface-variant/50">
                <span>{fmtUsd(r.total_projected_revenue_usd)} total rev</span>
                <span>{fmtUsd(r.start_year_profit_usd)} → {fmtUsd(r.end_year_profit_usd)} profit/yr</span>
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
  project_macro_indicators: "Macro projection",
  analyze_long_term_market: "Long-term market analysis",
  rank_network_long_term: "Network long-term ranking",
  analyze_new_route: "New route analysis",
  compare_new_routes: "Route comparison",
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
  if (name === "project_macro_indicators") return <ProjectMacroResult args={args} result={result} />;
  if (name === "analyze_long_term_market") return <AnalyzeLongTermResult args={args} result={result} />;
  if (name === "rank_network_long_term") return <RankNetworkLongTermResult result={result} />;
  if (name === "analyze_new_route") return <RouteAnalysisReport result={result as unknown as AnalyzeRouteResponse} />;
  if (name === "compare_new_routes") return <RouteComparisonList result={result as unknown as CompareRoutesResponse} />;

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
