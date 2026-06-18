"use client";

import { useEffect, useId, useState } from "react";
import { getFutureAnalysis, getMacroProjection, getNetworkFutureAnalysis } from "@/lib/api";
import type {
  FutureAnalysisResponse,
  MacroProjectionResponse,
  NetworkFutureAnalysisResponse,
} from "@/lib/types";
import { ALL_DESTINATIONS } from "@/lib/constants";
import KpiCard from "@/components/KpiCard";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";

// ─── helpers ─────────────────────────────────────────────────────────────────

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

function fmtGdp(v: number) {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(0)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
}

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── small sparkline component ────────────────────────────────────────────────

function Sparkline({
  values,
  color = "#4cd7f6",
  height = 40,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  const uid = useId().replace(/:/g, "");
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 200;
  const H = height;
  const PAD = 4;
  const px = (i: number) => (i / (values.length - 1)) * W;
  const py = (v: number) => PAD + ((max - v) / range) * (H - 2 * PAD);
  const pts = values.map((v, i) => `${px(i)},${py(v)}`);
  const fill = `M 0,${H} L ${pts.join(" L ")} L ${W},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={`sp-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#sp-${uid})`} />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 3px ${color}66)` }}
      />
    </svg>
  );
}

// ─── multi-series line chart ──────────────────────────────────────────────────

interface Series {
  label: string;
  values: number[];
  color: string;
}

