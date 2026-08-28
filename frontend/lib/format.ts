// The number formatters every panel needs. There used to be nine copies of
// fmtUsd and five of fmtPax, and they had already drifted: some rendered
// $1.2B, some rendered $1200M for the same figure.

/** Compact money: $1.23B / $12.3M / $456K / $789. */
export function fmtUsd(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Exact money, grouped: $1,234,568. For side-by-side comparison tables. */
export function fmtUsdExact(v: number) {
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Compact passenger counts: 1.23M / 456K / 789. */
export function fmtPax(v: number) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

/** A 0-1 fraction as a percentage. */
export function fmtPct(v: number, digits = 1) {
  return `${(v * 100).toFixed(digits)}%`;
}

/** Prefixes a formatted delta with its sign. */
export function fmtDelta(v: number, fmt: (x: number) => string) {
  return `${v >= 0 ? "+" : ""}${fmt(v)}`;
}

/** Green up, red down, neutral flat - the same three colours everywhere. */
export function deltaClass(v: number) {
  if (v > 0) return "text-tertiary";
  if (v < 0) return "text-error";
  return "text-on-surface-variant";
}
