"use client";

import { useId } from "react";

interface TrendLinePanelProps {
  title: string;
  icon: string;
  data: { label: string; value: number }[];
  formatValue?: (v: number) => string;
}

export default function TrendLinePanel({
  title,
  icon,
  data,
  formatValue = (v) => v.toLocaleString(),
}: TrendLinePanelProps) {
  const uid = useId();
  const gradientId = `tl-fill-${uid.replace(/:/g, "")}`;

  if (!data.length) return null;

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const W = 200;
  const H = 56;
  const PAD = 6;

  function px(i: number) {
    return data.length > 1 ? (i / (data.length - 1)) * W : W / 2;
  }
  function py(v: number) {
    return PAD + ((max - v) / range) * (H - 2 * PAD);
  }

  const pts = data.map((d, i) => `${px(i)},${py(d.value)}`);
  const polyline = pts.join(" ");
  const fill = `M 0,${H} L ${pts.join(" L ")} L ${W},${H} Z`;

  const current = values[values.length - 1];
  const first = values[0];
  const delta = first !== 0 ? ((current - first) / Math.abs(first)) * 100 : 0;
  const peakIdx = values.indexOf(Math.max(...values));
  const peakLabel = data[peakIdx]?.label ?? "";

  // pick a sparse subset of labels to render on the x axis
  const step = Math.max(1, Math.ceil(data.length / 6));
  const visibleLabels = data.map((d, i) => ({
    label: d.label,
    show: i % step === 0 || i === data.length - 1,
  }));

  return (
    <div className="glass-panel rounded-lg p-4">
      <div className="mb-1 flex items-center justify-between">
        <h5 className="flex items-center gap-1.5 font-label text-[10px] uppercase tracking-widest text-primary">
          <span className="material-symbols-outlined text-[14px] text-tertiary">{icon}</span>
          {title}
        </h5>
        <span className={`font-label text-[10px] font-bold ${delta >= 0 ? "text-tertiary" : "text-error"}`}>
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}%
        </span>
      </div>

      <div className="mb-2 text-xl font-bold text-on-surface">{formatValue(current)}</div>

      {/* SVG line chart */}
      <div className="relative h-14 w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4cd7f6" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#4cd7f6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fill} fill={`url(#${gradientId})`} />
          <polyline
            points={polyline}
            fill="none"
            stroke="#4cd7f6"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ filter: "drop-shadow(0 0 3px rgba(76,215,246,0.45))" }}
          />
          {pts.map((pt, i) => {
            const [x, y] = pt.split(",").map(Number);
            return (
              <circle key={i} cx={x} cy={y} r="2" fill="#4cd7f6" opacity={i === peakIdx ? 1 : 0.4} />
            );
          })}
        </svg>
      </div>

      {/* X axis labels */}
      <div className="mt-1 flex justify-between">
        {visibleLabels.map(({ label, show }, i) =>
          show ? (
            <span key={i} className="font-label text-[9px] text-on-surface-variant/40">
              {label}
            </span>
          ) : (
            <span key={i} />
          )
        )}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2">
        <span className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/40">
          Peak · {peakLabel}
        </span>
        <span className="font-label text-[9px] font-bold text-tertiary">{formatValue(Math.max(...values))}</span>
      </div>
    </div>
  );
}
