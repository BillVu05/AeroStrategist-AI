"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getHealth, postChat } from "@/lib/api";
import type { ChatMessage, ChatToolCall } from "@/lib/types";
import { EXAMPLE_QUESTIONS } from "@/lib/constants";
import ChatToolResult from "@/components/ChatToolResult";
import AvailabilityNotice from "@/components/AvailabilityNotice";
import ErrorMessage from "@/components/ErrorMessage";

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

// ─── agent definitions ────────────────────────────────────────────────────────

const AGENTS = [
  { id: "demand",   label: "Demand",   icon: "trending_up",    desc: "Passenger & load factor forecasts",        llm: false },
  { id: "finance",  label: "Finance",  icon: "monitoring",     desc: "Revenue, cost & profit modelling",         llm: false },
  { id: "market",   label: "Market",   icon: "travel_explore", desc: "Competitor landscape & tourism trends",    llm: true  },
  { id: "risk",     label: "Risk",     icon: "shield",         desc: "Fuel, competitive & macro risk flags",     llm: true  },
  { id: "strategy", label: "Strategy", icon: "psychology",     desc: "Boardroom-ready recommendations",          llm: true  },
];

const QUICK_ACTIONS = [
  { category: "DEMAND",       label: "Forecast demand 2024–2027",  prompt: "Forecast demand for Da Nang from 2024 to 2027" },
  { category: "PROFITABILITY", label: "Best routes in 2026",       prompt: "Which routes will be most profitable in 2026?" },
  { category: "REVENUE",      label: "Singapore outlook 2026",     prompt: "What will our Singapore revenue look like in 2026?" },
  { category: "GROWTH",       label: "Fastest growing route",      prompt: "Which route has the fastest demand growth trajectory from 2024 to 2027?" },
  { category: "EXPANSION",    label: "Da Nang launch case",        prompt: "Should we launch Sydney to Da Nang?" },
  { category: "SCENARIO",     label: "Fuel shock impact",          prompt: "What happens if fuel prices rise 25%?" },
];

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

  useEffect(() => {
    getHealth().then((h) => setLlmAvailable(h.llm_available)).catch(() => setLlmAvailable(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

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

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-4">

      {/* ── agent status bar ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="agent-pulse h-2 w-2 rounded-full bg-tertiary" />
          <h2 className="font-label text-[10px] uppercase tracking-widest text-primary">
            Multi-Agent Command Center
          </h2>
        </div>
        {llmAvailable !== null && (
          <span
            className={`rounded border px-2 py-0.5 font-label text-[10px] ${
              llmAvailable
                ? "border-tertiary/20 bg-tertiary/10 text-tertiary"
                : "border-white/10 bg-white/5 text-on-surface-variant"
            }`}
          >
            {llmAvailable ? "AI ONLINE" : "AI OFFLINE · Set GEMINI_API_KEY"}
          </span>
        )}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {AGENTS.map((agent) => {
          const online = !agent.llm || llmAvailable === true;
          const status = online ? (agent.llm ? "AI" : "COMPUTE") : "OFFLINE";
          return (
            <div
              key={agent.id}
              className={`flex items-center justify-between gap-2 rounded p-3 ${
                online ? "glass-panel-active" : "glass-panel"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`material-symbols-outlined text-[20px] ${
                    online ? "text-tertiary" : "text-on-surface-variant/40"
                  }`}
                >
                  {agent.icon}
                </span>
                <div>
                  <p className={`font-label text-[11px] ${online ? "text-on-surface" : "text-on-surface-variant/40"}`}>
                    {agent.label}
                  </p>
                  <p className={`font-label text-[10px] ${online ? "text-tertiary" : "text-on-surface-variant/40"}`}>
                    {status}
                  </p>
                </div>
              </div>
              {online && <span className="agent-pulse h-2 w-2 shrink-0 rounded-full bg-tertiary" />}
            </div>
          );
        })}
      </div>

      {/* ── quick-action predictive cards (hidden once chat starts) ── */}
      {!hasMessages && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.label}
              type="button"
              onClick={() => sendMessage(qa.prompt)}
              className="glass-panel rounded p-3 text-left transition-all hover:bg-white/5"
            >
              <p className="mb-1 font-label text-[10px] text-tertiary">{qa.category}</p>
              <p className="text-sm leading-tight text-on-surface">{qa.label}</p>
            </button>
          ))}
        </div>
      )}

      {/* ── chat messages ── */}
      <div className="glass-panel flex-1 overflow-y-auto rounded-lg p-4 space-y-4">
        {!hasMessages && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
            <span className="material-symbols-outlined text-[40px] text-tertiary/30">forum</span>
            <div>
              <p className="text-sm text-on-surface-variant">
                Ask about routes, fares, capacity, fuel, competitors, or request a multi-year forecast.
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
                  <div className="rounded-xl rounded-tr-none bg-secondary-container px-4 py-2 text-sm text-white whitespace-pre-wrap shadow-lg">
                    {msg.content}
                  </div>
                ) : (
                  <div className="rounded-xl rounded-tl-none border border-white/5 bg-white/5 px-4 py-3 text-sm text-on-surface leading-relaxed">
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

        <div ref={bottomRef} />
      </div>

      {error && <ErrorMessage message={error} />}

      {/* ── input ── */}
      <form
        onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
        className="flex gap-2"
      >
        <button
          type="button"
          title="Voice input (coming soon)"
          className="flex shrink-0 items-center justify-center rounded border border-white/10 bg-white/5 px-3 py-2.5 transition-colors hover:bg-white/10"
        >
          <span className="material-symbols-outlined text-[18px] text-on-surface-variant">mic</span>
        </button>
        <label
          title="Attach file"
          className="flex shrink-0 cursor-pointer items-center justify-center rounded border border-white/10 bg-white/5 px-3 py-2.5 transition-colors hover:bg-white/10"
        >
          <input type="file" className="sr-only" />
          <span className="material-symbols-outlined text-[18px] text-on-surface-variant">attach_file</span>
        </label>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about demand, revenue, future forecasts, or a strategy decision…"
          className="flex-1 rounded border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:border-tertiary focus:outline-none transition-colors"
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
  );
}
