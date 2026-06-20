"use client";

import Link from "next/link";
import { AGENT_DEFINITIONS } from "@/lib/constants";

interface AgentStatusPanelProps {
  llmAvailable: boolean;
}

export default function AgentStatusPanel({ llmAvailable }: AgentStatusPanelProps) {
  const onlineCount = AGENT_DEFINITIONS.filter((a) => !a.llmBacked || llmAvailable).length;

  return (
    <div className="glass-panel flex h-full flex-col rounded-lg p-4">
      <h5 className="mb-4 flex items-center gap-2 border-b border-white/5 pb-4 font-label text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
        <span className="material-symbols-outlined text-sm text-tertiary">hub</span>
        AI Agent Status
      </h5>

      <div className="flex-1 space-y-6">
        {AGENT_DEFINITIONS.map((agent) => {
          const online = !agent.llmBacked || llmAvailable;
          const badge = online ? (agent.llmBacked ? "AI" : "COMPUTE") : "OFFLINE";
          return (
            <div key={agent.id} className="group flex items-center gap-4">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded border transition-colors ${
                  online ? "border-tertiary/20 bg-tertiary/10" : "border-white/10 bg-white/5"
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[18px] ${
                    online ? "text-tertiary" : "text-on-surface-variant/40"
                  }`}
                >
                  {agent.icon}
                </span>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-label text-[11px] text-primary">{agent.name}</span>
                  <span
                    className={`rounded px-1 font-label text-[8px] font-bold tracking-tighter ${
                      online ? "bg-tertiary/10 text-tertiary" : "bg-white/5 text-on-surface-variant/40"
                    }`}
                  >
                    {badge}
                  </span>
                </div>
                <p className="mt-1 font-label text-[9px] leading-none text-on-surface-variant/60">
                  {online ? agent.blurb : "Set GEMINI_API_KEY to activate"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-auto space-y-4">
        <div className="rounded border border-white/5 bg-tertiary/5 p-4">
          <p className="mb-2 font-label text-[10px] font-bold uppercase tracking-widest text-tertiary">
            Network Health
          </p>
          <div className="flex gap-1.5">
            {AGENT_DEFINITIONS.map((agent, i) => (
              <div
                key={agent.id}
                className={`h-1 flex-1 rounded-full ${i < onlineCount ? "bg-tertiary" : "bg-white/10"}`}
              />
            ))}
          </div>
          <p className="mt-2 font-label text-[9px] text-on-surface-variant/50">
            {onlineCount}/{AGENT_DEFINITIONS.length} agents online
          </p>
        </div>

        <Link
          href="/copilot?q=Optimize+fleet+allocation+across+the+Pacific+Wings+network"
          className="group flex w-full items-center justify-center gap-2 rounded border border-white/10 bg-white/5 py-3 font-label text-xs font-bold uppercase tracking-widest text-primary transition-all hover:bg-tertiary hover:text-on-tertiary"
        >
          <span className="material-symbols-outlined text-[18px] transition-transform group-hover:rotate-180">
            auto_awesome
          </span>
          Optimize Fleet
        </Link>
      </div>
    </div>
  );
}
