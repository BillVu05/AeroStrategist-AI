"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getCopilot, getHealth, getRoutes, getWhatIfPresets, postChat, saveReport } from "@/lib/api";
import type { ChatMessage, ChatToolCall, CopilotResponse, RouteInfo, SaveReportRequest, WhatIfPresets } from "@/lib/types";
import { ALL_DESTINATIONS, DEFAULT_MONTH, DEFAULT_YEAR, EXAMPLE_QUESTIONS, MONTH_NAMES } from "@/lib/constants";
import ChatToolResult from "@/components/ChatToolResult";
import { AGENT_LIST } from "@/lib/reportMeta";
import AvailabilityNotice from "@/components/AvailabilityNotice";
import ErrorMessage from "@/components/ErrorMessage";
import CopilotReportView from "@/components/CopilotReportView";
import { fmtUsd } from "@/lib/format";

// ─── markdown rendering for AI replies ────────────────────────────────────────

const MARKDOWN_COMPONENTS = {
  h1: ({ children }: ComponentPropsWithoutRef<"h1">) => (
    <h3 className="mt-3 mb-1.5 font-label text-[11px] uppercase tracking-widest text-primary first:mt-0">{children}</h3>
  ),
  h2: ({ children }: ComponentPropsWithoutRef<"h2">) => (
    <h3 className="mt-3 mb-1.5 font-label text-[11px] uppercase tracking-widest text-primary first:mt-0">{children}</h3>
  ),
  h3: ({ children }: ComponentPropsWithoutRef<"h3">) => (
    <h4 className="mt-2 mb-1 font-label text-[10px] uppercase tracking-widest text-tertiary">{children}</h4>
  ),
  p: ({ children }: ComponentPropsWithoutRef<"p">) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }: ComponentPropsWithoutRef<"ul">) => <ul className="mb-2 ml-4 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }: ComponentPropsWithoutRef<"ol">) => <ol className="mb-2 ml-4 list-decimal space-y-0.5">{children}</ol>,
  li: ({ children }: ComponentPropsWithoutRef<"li">) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }: ComponentPropsWithoutRef<"strong">) => <strong className="font-semibold text-on-surface">{children}</strong>,
  hr: () => <hr className="my-2 border-white/10" />,
};

// ─── report generation (absorbed from the old /reports/new page) ─────────────


/**
 * Which route the question is about. The route dropdown is the fallback, but a
 * question that names a destination (code or city) wins - clicking "Generate
 * full report" after asking about Da Nang should not report on Singapore.
 */
function destinationForQuestion(question: string, routes: RouteInfo[], fallback: string): string {
  const q = question.toLowerCase();
  const candidates = routes.length
    ? routes.map((r) => ({ code: r.destination, city: r.destination_city }))
    : ALL_DESTINATIONS.map((d) => ({ code: d, city: d }));
  const hit = candidates.find(
    ({ code, city }) =>
      new RegExp(`\\b${code.toLowerCase()}\\b`).test(q) || q.includes(city.toLowerCase()),
  );
  return hit?.code ?? fallback;
}

function buildSaveRequest(report: CopilotResponse, destinationCity: string): SaveReportRequest {
  const agents = ["demand", "finance"];
  if (report.market_analysis.available) agents.push("market");
  if (report.risk_analysis.available) agents.push("risk");
  if (report.strategy.available) agents.push("strategy");

  const summary = report.strategy.available
    ? report.strategy.executive_summary
    : `Full 5-agent pipeline run for SYD → ${destinationCity}, ${MONTH_NAMES[report.month - 1]} ${report.year}. Scenario profit ${fmtUsd(report.finance.scenario.profit_usd)} (${report.finance.delta.profit_usd >= 0 ? "+" : ""}${fmtUsd(report.finance.delta.profit_usd)} vs baseline).`;
  const description = summary.length > 220 ? `${summary.slice(0, 220).trimEnd()}…` : summary;

  const question = report.question?.trim();
  const title = question
    ? `${question.length > 80 ? `${question.slice(0, 80).trimEnd()}…` : question} (SYD → ${destinationCity})`
    : `SYD → ${destinationCity} Strategy Analysis`;

  return {
    kind: "route_analysis",
    destination: report.destination,
    destination_city: destinationCity,
    title,
    description,
    agents,
    payload: report,
  };
}