function MultiLineChart({ series, xLabels, height = 120 }: { series: Series[]; xLabels: string[]; height?: number }) {
  const uid = useId().replace(/:/g, "");
  const W = 400;
  const H = height;
  const PAD_X = 8;
  const PAD_Y = 10;

  const allValues = series.flatMap((s) => s.values);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const px = (i: number) => PAD_X + (i / Math.max(xLabels.length - 1, 1)) * (W - 2 * PAD_X);
  const py = (v: number) => PAD_Y + ((max - v) / range) * (H - 2 * PAD_Y);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => `${px(i)},${py(v)}`);
          const fill = `M ${px(0)},${H} L ${pts.join(" L ")} L ${px(s.values.length - 1)},${H} Z`;
          return (
            <g key={si}>
              <defs>
                <linearGradient id={`mlc-${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.12" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={fill} fill={`url(#mlc-${uid}-${si})`} />
              <polyline
                points={pts.join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 3px ${s.color}55)` }}
              />
              {s.values.map((v, i) => (
                <circle key={i} cx={px(i)} cy={py(v)} r="2.5" fill={s.color} opacity="0.8" />
              ))}
            </g>
          );
        })}
        {/* zero line if values span positive and negative */}
        {min < 0 && max > 0 && (
          <line x1={PAD_X} y1={py(0)} x2={W - PAD_X} y2={py(0)} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3,3" />
        )}
      </svg>
      <div className="flex justify-between mt-1 px-1">
        {xLabels.map((l, i) => (
          i === 0 || i === xLabels.length - 1 || i === Math.floor(xLabels.length / 2) ? (
            <span key={i} className="font-label text-[9px] text-on-surface-variant/40">{l}</span>
          ) : <span key={i} />
        ))}
      </div>
    </div>
  );
}

// ─── macro signals panel ─────────────────────────────────────────────────────

function MacroSignalCard({
  label,
  icon,
  values,
  xLabels,
  format,
  color,
}: {
  label: string;
  icon: string;
  values: number[];
  xLabels: string[];
  format: (v: number) => string;
  color?: string;
}) {
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const delta = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
  const positive = delta >= 0;

  return (
    <div className="glass-panel rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 font-label text-[10px] uppercase tracking-widest text-primary">
          <span className="material-symbols-outlined text-[13px] text-tertiary">{icon}</span>
          {label}
        </h4>
        <span className={`font-label text-[10px] font-bold ${positive ? "text-tertiary" : "text-error"}`}>
          {positive ? "+" : ""}{delta.toFixed(1)}%
        </span>
      </div>
      <div className="text-lg font-bold text-on-surface leading-none">{format(last)}</div>
      <div className="relative h-10 w-full">
        <Sparkline values={values} color={color ?? "#4cd7f6"} height={40} />
      </div>
      <div className="flex justify-between font-label text-[9px] text-on-surface-variant/40">
        <span>{xLabels[0]}</span>
        <span>{xLabels[xLabels.length - 1]}</span>
      </div>
      <div className="flex items-center justify-between border-t border-white/5 pt-2">
        <span className="font-label text-[9px] text-on-surface-variant/40">CAGR</span>
        <span className={`font-label text-[9px] font-bold ${positive ? "text-tertiary" : "text-error"}`}>
          {((Math.pow(last / first, 1 / Math.max(xLabels.length - 1, 1)) - 1) * 100).toFixed(2)}%/yr
        </span>
      </div>
    </div>
  );
}

// ─── annual P&L chart ─────────────────────────────────────────────────────────

function PnLChart({ data }: { data: { year: string; revenue: number; profit: number; passengers: number }[] }) {
  const maxRev = Math.max(...data.map((d) => d.revenue), 1);
  const maxPax = Math.max(...data.map((d) => d.passengers), 1);

  return (
    <div className="space-y-4">
      {/* Revenue bars */}
      <div>
        <div className="mb-2 font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Annual Revenue</div>
        <div className="flex items-end gap-2" style={{ height: 80 }}>
          {data.map((d) => (
            <div key={d.year} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full flex flex-col justify-end" style={{ height: 72 }}>
                <div
                  className="w-full rounded-t bg-tertiary/50 hover:bg-tertiary/80 transition-colors"
                  style={{ height: `${Math.max((d.revenue / maxRev) * 100, 3)}%` }}
                  title={fmtUsd(d.revenue)}
                />
              </div>
              <span className="font-label text-[9px] text-on-surface-variant/60">{d.year}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Profit bars (colored by positive/negative) */}
      <div>
        <div className="mb-2 font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Annual Profit</div>
        <div className="flex items-end gap-2" style={{ height: 64 }}>
          {data.map((d) => {
            const positive = d.profit >= 0;
            const abs = Math.abs(d.profit);
            const maxAbs = Math.max(...data.map((r) => Math.abs(r.profit)), 1);
            return (
              <div key={d.year} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full flex flex-col justify-end" style={{ height: 56 }}>
                  <div
                    className={`w-full rounded-t transition-colors ${positive ? "bg-tertiary/60 hover:bg-tertiary" : "bg-error/50 hover:bg-error/80"}`}
                    style={{ height: `${Math.max((abs / maxAbs) * 100, 3)}%` }}
                    title={fmtUsd(d.profit)}
                  />
                </div>
                <span className="font-label text-[9px] text-on-surface-variant/60">{d.year}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Passengers bars */}
      <div>
        <div className="mb-2 font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Annual Passengers</div>
        <div className="flex items-end gap-2" style={{ height: 56 }}>
          {data.map((d) => (
            <div key={d.year} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full flex flex-col justify-end" style={{ height: 48 }}>
                <div
                  className="w-full rounded-t bg-secondary/50 hover:bg-secondary/80 transition-colors"
                  style={{ height: `${Math.max((d.passengers / maxPax) * 100, 3)}%` }}
                  title={fmtPax(d.passengers)}
                />
              </div>
              <span className="font-label text-[9px] text-on-surface-variant/60">{d.year}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── network portfolio table ──────────────────────────────────────────────────

function NetworkTable({ data }: { data: NetworkFutureAnalysisResponse }) {
  const maxProfit = Math.max(...data.routes.map((r) => Math.abs(r.total_projected_profit_usd)), 1);

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
        <h3 className="flex items-center gap-2 font-label text-[10px] uppercase tracking-widest text-primary">
          <span className="material-symbols-outlined text-[14px] text-tertiary">leaderboard</span>
          Network Portfolio · {data.from_year}–{data.to_year}
        </h3>
        <div className="flex items-center gap-4">
          <span className="font-label text-[9px] text-on-surface-variant/60">
            Total Profit: <span className="font-bold text-tertiary">{fmtUsd(data.network_total_projected_profit_usd)}</span>
          </span>
          <span className="font-label text-[9px] text-on-surface-variant/60">
            Total Revenue: <span className="font-bold text-on-surface">{fmtUsd(data.network_total_projected_revenue_usd)}</span>
          </span>
        </div>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-12 gap-2 border-b border-white/5 bg-white/[0.02] px-4 py-2">
        {["#", "Route", "Status", "CAGR", "Total Profit", "Market Mult", "End LF", "Trend"].map((h) => (
          <span key={h} className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/40
            col-span-1 first:col-span-1 [&:nth-child(2)]:col-span-2 [&:nth-child(5)]:col-span-2 [&:nth-child(8)]:col-span-2">
            {h}
          </span>
        ))}
      </div>

      <div className="divide-y divide-white/5">
        {data.routes.map((r, i) => {
          const barPct = (Math.abs(r.total_projected_profit_usd) / maxProfit) * 100;
          const positive = r.total_projected_profit_usd >= 0;
          const cagrPositive = (r.passenger_cagr_pct ?? 0) >= 0;

          return (
            <div key={r.destination} className="px-4 py-3 hover:bg-white/[0.03] transition-colors">
              <div className="flex items-center gap-3 mb-2">
                <span className="font-label text-[10px] text-on-surface-variant/40 w-5 shrink-0">#{i + 1}</span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-on-surface">SYD → {r.destination}</span>
                    <span className="font-label text-[9px] text-on-surface-variant/60">{r.destination_city}</span>
                    <span className={`rounded border px-1.5 py-0.5 font-label text-[9px] ${
                      r.status === "active"
                        ? "border-tertiary/20 bg-tertiary/10 text-tertiary"
                        : "border-secondary/20 bg-secondary/10 text-secondary"
                    }`}>
                      {r.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <div className="font-label text-[9px] text-on-surface-variant/40">CAGR</div>
                    <div className={`font-label text-[10px] font-bold ${cagrPositive ? "text-tertiary" : "text-error"}`}>
                      {r.passenger_cagr_pct !== null ? `${r.passenger_cagr_pct >= 0 ? "+" : ""}${r.passenger_cagr_pct.toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-label text-[9px] text-on-surface-variant/40">Market ×</div>
                    <div className="font-label text-[10px] font-bold text-on-surface">
                      {r.demand_multiplier_end_year.toFixed(2)}×
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-label text-[9px] text-on-surface-variant/40">End LF</div>
                    <div className={`font-label text-[10px] font-bold ${r.end_year_load_factor >= 0.8 ? "text-tertiary" : "text-on-surface"}`}>
                      {(r.end_year_load_factor * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="text-right min-w-[72px]">
                    <div className="font-label text-[9px] text-on-surface-variant/40">Cumul. Profit</div>
                    <div className={`text-sm font-bold ${positive ? "text-tertiary" : "text-error"}`}>
                      {fmtUsd(r.total_projected_profit_usd)}
                    </div>
                  </div>
                </div>
              </div>

              {/* profit bar */}
              <div className="h-1 overflow-hidden rounded-full bg-white/10 ml-8">
                <div
                  className={`h-full rounded-full transition-all ${positive ? "bg-tertiary/60" : "bg-error/60"}`}
                  style={{ width: `${barPct}%` }}
                />
              </div>

              {/* sub-metrics */}
              <div className="mt-1.5 ml-8 flex flex-wrap gap-x-4 gap-y-0.5 font-label text-[9px] text-on-surface-variant/50">
                <span>{fmtPax(r.total_projected_passengers)} total pax</span>
                <span>{fmtUsd(r.total_projected_revenue_usd)} total rev</span>
                <span>{fmtPax(r.start_year_passengers)} → {fmtPax(r.end_year_passengers)} pax/yr</span>
                <span>{fmtUsd(r.start_year_profit_usd)} → {fmtUsd(r.end_year_profit_usd)} profit/yr</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

const DEST_LABELS: Record<string, string> = {
  SIN: "Singapore", HND: "Tokyo Haneda", MEL: "Melbourne", AKL: "Auckland", DAD: "Da Nang",
};

export default function FutureAnalysisPage() {
  const [destination, setDestination] = useState("SIN");
  const [fromYear, setFromYear] = useState(2024);
  const [toYear, setToYear] = useState(2032);

  const [macro, setMacro] = useState<MacroProjectionResponse | null>(null);
  const [future, setFuture] = useState<FutureAnalysisResponse | null>(null);
  const [network, setNetwork] = useState<NetworkFutureAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load route-level data whenever inputs change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getMacroProjection(destination, fromYear, toYear),
      getFutureAnalysis(destination, fromYear, toYear),
    ])
      .then(([m, f]) => {
        if (!cancelled) {
          setMacro(m);
          setFuture(f);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [destination, fromYear, toYear]);

  // Load network data once on mount (expensive — runs all routes)
  useEffect(() => {
    let cancelled = false;
    setNetworkLoading(true);
    getNetworkFutureAnalysis(fromYear, toYear)
      .then((n) => { if (!cancelled) { setNetwork(n); setNetworkLoading(false); } })
      .catch(() => { if (!cancelled) setNetworkLoading(false); });
    return () => { cancelled = true; };
  }, [fromYear, toYear]);

  // ── derived data ────────────────────────────────────────────────────────────

  const years = future ? Object.keys(future.yearly).sort() : [];
  const xLabels = years;

  const revenueValues = years.map((y) => future!.yearly[y].annual_revenue_usd);
  const profitValues  = years.map((y) => future!.yearly[y].annual_profit_usd);
  const paxValues     = years.map((y) => future!.yearly[y].annual_passengers);

  const macroYears = macro ? Object.keys(macro.yearly).sort() : [];
  const gdpValues      = macroYears.map((y) => macro!.yearly[y].gdp_usd);
  const tourismValues  = macroYears.map((y) => macro!.yearly[y].tourism_arrivals);
  const fuelValues     = macroYears.map((y) => macro!.yearly[y].fuel_price_usd_per_gallon);
  const multValues     = macroYears.map((y) => macro!.yearly[y].demand_multiplier);

  const lastYear  = future ? future.yearly[years[years.length - 1]] : null;
  const firstYear = future ? future.yearly[years[0]] : null;

  const totalProfit  = profitValues.reduce((a, b) => a + b, 0);
  const totalRevenue = revenueValues.reduce((a, b) => a + b, 0);
  const totalPax     = paxValues.reduce((a, b) => a + b, 0);

  const pnlData = years.map((y) => ({
    year: y,
    revenue:    future!.yearly[y].annual_revenue_usd,
    profit:     future!.yearly[y].annual_profit_usd,
    passengers: future!.yearly[y].annual_passengers,
  }));

  // ── monthly breakdown for selected route ────────────────────────────────────

  const peakMonthIdx = lastYear ? lastYear.peak_month - 1 : 0;

  return (
    <div className="space-y-6">
      {/* Header + controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">
            Future Analysis <span className="text-tertiary">&amp; Market Projections</span>
          </h1>
          <p className="text-sm text-on-surface-variant">
            GDP, tourism &amp; demand projections — macro-adjusted simulation through {toYear}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* destination */}
          <div className="flex flex-col gap-1">
            <label className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Route</label>
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="rounded border border-white/10 bg-white/5 px-2 py-1.5 font-label text-[11px] text-on-surface focus:border-tertiary focus:outline-none"
            >
              {ALL_DESTINATIONS.map((d) => (
                <option key={d} value={d}>SYD → {d} · {DEST_LABELS[d]}</option>
              ))}
            </select>
          </div>

          {/* from year */}
          <div className="flex flex-col gap-1">
            <label className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">From</label>
            <select
              value={fromYear}
              onChange={(e) => setFromYear(Number(e.target.value))}
              className="rounded border border-white/10 bg-white/5 px-2 py-1.5 font-label text-[11px] text-on-surface focus:border-tertiary focus:outline-none"
            >
              {[2023,2024,2025,2026,2027].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {/* to year */}
          <div className="flex flex-col gap-1">
            <label className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">To</label>
            <select
              value={toYear}
              onChange={(e) => setToYear(Number(e.target.value))}
              className="rounded border border-white/10 bg-white/5 px-2 py-1.5 font-label text-[11px] text-on-surface focus:border-tertiary focus:outline-none"
            >
              {[2027,2028,2029,2030,2031,2032,2035].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && <ErrorMessage message={error} />}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* KPI cards */}
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard
              icon="rocket_launch"
              label="Passenger CAGR"
              value={future?.passenger_cagr_pct !== null ? `${(future?.passenger_cagr_pct ?? 0) >= 0 ? "+" : ""}${(future?.passenger_cagr_pct ?? 0).toFixed(1)}%` : "—"}
              delta={(future?.passenger_cagr_pct ?? 0) >= 0 ? "GROWING" : "DECLINING"}
              deltaClass={(future?.passenger_cagr_pct ?? 0) >= 0 ? "text-tertiary" : "text-error"}
            />
            <KpiCard
              icon="bar_chart"
              label={`Market Size ${toYear}`}
              value={`${lastYear ? lastYear.demand_multiplier.toFixed(2) : "—"}×`}
              delta={`vs ${fromYear} baseline`}
              deltaClass="text-on-surface-variant"
            />
            <KpiCard
              icon="payments"
              label={`Cumul. Revenue ${fromYear}–${toYear}`}
              value={fmtUsd(totalRevenue)}
            />
            <KpiCard
              icon="trending_up"
              label={`Cumul. Profit ${fromYear}–${toYear}`}
              value={fmtUsd(totalProfit)}
              delta={totalProfit >= 0 ? "POSITIVE" : "LOSS"}
              deltaClass={totalProfit >= 0 ? "text-tertiary" : "text-error"}
            />
            <KpiCard
              icon="groups"
              label={`Cumul. Passengers`}
              value={fmtPax(totalPax)}
            />
            <KpiCard
              icon="local_gas_station"
              label={`Fuel ${toYear}`}
              value={`$${lastYear?.projected_fuel_price_usd_per_gallon.toFixed(2) ?? "—"}/gal`}
              delta="projected"
              deltaClass="text-on-surface-variant"
            />
          </section>

          {/* Demand Multiplier highlight */}
          <div className="glass-panel rounded-lg p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-label text-[10px] uppercase tracking-widest text-primary">
                <span className="material-symbols-outlined text-[14px] text-tertiary">open_in_full</span>
                Market Size Growth · SYD → {destination} · {fromYear}–{toYear}
              </h3>
              <span className="font-label text-[9px] text-on-surface-variant/60">
                Demand multiplier = 0.6 × (GDP growth ^ 1.5 elasticity) + 0.4 × tourism growth
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Demand multiplier chart */}
              <div>
                <div className="mb-1 font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">
                  Total addressable market multiplier (1.0 = {fromYear} baseline)
                </div>
                <div className="relative h-28 w-full">
                  <MultiLineChart
                    series={[
                      { label: "Market Size ×", values: multValues, color: "#4cd7f6" },
                    ]}
                    xLabels={macroYears}
                    height={112}
                  />
                </div>
              </div>

              {/* Year-by-year table */}
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10">
                      {["Year", "GDP", "GDP Growth", "Tourism", "Demand ×", "Source"].map((h) => (
                        <th key={h} className="pb-1.5 text-left font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50 pr-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {macroYears.map((y) => {
                      const row = macro!.yearly[y];
                      const isProj = row.data_source === "projected";
                      return (
                        <tr key={y} className={isProj ? "opacity-80" : ""}>
                          <td className="py-1 pr-3 font-bold text-on-surface">{y}</td>
                          <td className="py-1 pr-3 text-on-surface">{fmtGdp(row.gdp_usd)}</td>
                          <td className={`py-1 pr-3 font-bold ${row.gdp_growth_pct >= 0 ? "text-tertiary" : "text-error"}`}>
                            {row.gdp_growth_pct >= 0 ? "+" : ""}{row.gdp_growth_pct.toFixed(2)}%
                          </td>
                          <td className="py-1 pr-3 text-on-surface">{(row.tourism_arrivals / 1e6).toFixed(1)}M</td>
                          <td className="py-1 pr-3 font-bold text-tertiary">{row.demand_multiplier.toFixed(3)}×</td>
                          <td className="py-1">
                            <span className={`rounded px-1.5 py-0.5 font-label text-[9px] ${
                              isProj ? "bg-secondary/10 text-secondary" : "bg-tertiary/10 text-tertiary"
                            }`}>
                              {isProj ? "PROJ" : "HIST"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Macro signals row */}
          <div>
            <h3 className="mb-3 flex items-center gap-2 font-label text-[10px] uppercase tracking-widest text-primary">
              <span className="material-symbols-outlined text-[14px] text-tertiary">analytics</span>
              Macro Signals · {DEST_LABELS[destination]}
            </h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MacroSignalCard
                label="GDP"
                icon="account_balance"
                values={gdpValues}
                xLabels={macroYears}
                format={fmtGdp}
                color="#4cd7f6"
              />
              <MacroSignalCard
                label="Tourism Arrivals"
                icon="travel_explore"
                values={tourismValues}
                xLabels={macroYears}
                format={(v) => `${(v / 1e6).toFixed(1)}M`}
                color="#a78bfa"
              />
              <MacroSignalCard
                label="Population"
                icon="groups"
                values={macroYears.map((y) => macro!.yearly[y].population)}
                xLabels={macroYears}
                format={(v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`}
                color="#34d399"
              />
              <MacroSignalCard
                label="Jet Fuel"
                icon="local_gas_station"
                values={fuelValues}
                xLabels={macroYears}
                format={(v) => `$${v.toFixed(2)}/gal`}
                color="#fb923c"
              />
            </div>
          </div>

          {/* P&L trajectory */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="glass-panel rounded-lg p-4">
              <h3 className="mb-4 flex items-center gap-2 font-label text-[10px] uppercase tracking-widest text-primary">
                <span className="material-symbols-outlined text-[14px] text-tertiary">monitoring</span>
                Revenue &amp; Profit Trajectory · {destination}
              </h3>
              <PnLChart data={pnlData} />
            </div>

            <div className="glass-panel rounded-lg p-4">
              <h3 className="mb-3 flex items-center gap-2 font-label text-[10px] uppercase tracking-widest text-primary">
                <span className="material-symbols-outlined text-[14px] text-tertiary">table_rows</span>
                Annual P&amp;L Summary · {destination}
              </h3>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10">
                      {["Year", "Pax", "Revenue", "Profit", "LF", "YoY"].map((h) => (
                        <th key={h} className="pb-1.5 text-left font-label text-[9px] uppercase tracking-widest text-on-surface-variant/50 pr-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {years.map((y) => {
                      const row = future!.yearly[y];
                      const profitPositive = row.annual_profit_usd >= 0;
                      return (
                        <tr key={y} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-1.5 pr-2 font-bold text-on-surface">{y}</td>
                          <td className="py-1.5 pr-2 text-on-surface">{fmtPax(row.annual_passengers)}</td>
                          <td className="py-1.5 pr-2 text-on-surface">{fmtUsd(row.annual_revenue_usd)}</td>
                          <td className={`py-1.5 pr-2 font-bold ${profitPositive ? "text-tertiary" : "text-error"}`}>
                            {fmtUsd(row.annual_profit_usd)}
                          </td>
                          <td className={`py-1.5 pr-2 ${row.avg_load_factor >= 0.8 ? "text-tertiary" : "text-on-surface"}`}>
                            {(row.avg_load_factor * 100).toFixed(0)}%
                          </td>
                          <td className={row.yoy_growth_pct === null ? "text-on-surface-variant/40" :
                            row.yoy_growth_pct >= 0 ? "text-tertiary" : "text-error"}>
                            {row.yoy_growth_pct === null ? "—" : `${row.yoy_growth_pct >= 0 ? "+" : ""}${row.yoy_growth_pct.toFixed(1)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* capacity constraint notice if peak LF is high */}
              {lastYear && lastYear.avg_load_factor >= 0.82 && (
                <div className="mt-3 flex items-start gap-2 rounded border border-secondary/20 bg-secondary/5 px-3 py-2">
                  <span className="material-symbols-outlined text-[14px] text-secondary shrink-0 mt-0.5">warning</span>
                  <p className="font-label text-[10px] text-secondary">
                    Capacity constraint: {(lastYear.avg_load_factor * 100).toFixed(0)}% average load factor in {toYear}.
                    Demand growth is spilling into latent demand — adding frequency or upgrading aircraft
                    would capture additional revenue.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Monthly detail for end year */}
          {lastYear && (
            <div className="glass-panel rounded-lg p-4">
              <h3 className="mb-3 flex items-center gap-2 font-label text-[10px] uppercase tracking-widest text-primary">
                <span className="material-symbols-outlined text-[14px] text-tertiary">calendar_month</span>
                Monthly Profile · {destination} · {toYear}
              </h3>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* passenger bars */}
                <div>
                  <div className="mb-2 font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Passengers per month</div>
                  <div className="flex items-end gap-1.5" style={{ height: 72 }}>
                    {lastYear.monthly.map((m) => {
                      const maxM = Math.max(...lastYear.monthly.map((x) => x.passengers), 1);
                      const isPeak = m.month - 1 === peakMonthIdx;
                      return (
                        <div key={m.month} className="flex flex-1 flex-col items-center gap-0.5">
                          <div className="w-full flex flex-col justify-end" style={{ height: 64 }}>
                            <div
                              className={`w-full rounded-t transition-colors ${isPeak ? "bg-tertiary" : "bg-tertiary/40 hover:bg-tertiary/70"}`}
                              style={{ height: `${Math.max((m.passengers / maxM) * 100, 4)}%` }}
                              title={`${MONTH_SHORT[m.month - 1]}: ${fmtPax(m.passengers)}`}
                            />
                          </div>
                          <span className="font-label text-[8px] text-on-surface-variant/40">{MONTH_SHORT[m.month - 1]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* load factor bars */}
                <div>
                  <div className="mb-2 font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">Load factor per month</div>
                  <div className="flex items-end gap-1.5" style={{ height: 72 }}>
                    {lastYear.monthly.map((m) => {
                      const color = m.load_factor >= 0.85 ? "bg-tertiary" : m.load_factor >= 0.7 ? "bg-tertiary/60" : "bg-secondary/50";
                      return (
                        <div key={m.month} className="flex flex-1 flex-col items-center gap-0.5">
                          <div className="w-full flex flex-col justify-end" style={{ height: 64 }}>
                            <div
                              className={`w-full rounded-t ${color} hover:opacity-80 transition-opacity`}
                              style={{ height: `${Math.max(m.load_factor * 100, 4)}%` }}
                              title={`${MONTH_SHORT[m.month - 1]}: ${(m.load_factor * 100).toFixed(0)}%`}
                            />
                          </div>
                          <span className="font-label text-[8px] text-on-surface-variant/40">{MONTH_SHORT[m.month - 1]}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-3 mt-1.5 font-label text-[8px] text-on-surface-variant/40">
                    <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-tertiary inline-block" />≥85%</span>
                    <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-tertiary/60 inline-block" />70-85%</span>
                    <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-secondary/50 inline-block" />&lt;70%</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <div className="flex items-center gap-1.5 rounded border border-tertiary/20 bg-tertiary/5 px-2 py-1">
                  <span className="font-label text-[9px] text-on-surface-variant">Peak month:</span>
                  <span className="font-label text-[9px] font-bold text-tertiary">{MONTH_SHORT[peakMonthIdx]}</span>
                </div>
                <div className="flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1">
                  <span className="font-label text-[9px] text-on-surface-variant">Fuel {toYear}:</span>
                  <span className="font-label text-[9px] font-bold text-on-surface">${lastYear.projected_fuel_price_usd_per_gallon.toFixed(2)}/gal</span>
                </div>
                <div className="flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1">
                  <span className="font-label text-[9px] text-on-surface-variant">Market size:</span>
                  <span className="font-label text-[9px] font-bold text-tertiary">{lastYear.demand_multiplier.toFixed(2)}× vs {fromYear}</span>
                </div>
                <div className="flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1">
                  <span className="font-label text-[9px] text-on-surface-variant">Tourism {toYear}:</span>
                  <span className="font-label text-[9px] font-bold text-on-surface">{(lastYear.tourism_arrivals / 1e6).toFixed(1)}M arrivals</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Network Portfolio — loads independently */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-on-surface">
          Network Portfolio <span className="text-tertiary">{fromYear}–{toYear}</span>
        </h2>
        {networkLoading ? (
          <div className="glass-panel rounded-lg p-8 text-center">
            <div className="mb-2 inline-flex h-8 w-8 animate-spin items-center justify-center rounded-full border-2 border-tertiary/30 border-t-tertiary" />
            <p className="font-label text-[10px] text-on-surface-variant/60">Computing multi-year projections for all routes…</p>
          </div>
        ) : network ? (
          <NetworkTable data={network} />
        ) : null}
      </div>
    </div>
  );
}
