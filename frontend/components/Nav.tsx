"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Executive Dashboard" },
  { href: "/routes", label: "Route Explorer" },
  { href: "/simulator", label: "Scenario Simulator" },
  { href: "/copilot", label: "AI Strategy Assistant" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <span className="font-semibold text-gray-900">Pacific Wings</span>
        <div className="flex gap-4 text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                pathname === link.href
                  ? "font-medium text-blue-600"
                  : "text-gray-600 hover:text-gray-900"
              }
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
