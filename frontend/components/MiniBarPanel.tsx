interface MiniBarPanelProps {
  title: string;
  icon?: string;
  data: { label: string; value: number }[];
  /** Format applied to the tooltip value, e.g. (v) => v.toLocaleString(). */
  formatValue?: (value: number) => string;
}

export default function MiniBarPanel({ title, icon = "bar_chart", data, formatValue }: MiniBarPanelProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());

  return (
    <div className="glass-panel rounded-lg p-4">
      <h5 className="mb-4 flex items-center justify-between font-label text-[10px] uppercase tracking-widest text-primary">
        {title}
        <span className="material-symbols-outlined text-[16px]">{icon}</span>
      </h5>
      <div className="flex h-32 items-end gap-1 px-2">
        {data.map((d, i) => {
          const heightPct = Math.max((d.value / max) * 100, 4);
          const isPeak = d.value === max;
          return (
            <div
              key={i}
              className={`group relative w-full transition-colors ${
                isPeak ? "bg-tertiary/60" : "bg-white/10 hover:bg-tertiary/40"
              }`}
              style={{ height: `${heightPct}%` }}
              title={`${d.label}: ${fmt(d.value)}`}
            >
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-tertiary px-1 text-[10px] font-bold text-primary-container opacity-0 transition-opacity group-hover:opacity-100">
                {fmt(d.value)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between px-1 font-label text-[10px] text-on-surface-variant">
        {data.map((d, i) => (
          <span key={i} className={data.length > 6 && i % 2 === 1 ? "hidden sm:inline" : ""}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
