import AvailabilityNotice from "@/components/AvailabilityNotice";
import type { CopilotMarketAnalysis, CopilotRiskAnalysis, CopilotStrategy } from "@/lib/types";

interface ReportSectionProps {
  title: string;
  available: boolean;
  text: string;
  children?: React.ReactNode;
}

function ReportSection({ title, available, text, children }: ReportSectionProps) {
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-900">{title}</h3>
      {available ? (
        <p className="whitespace-pre-wrap text-sm text-gray-700">{text}</p>
      ) : (
        <AvailabilityNotice text={text} />
      )}
      {children}
    </section>
  );
}

interface CopilotReportProps {
  marketAnalysis: CopilotMarketAnalysis;
  riskAnalysis: CopilotRiskAnalysis;
  strategy: CopilotStrategy;
}

export default function CopilotReport({ marketAnalysis, riskAnalysis, strategy }: CopilotReportProps) {
  const competitors = (marketAnalysis.context?.competitors as
    | { name: string; weekly_frequency: number; avg_fare_usd: number; rating: number }[]
    | undefined) ?? [];

  return (
    <div className="space-y-4">
      <ReportSection title="Market Analysis" available={marketAnalysis.available} text={marketAnalysis.commentary}>
        {competitors.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-1 pr-2">Competitor</th>
                  <th className="py-1 pr-2 text-right">Weekly frequency</th>
                  <th className="py-1 pr-2 text-right">Avg fare (USD)</th>
                  <th className="py-1 text-right">Rating</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c) => (
                  <tr key={c.name} className="border-b border-gray-100 last:border-0">
                    <td className="py-1 pr-2 text-gray-700">{c.name}</td>
                    <td className="py-1 pr-2 text-right">{c.weekly_frequency}</td>
                    <td className="py-1 pr-2 text-right">${c.avg_fare_usd.toFixed(2)}</td>
                    <td className="py-1 text-right">{c.rating}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      <ReportSection title="Risk Analysis" available={riskAnalysis.available} text={riskAnalysis.risks} />

      <ReportSection
        title="Strategy Recommendation"
        available={strategy.available}
        text={strategy.executive_summary}
      />
    </div>
  );
}
