"use client";

import Link from "next/link";
import { AGENT_DEFINITIONS } from "@/lib/constants";

interface AgentStatusPanelProps {
  llmAvailable: boolean;
}

export default function AgentStatusPanel({ llmAvailable }: AgentStatusPanelProps) {
  const onlineCount = AGENT_DEFINITIONS.filter((a) => !a.llmBacked || llmAvailable).length;
  const total = AGENT_DEFINITIONS.length;
  const circumference = 2 * Math.PI * 58;
  const offset = circumference * (1 - onlineCount / total);

  return (
    <div className="glass-panel rim-light relative flex h-full flex-col overflow-hidden rounded-2xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <span className="material-symbols-outlined text-tertiary">smart_toy</span>
        <h4 className="font-label text-[11px] font-bold uppercase tracking-[0.1em] text-on-surface">
          AI Agent Status
        </h4>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center py-4">
        <div className="relative flex h-32 w-32 items-center justify-center">
          <svg className="h-full w-full -rotate-90">
            <circle cx="64" cy="64" r="58" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
            <circle
              className="transition-all duration-1000"
              cx="64"
              cy="64"
              r="58"
              fill="none"
              stroke="#4cd7f6"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeWidth="4"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="cyan-glow-text text-3xl font-bold">{onlineCount}</span>
            <span className="font-label text-[10px] font-bold text-on-surface-variant">ONLINE</span>
          </div>
        </div>
        <p className="mt-4 text-center font-label text-[11px] leading-relaxed text-on-surface-variant">
          {onlineCount}/{total} strategy agents ready
          <br />
          {llmAvailable ? "Multi-agent sync active" : "Set GEMINI_API_KEY for AI agents"}
        </p>
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <Link
          href="/copilot"
          className="group flex items-center justify-center gap-2 text-tertiary transition-colors hover:text-tertiary/70"
        >
          <span className="font-label text-[11px] font-bold uppercase tracking-wider">Launch Copilot</span>
          <span className="material-symbols-outlined text-[16px] transition-transform group-hover:translate-x-1">
            arrow_forward
          </span>
        </Link>
      </div>
    </div>
  );
}
