"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getHealth, postChat } from "@/lib/api";
import type { ChatMessage, ChatToolCall } from "@/lib/types";
import { EXAMPLE_QUESTIONS } from "@/lib/constants";
import ChatToolResult from "@/components/ChatToolResult";
import AvailabilityNotice from "@/components/AvailabilityNotice";
import ErrorMessage from "@/components/ErrorMessage";

// ─── agent definitions ────────────────────────────────────────────────────────

const AGENTS = [
  { id: "demand",   label: "Demand",   icon: "trending_up",    desc: "Passenger & load factor forecasts",        llm: false },
  { id: "finance",  label: "Finance",  icon: "monitoring",     desc: "Revenue, cost & profit modelling",         llm: false },
  { id: "market",   label: "Market",   icon: "travel_explore", desc: "Competitor landscape & tourism trends",    llm: true  },
  { id: "risk",     label: "Risk",     icon: "shield",         desc: "Fuel, competitive & macro risk flags",     llm: true  },
  { id: "strategy", label: "Strategy", icon: "psychology",     desc: "Boardroom-ready recommendations",          llm: true  },
];

const QUICK_ACTIONS = [
  { label: "Demand forecast 2024–2027", prompt: "Forecast demand for Da Nang from 2024 to 2027", icon: "trending_up" },
  { label: "Best routes in 2026",       prompt: "Which routes will be most profitable in 2026?",  icon: "leaderboard" },
  { label: "Singapore outlook 2026",    prompt: "What will our Singapore revenue look like in 2026?", icon: "bar_chart" },
  { label: "Fastest growing route",     prompt: "Which route has the fastest demand growth trajectory from 2024 to 2027?", icon: "rocket_launch" },
  { label: "Da Nang launch case",       prompt: "Should we launch Sydney to Da Nang?",            icon: "flight_takeoff" },
  { label: "Fuel shock impact",         prompt: "What happens if fuel prices rise 25%?",           icon: "local_gas_station" },
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
      <div className="glass-panel rounded-lg px-4 py-3">
        <div className="flex items-center justify-between mb-3">
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
            return (
              <div key={agent.id} className="flex flex-col items-center gap-1.5 text-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border ${
                    online ? "border-tertiary/40 bg-tertiary/10" : "border-white/10 bg-white/5"
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-[18px] ${
                      online ? "text-tertiary" : "text-on-surface-variant/30"
                    }`}
                  >
                    {agent.icon}
                  </span>
                </div>
                <div>
                  <div
                    className={`font-label text-[10px] uppercase tracking-wide ${
                      online ? "text-primary" : "text-on-surface-variant/40"
                    }`}
                  >
                    {agent.label}
                  </div>
                  <div className="font-label text-[9px] text-on-surface-variant/50 leading-tight mt-0.5 hidden sm:block">
                    {agent.desc}
                  </div>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 font-label text-[9px] font-bold ${
                    online ? "bg-tertiary/10 text-tertiary" : "bg-white/5 text-on-surface-variant/40"
                  }`}
                >
                  {online ? (agent.llm ? "AI" : "COMPUTE") : "OFFLINE"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── quick-action predictive cards (hidden once chat starts) ── */}
      {!hasMessages && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.label}
              type="button"
              onClick={() => sendMessage(qa.prompt)}
              className="glass-panel flex items-center gap-3 rounded-lg p-3 text-left transition-all hover:border-tertiary/30 hover:bg-white/5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tertiary/10">
                <span className="material-symbols-outlined text-[16px] text-tertiary">{qa.icon}</span>
              </div>
              <span className="text-sm text-on-surface leading-tight">{qa.label}</span>
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

        {messages.map((msg, i) => (
          <div key={i} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`space-y-2 ${msg.role === "user" ? "max-w-[75%]" : "w-full"}`}>
              {msg.available === false ? (
                <AvailabilityNotice text={msg.content} />
              ) : (
                <div
                  className={
                    msg.role === "user"
                      ? "rounded-lg bg-accent-blue px-4 py-2 text-sm text-white whitespace-pre-wrap"
                      : "rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-on-surface whitespace-pre-wrap leading-relaxed"
                  }
                >
                  {msg.content}
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
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
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
          className="flex items-center gap-2 rounded bg-accent-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">send</span>
          Send
        </button>
      </form>
    </div>
  );
}
