"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getReports } from "@/lib/api";
import type { ReportSummary } from "@/lib/types";
import { AGENT_META } from "@/lib/reportMeta";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";

function fmtDate(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${date.toUpperCase()} • ${time} UTC`;
}

function AgentChips({ agents, size = 6 }: { agents: string[]; size?: number }) {
  return (
    <div className="flex -space-x-2">
      {agents.map((a) => (
        <div
          key={a}
          title={AGENT_META[a]?.label ?? a}
          className="flex items-center justify-center rounded-full border border-surface bg-tertiary/30"
          style={{ width: size * 4, height: size * 4 }}
        >
          <span className="material-symbols-outlined text-[12px] text-white" style={{ fontVariationSettings: "'FILL' 1" }}>
            {AGENT_META[a]?.icon ?? "smart_toy"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReportCard({ report }: { report: ReportSummary }) {
  return (
    <div className="glass-panel group relative flex flex-col overflow-hidden rounded-xl transition-all duration-300 hover:border-tertiary/40">
      <div className="relative flex h-32 items-center justify-center overflow-hidden bg-gradient-to-br from-tertiary/10 via-surface-container to-black/40">
        <span className="font-label text-3xl font-bold tracking-tight text-on-surface/10">{report.destination}</span>
        <div className="absolute inset-0 bg-gradient-to-t from-surface-container/90 to-transparent" />
        <div className="absolute right-3 top-3 rounded border border-tertiary/30 bg-tertiary/20 px-2 py-0.5 font-label text-[9px] uppercase tracking-widest text-tertiary">
          GENERATED
        </div>
        <div className="absolute bottom-3 left-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant/70">
          SYD → {report.destination}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-4">
          <p className="mb-1 font-label text-[10px] uppercase tracking-wider text-outline-variant">{fmtDate(report.created_at)}</p>
          <h4 className="text-base font-semibold leading-tight text-on-surface transition-colors group-hover:text-tertiary">
            {report.title}
          </h4>
        </div>
        <div className="flex-1">
          <p className="mb-4 line-clamp-2 text-sm text-on-surface-variant">{report.description}</p>
          <div className="flex items-center gap-2">
            <span className="font-label text-[9px] uppercase tracking-widest text-outline-variant">Agents:</span>
            <AgentChips agents={report.agents} />
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-between border-t border-white/10 bg-surface-container/90 p-4 backdrop-blur-md transition-transform group-hover:translate-y-0">
        <Link href={`/reports/${report.id}`} className="flex items-center gap-2 font-label text-xs text-on-surface transition-colors hover:text-tertiary">
          <span className="material-symbols-outlined text-[16px]">visibility</span> Preview
        </Link>
        <button type="button" className="flex items-center gap-2 font-label text-xs text-on-surface transition-colors hover:text-tertiary">
          <span className="material-symbols-outlined text-[16px]">download</span> Download PDF
        </button>
      </div>
    </div>
  );
}

function InitiateAnalysisCard() {
  return (
    <Link
      href="/reports/new"
      className="glass-panel group flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-xl border-dashed border-white/10 p-8 transition-all hover:border-tertiary/50 hover:bg-white/5"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 transition-all group-hover:scale-110 group-hover:bg-tertiary/20">
        <span className="material-symbols-outlined text-[32px] text-outline-variant group-hover:text-tertiary">add</span>
      </div>
      <div className="text-center">
        <p className="font-semibold text-on-surface-variant group-hover:text-on-surface">Initiate Analysis</p>
        <p className="mt-1 font-label text-[10px] uppercase tracking-widest text-outline-variant">Create new intelligence report</p>
      </div>
    </Link>
  );
}

export default function ReportsLibraryPage() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");

  const [agentFilter, setAgentFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [dateRange, setDateRange] = useState("all");

  function load() {
    setLoading(true);
    setError(null);
    getReports()
      .then((res) => setReports(res.reports))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = reports.filter((r) => {
    if (agentFilter && !r.agents.includes(agentFilter)) return false;
    if (kindFilter && r.kind !== kindFilter) return false;
    if (dateRange !== "all") {
      const cutoff = Date.now() - Number(dateRange) * 86400000;
      if (new Date(r.created_at).getTime() < cutoff) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* ── page header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-on-surface">
            Reports <span className="text-tertiary">Library</span>
          </h1>
          <div className="flex items-center gap-1.5 rounded-full border border-white/5 bg-black/20 px-3 py-1">
            <span className="agent-pulse material-symbols-outlined text-[10px] text-tertiary" style={{ fontVariationSettings: "'FILL' 1" }}>
              circle
            </span>
            <span className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant">System Stable</span>
          </div>
        </div>
        <Link
          href="/reports/new"
          className="flex items-center gap-2 rounded bg-accent-blue px-4 py-2 font-label text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          Generate New Report
        </Link>
      </div>

      {/* ── filter bar ── */}
      <div className="glass-panel flex flex-wrap items-end gap-4 rounded-xl p-4">
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block font-label text-[10px] uppercase tracking-widest text-outline-variant">Agent Type</label>
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-on-surface focus:border-tertiary focus:outline-none"
          >
            <option value="">All Intelligence Agents</option>
            {Object.entries(AGENT_META).map(([key, meta]) => (
              <option key={key} value={key}>{meta.label}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block font-label text-[10px] uppercase tracking-widest text-outline-variant">Date Range</label>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-on-surface focus:border-tertiary focus:outline-none"
          >
            <option value="all">All Time</option>
            <option value="7">Last 7 Days</option>
            <option value="30">Last 30 Days</option>
            <option value="90">Last 90 Days</option>
          </select>
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block font-label text-[10px] uppercase tracking-widest text-outline-variant">Route Type</label>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-on-surface focus:border-tertiary focus:outline-none"
          >
            <option value="">All Routes</option>
            <option value="route_analysis">Existing Network</option>
            <option value="open_route">Open Route Exploration</option>
          </select>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-2 rounded border border-white/5 bg-surface-variant px-6 py-2.5 font-label text-sm text-on-surface transition-colors hover:bg-surface-container-highest"
        >
          <span className="material-symbols-outlined text-[20px]">filter_list</span>
          Apply Filters
        </button>
      </div>

      {/* ── section header ── */}
      <div className="flex items-center justify-between">
        <h3 className="font-headline-md text-[14px] uppercase tracking-widest text-on-surface-variant">
          Historical Analyses &amp; Recent Outputs
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setView("grid")}
            className={`flex h-8 w-8 items-center justify-center rounded border border-white/10 ${
              view === "grid" ? "bg-white/5 text-tertiary" : "bg-transparent text-outline-variant hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">grid_view</span>
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={`flex h-8 w-8 items-center justify-center rounded border border-white/10 ${
              view === "list" ? "bg-white/5 text-tertiary" : "bg-transparent text-outline-variant hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">list</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && <ErrorMessage message={error} />}

      {!loading && !error && (
        view === "grid" ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((r) => <ReportCard key={r.id} report={r} />)}
            <InitiateAnalysisCard />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="glass-panel divide-y divide-white/5 overflow-hidden rounded-lg">
              {filtered.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-on-surface-variant">No saved reports match these filters.</p>
              )}
              {filtered.map((r) => (
                <Link
                  key={r.id}
                  href={`/reports/${r.id}`}
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-white/5"
                >
                  <span className="w-36 shrink-0 font-label text-[10px] text-on-surface-variant/50">{fmtDate(r.created_at)}</span>
                  <span className="flex-1 truncate text-sm text-on-surface">{r.title}</span>
                  <span className="w-32 shrink-0 font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60">
                    {r.kind === "open_route" ? "Open Route" : "Network"}
                  </span>
                  <AgentChips agents={r.agents} size={5} />
                </Link>
              ))}
            </div>
            <InitiateAnalysisCard />
          </div>
        )
      )}
    </div>
  );
}