// ─── types ────────────────────────────────────────────────────────────────────

interface DisplayMessage extends ChatMessage {
  available?: boolean;
  toolCalls?: ChatToolCall[];
}

// ─── page wrapper ─────────────────────────────────────────────────────────────

export default function CopilotPage() {
  return (
    <Suspense fallback={null}>
      <CopilotPageInner />
    </Suspense>
  );
}

// ─── inner component ──────────────────────────────────────────────────────────

function CopilotPageInner() {
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Report-generation flow
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [presets, setPresets] = useState<WhatIfPresets>({});
  const [destination, setDestination] = useState<string>(ALL_DESTINATIONS[0]);
  const [preset, setPreset] = useState<string>("");
  const [report, setReport] = useState<CopilotResponse | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    getHealth().then((h) => setLlmAvailable(h.llm_available)).catch(() => setLlmAvailable(false));
    Promise.all([getRoutes(), getWhatIfPresets()])
      .then(([routesData, presetsData]) => {
        setRoutes(routesData.routes);
        setPresets(presetsData);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, report, reportLoading]);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q && messages.length === 0) sendMessage(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const nextMessages: DisplayMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await postChat(nextMessages.map(({ role, content }) => ({ role, content })));
      setMessages([
        ...nextMessages,
        { role: "model", content: res.reply, available: res.available, toolCalls: res.tool_calls },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function generateReport() {
    if (reportLoading) return;
    setReportLoading(true);
    setReport(null);
    setSavedId(null);
    setError(null);

    // The report answers what was actually asked: the last question typed in
    // the chat steers the Market/Risk/Strategy agents and picks the route,
    // falling back to the dropdown when nothing has been asked yet. The chat's
    // own answer goes with it as `evidence` - that is what makes this a deeper
    // pass over the question rather than a second, shallower answer to it.
    const question = [...messages].reverse().find((m) => m.role === "user")?.content.trim() ?? "";
    const evidence = [...messages]
      .reverse()
      .find((m) => m.role === "model" && m.available !== false)
      ?.content.trim()
      .slice(0, 8000);
    const target = question ? destinationForQuestion(question, routes, destination) : destination;
    const destinationCity = routes.find((r) => r.destination === target)?.destination_city ?? target;

    try {
      const result = await getCopilot({
        destination: target,
        year: DEFAULT_YEAR,
        month: DEFAULT_MONTH,
        ...(preset ? { preset } : {}),
        ...(question ? { question } : {}),
        ...(evidence ? { evidence } : {}),
      });
      setReport(result);

      try {
        const saved = await saveReport(buildSaveRequest(result, destinationCity));
        setSavedId(saved.id);
      } catch {
        // Library save failing shouldn't hide the analysis the user just ran.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReportLoading(false);
    }
  }

  const hasMessages = messages.length > 0;
  const pipelineRunning = reportLoading;
  const pipelineDone = !reportLoading && report !== null;

  return (
    <div className="flex h-[calc(100vh-9rem)] gap-4">
      {/* ── left: chat column ── */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {/* status bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="agent-pulse h-2 w-2 rounded-full bg-tertiary" />
            <h2 className="font-label text-[10px] uppercase tracking-widest text-primary">Strategy Copilot</h2>
          </div>
          {llmAvailable !== null && (
            <span
              className={`rounded border px-2 py-0.5 font-label text-[10px] ${
                llmAvailable
                  ? "border-tertiary/20 bg-tertiary/10 text-tertiary"
                  : "border-white/10 bg-white/5 text-on-surface-variant"
              }`}
            >
              {llmAvailable ? "MULTI-AGENT SYNC ACTIVE" : "AI OFFLINE · Set GEMINI_API_KEY"}
            </span>
          )}
        </div>

        {/* chat messages */}
        <div className="glass-panel flex-1 space-y-4 overflow-y-auto rounded-lg p-4">
          {!hasMessages && !report && !reportLoading && (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
              <span className="material-symbols-outlined text-[40px] text-tertiary/30">forum</span>
              <div>
                <p className="text-sm text-on-surface-variant">
                  Ask about routes, fares, capacity, fuel, competitors — or generate a full 5-agent report below.
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {EXAMPLE_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => sendMessage(q)}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-tertiary transition-colors hover:bg-tertiary/10"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            const isUser = msg.role === "user";
            return (
              <div key={i} className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
                {!isUser && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-tertiary/30 bg-tertiary/10">
                    <span className="material-symbols-outlined text-[18px] text-tertiary">smart_toy</span>
                  </div>
                )}
                <div className={`space-y-2 ${isUser ? "max-w-[75%]" : "w-full"}`}>
                  {msg.available === false ? (
                    <AvailabilityNotice text={msg.content} />
                  ) : isUser ? (
                    <div className="whitespace-pre-wrap rounded-xl rounded-tr-none bg-secondary-container px-4 py-2 text-sm text-white shadow-lg">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="rounded-xl rounded-tl-none border border-white/5 bg-white/5 px-4 py-3 text-sm leading-relaxed text-on-surface">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}

                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="space-y-2">
                      {msg.toolCalls.map((tc, j) => (
                        <ChatToolResult key={j} toolCall={tc} />
                      ))}
                    </div>
                  )}
                </div>
                {isUser && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary-container">
                    <span className="material-symbols-outlined text-[18px] text-white">person</span>
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="flex justify-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-tertiary/30 bg-tertiary/10">
                <span className="material-symbols-outlined text-[18px] text-tertiary">smart_toy</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl rounded-tl-none border border-white/5 bg-white/5 px-4 py-3">
                <span className="agent-pulse h-2 w-2 rounded-full bg-tertiary" />
                <div className="space-y-0.5">
                  <p className="text-sm text-on-surface-variant">Agents researching…</p>
                  <p className="font-label text-[10px] text-on-surface-variant/50">
                    Running simulations and building forecast
                  </p>
                </div>
              </div>
            </div>
          )}

          {reportLoading && (
            <div className="flex flex-col items-center gap-3 py-12 text-on-surface-variant">
              <span className="agent-pulse h-3 w-3 rounded-full bg-tertiary" />
              <p className="text-sm">Running 5-agent pipeline — LLM agents may take up to 30s…</p>
            </div>
          )}

          {report && (
            <div className="space-y-3">
              {report.question && (
                <div className="rounded border border-white/10 bg-white/5 px-4 py-2.5">
                  <p className="font-label text-[10px] uppercase tracking-widest text-outline-variant">
                    5-agent deep dive · SYD → {report.destination}
                  </p>
                  <p className="mt-1 text-sm text-on-surface">{report.question}</p>
                </div>
              )}
              {savedId && (
                <div className="flex items-center gap-2 rounded border border-tertiary/20 bg-tertiary/10 px-4 py-2.5">
                  <span className="material-symbols-outlined text-[16px] text-tertiary">check_circle</span>
                  <span className="font-label text-[11px] text-tertiary">Saved to Report Library</span>
                  <Link
                    href={`/reports/${savedId}`}
                    className="ml-auto font-label text-[11px] text-tertiary underline hover:no-underline"
                  >
                    View saved report →
                  </Link>
                </div>
              )}
              <CopilotReportView report={report} />
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {error && <ErrorMessage message={error} />}

        {/* report preset chips + input */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <div className="glass-panel flex shrink-0 items-center gap-2 rounded-lg border-tertiary/20 px-3 py-1.5">
              <span className="material-symbols-outlined text-[16px] text-tertiary">map</span>
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="cursor-pointer border-none bg-transparent font-label text-[11px] text-on-surface focus:outline-none"
              >
                {(routes.length ? routes.map((r) => r.destination) : Array.from(ALL_DESTINATIONS)).map((d) => (
                  <option key={d} value={d} className="bg-surface-container">
                    Route: SYD → {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="glass-panel flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5">
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
                settings_input_component
              </span>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                className="cursor-pointer border-none bg-transparent font-label text-[11px] text-on-surface-variant focus:outline-none"
              >
                <option value="" className="bg-surface-container">
                  Preset: Baseline
                </option>
                {Object.entries(presets).map(([key, val]) => (
                  <option key={key} value={key} className="bg-surface-container">
                    Preset: {val.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={generateReport}
              disabled={reportLoading}
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-tertiary/10 px-3 py-1.5 font-label text-[11px] text-tertiary transition-all hover:bg-tertiary/20 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">description</span>
              {reportLoading ? "GENERATING…" : hasMessages ? "DEEP DIVE ON THIS QUESTION" : "GENERATE FULL REPORT"}
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Strategy Copilot about demand, revenue, forecasts, or a strategy decision…"
              className="flex-1 rounded border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-on-surface transition-colors placeholder:text-on-surface-variant/40 focus:border-tertiary focus:outline-none"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex items-center gap-2 rounded bg-secondary-container px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-secondary-container/80 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">send</span>
              Send
            </button>
          </form>
        </div>
      </div>

      {/* ── right: agent pipeline panel ── */}
      <aside className="glass-panel hidden w-80 shrink-0 flex-col rounded-lg xl:flex">
        <div className="border-b border-white/10 p-4">
          <h2 className="font-label text-[11px] font-bold uppercase tracking-wider text-on-surface">
            Agent Pipeline
          </h2>
          <p className="font-label text-[10px] text-on-surface-variant/60">Parallel strategic processing</p>
        </div>
        <div className="relative flex-1 overflow-y-auto p-4">
          <div className="absolute bottom-8 left-[31px] top-8 w-[2px] bg-white/5" />
          <div className="relative space-y-8">
            {AGENT_LIST.map((agent) => {
              const online = !agent.llm || llmAvailable === true;
              const status = pipelineRunning
                ? "PROCESSING"
                : pipelineDone
                ? online
                  ? "COMPLETE"
                  : "SKIPPED"
                : online
                ? agent.llm
                  ? "AI READY"
                  : "COMPUTE"
                : "OFFLINE";
              const active = pipelineRunning || (pipelineDone && online);
              return (
                <div key={agent.id} className={`flex gap-4 ${online ? "" : "opacity-50"}`}>
                  <div className="relative z-10">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                        pipelineDone && online
                          ? "border-tertiary bg-tertiary text-on-tertiary"
                          : pipelineRunning
                          ? "agent-pulse border-tertiary bg-surface-container-highest text-tertiary"
                          : online
                          ? "border-tertiary/40 bg-surface-container-highest text-tertiary"
                          : "border-white/10 bg-surface-container-highest text-on-surface-variant"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {pipelineDone && online ? "check" : pipelineRunning ? "sync" : agent.icon}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <h4 className="text-sm font-bold text-on-surface">{agent.label}</h4>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-label text-[9px] ${
                          active
                            ? "bg-tertiary/10 text-tertiary"
                            : online
                            ? "bg-white/5 text-on-surface-variant"
                            : "bg-white/5 text-on-surface-variant/40"
                        }`}
                      >
                        {status}
                      </span>
                    </div>
                    <p className="font-label text-[10px] leading-relaxed text-on-surface-variant/70">
                      {online ? agent.blurb : "Set GEMINI_API_KEY to activate"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center justify-between">
            <span className="font-label text-[10px] uppercase text-on-surface-variant">Pipeline Status</span>
            <span className="flex items-center gap-2 font-label text-[11px] font-bold text-tertiary">
              <span className={`h-2 w-2 rounded-full bg-tertiary ${pipelineRunning ? "agent-pulse" : ""}`} />
              {pipelineRunning ? "RUNNING…" : pipelineDone ? "COMPLETE" : "IDLE"}
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
