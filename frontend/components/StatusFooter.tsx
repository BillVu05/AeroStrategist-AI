"use client";

import { useEffect, useState } from "react";
import { getHealth } from "@/lib/api";

export default function StatusFooter() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    getHealth()
      .then((res) => {
        setLatencyMs(Math.round(performance.now() - start));
        setOk(res.status === "ok");
      })
      .catch(() => setOk(false));
  }, []);

  const host = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/^https?:\/\//, "");

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t border-white/5 bg-black/60 px-6 backdrop-blur-md">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 font-label text-[10px] text-on-surface-variant">
          <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-tertiary" : "bg-error"}`} />
          SYSTEM: {ok === null ? "CHECKING" : ok ? "NOMINAL" : "OFFLINE"}
        </div>
        {latencyMs !== null && (
          <div className="flex items-center gap-2 font-label text-[10px] text-on-surface-variant">
            <span className="material-symbols-outlined text-[12px]">schedule</span>
            LATENCY: {latencyMs}ms
          </div>
        )}
        <div className="flex items-center gap-2 font-label text-[10px] text-on-surface-variant">
          <span className="material-symbols-outlined text-[12px]">dns</span>
          SERVER: {host}
        </div>
      </div>
      <div className="flex items-center gap-4 font-label text-[10px] tracking-widest text-on-surface-variant">
        <span>PACIFIC WINGS · AEROSTRATEGIST AI</span>
        <span className="text-on-surface-variant/30">v2.4.8-STABLE</span>
      </div>
    </footer>
  );
}
