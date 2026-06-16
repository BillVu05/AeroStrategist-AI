"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AGENT_DEFINITIONS } from "@/lib/constants";

interface AgentStatusPanelProps {
  llmAvailable: boolean;
}

const ACTIVE_STATES = ["SCANNING", "CALCULATING", "POLLING", "PROCESSING", "READY"];
const IDLE_STATES = ["IDLE", "STANDBY", "READY"];

export default function AgentStatusPanel({ llmAvailable }: AgentStatusPanelProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="glass-panel flex h-full flex-col rounded-lg p-4">
      <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
        <h5 className="flex items-center gap-2 font-label text-[10px] uppercase tracking-widest text-primary">
          <span className="material-symbols-outlined text-tertiary">hub</span>
          Strategy multi-agent
        </h5>
        <div className="flex items-center gap-1.5">
          <span className="agent-pulse h-1.5 w-1.5 rounded-full bg-tertiary" />
          <span className="font-label text-[9px] uppercase tracking-widest text-tertiary">LIVE</span>
        </div>
      </div>
      <div className="relative flex-1 space-y-5">
        <div className="absolute bottom-4 left-[15px] top-4 w-px bg-gradient-to-b from-tertiary via-tertiary/20 to-tertiary opacity-30" />
        {AGENT_DEFINITIONS.map((agent, i) => {
          const online = !agent.llmBacked || llmAvailable;
          const states = online ? ACTIVE_STATES : IDLE_STATES;
          const statusLabel = online
            ? states[(tick + i) % states.length]
            : "OFFLINE";
          const isAlert = agent.id === "risk" && online && (tick + i) % 5 === 2;

          return (
            <div key={agent.id} className="group flex items-start gap-4">
              <div className="relative mt-1">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all ${
                    isAlert
                      ? "border-error/40 bg-error/10"
                      : online
                      ? "border-tertiary/40 bg-tertiary/20 agent-pulse"
                      : "border-white/20 bg-white/5"
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-[18px] ${
                      isAlert ? "text-error" : online ? "text-tertiary" : "text-on-surface-variant"
                    }`}
                  >
                    {agent.icon}
                  </span>
                </div>
              </div>
              <div className="flex-1 border-b border-white/5 pb-3 last:border-0">
                <div className="mb-1 flex items-center justify-between">
                  <h6 className="font-label text-[10px] uppercase tracking-widest text-primary">{agent.name}</h6>
                  <span
                    className={`rounded px-1.5 py-0.5 font-label text-[9px] font-bold transition-all ${
                      isAlert
                        ? "bg-error/10 text-error"
                        : online
                        ? "bg-tertiary/10 text-tertiary"
                        : "bg-white/5 text-on-surface-variant/40"
                    }`}
                  >
                    {isAlert ? "ALERT" : statusLabel}
                  </span>
                </div>
                <p className="font-label text-[10px] italic leading-tight text-on-surface-variant">
                  {online ? agent.blurb : "Set GEMINI_API_KEY to activate"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <Link
        href="/copilot"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded border border-white/10 bg-white/5 py-3 text-sm text-primary transition-all hover:bg-white/10"
      >
        <span className="material-symbols-outlined text-[18px]">forum</span>
        Open command center
      </Link>
    </div>
  );
}
