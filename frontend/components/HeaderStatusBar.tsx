"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const PAGE_TITLES: Record<string, string> = {
  "/":             "Executive Intelligence",
  "/routes":       "Route Explorer",
  "/market":       "Market & Demand",
  "/scenario-lab": "Scenario Lab",
  "/copilot":      "AI Strategy Copilot",
  "/reports":      "Report Library",
};

export default function HeaderStatusBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const title =
    PAGE_TITLES[pathname] ??
    (pathname.startsWith("/reports/") ? "Report Preview" : "AeroStrategist AI");

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) {
      router.push(`/copilot?q=${encodeURIComponent(q)}`);
      setQuery("");
    }
  }

  return (
    <header className="z-40 flex h-16 shrink-0 items-center justify-between border-b border-white/5 bg-[#121414]/80 px-6 backdrop-blur-md">
      {/* Left: page title + search */}
      <div className="flex flex-1 items-center gap-6">
        <h2 className="whitespace-nowrap text-[15px] font-bold leading-tight text-primary">{title}</h2>
        <form onSubmit={handleSearch} className="relative w-full max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant">
            search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search strategy nodes…"
            className="w-full rounded border border-white/10 bg-white/5 py-2 pl-10 pr-4 text-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none transition-colors focus:border-tertiary"
          />
        </form>
      </div>

      {/* Right: network status + bell + user pill */}
      <div className="flex items-center gap-4">
        <div className="mr-2 flex flex-col items-end">
          <span className="font-label text-[10px] text-tertiary">NETWORK LIVE</span>
          <span className="font-label text-[10px] text-on-surface-variant/40">SYD TERMINAL 1</span>
        </div>
        {/* There was a notification bell here with a permanent unread dot and
            no handler, and this user pill was a button that did nothing. There
            is no notification feed and no account screen, so the bell is gone
            and the pill is a label. */}
        <div className="flex items-center gap-2 rounded border border-white/10 bg-white/5 py-1 pl-2 pr-1">
          <span className="font-label px-1 text-[11px] text-on-surface">C. MILTON</span>
          <div className="flex h-8 w-8 items-center justify-center rounded bg-accent-blue">
            <span
              className="material-symbols-outlined text-[20px] text-white"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              person
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
