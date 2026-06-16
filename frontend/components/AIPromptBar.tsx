"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EXAMPLE_QUESTIONS } from "@/lib/constants";

export default function AIPromptBar() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function go(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    router.push(`/copilot?q=${encodeURIComponent(trimmed)}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    go(value);
  }

  return (
    <section className="glass-panel-active glow-border relative overflow-hidden rounded-lg p-6">
      <div className="absolute right-0 top-0 p-4 opacity-10">
        <span className="material-symbols-outlined text-[80px]">auto_awesome</span>
      </div>
      <div className="relative z-10 max-w-3xl">
        <h3 className="mb-4 flex items-center gap-2 text-xl font-semibold text-primary">
          <span className="material-symbols-outlined text-tertiary">bolt</span>
          Ask AeroStrategist AI
        </h3>
        <form onSubmit={handleSubmit} className="relative mb-4">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Should we increase frequency on Sydney to Da Nang next quarter?"
            className="w-full rounded-lg border border-white/10 bg-black/40 px-6 py-4 text-base outline-none focus:ring-1 focus:ring-tertiary/50"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2 rounded bg-primary px-4 py-2 font-label text-xs font-medium text-on-primary transition-colors hover:bg-white disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
            EXECUTE
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Suggested:
          </span>
          {EXAMPLE_QUESTIONS.slice(0, 3).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => go(q)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-tertiary transition-colors hover:bg-tertiary/10"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
