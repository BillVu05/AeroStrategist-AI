"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getReport } from "@/lib/api";
import type { AnalyzeRouteResponse, CopilotResponse, ReportRecord } from "@/lib/types";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import CopilotReportView from "@/components/CopilotReportView";
import { RouteAnalysisReport } from "@/components/RouteAnalysisCard";

export default function ReportPreviewPage() {
  const params = useParams<{ id: string }>();
  const [record, setRecord] = useState<ReportRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getReport(params.id)
      .then(setRecord)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [params.id]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">
            Report <span className="text-tertiary">Preview</span>
          </h1>
          {record && <p className="text-sm text-on-surface-variant">{record.title}</p>}
        </div>
        <Link
          href="/reports"
          className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-1.5 font-label text-[11px] uppercase tracking-widest text-on-surface-variant transition-colors hover:bg-white/10"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Report Library
        </Link>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && <ErrorMessage message={error} />}

      {record && record.kind === "route_analysis" && (
        <CopilotReportView report={record.payload as CopilotResponse} />
      )}

      {record && record.kind === "open_route" && (
        <RouteAnalysisReport result={record.payload as AnalyzeRouteResponse} />
      )}
    </div>
  );
}
