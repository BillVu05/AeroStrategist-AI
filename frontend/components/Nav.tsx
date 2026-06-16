"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/",        label: "Dashboard", icon: "dashboard"   },
  { href: "/routes",  label: "Routes",    icon: "map"         },
  { href: "/market",  label: "Market",    icon: "insights"    },
  { href: "/demand",  label: "Demand",    icon: "trending_up" },
  { href: "/revenue", label: "Revenue",   icon: "query_stats" },
  { href: "/copilot", label: "AI Agents", icon: "hub"         },
  { href: "/risk",    label: "Risk",      icon: "security"    },
  { href: "/reports", label: "Reports",   icon: "description" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-white/5 bg-[#121414] py-4 backdrop-blur-xl transition-all duration-300">
      {/* Logo */}
      <div className="mb-10 flex items-center gap-3 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-tertiary">
          <span
            className="material-symbols-outlined text-[18px] text-[#121414]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            flight_takeoff
          </span>
        </div>
        <div>
          <h1 className="text-[15px] font-bold leading-tight text-primary">AeroStrategist AI</h1>
          <p className="font-label text-[9px] uppercase tracking-tighter text-tertiary">Pacific Wings Hub</p>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 space-y-1 px-3">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-3 py-3 font-label text-[11px] tracking-wide transition-all ${
                active
                  ? "border-l-2 border-tertiary bg-white/5 text-tertiary"
                  : "border-l-2 border-transparent text-on-surface-variant/60 hover:bg-white/5 hover:text-on-surface"
              }`}
            >
              <span
                className="material-symbols-outlined text-[18px]"
                style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {link.icon}
              </span>
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* System Config */}
      <div className="mt-auto px-3">
        <Link
          href="#"
          className="flex items-center gap-3 px-3 py-3 font-label text-[11px] tracking-wide text-on-surface-variant/60 transition-all hover:bg-white/5 hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-[18px]">settings</span>
          System Config
        </Link>
      </div>
    </aside>
  );
}
