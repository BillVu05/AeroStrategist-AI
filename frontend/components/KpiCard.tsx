interface KpiCardProps {
  icon: string;
  label: string;
  value: string;
  /** Pre-formatted delta badge text, e.g. "+12.4%" or "OPTIMAL". */
  delta?: string;
  /** Color class for the delta badge. Defaults to tertiary (positive). */
  deltaClass?: string;
}

export default function KpiCard({ icon, label, value, delta, deltaClass }: KpiCardProps) {
  return (
    <div className="glass-panel group flex flex-col justify-between rounded-lg p-4 transition-all hover:border-tertiary/30">
      <div className="flex items-start justify-between">
        <span className="material-symbols-outlined text-[20px] text-on-surface-variant">{icon}</span>
        {delta && (
          <span className={`font-label text-[10px] ${deltaClass ?? "text-tertiary"}`}>{delta}</span>
        )}
      </div>
      <div className="mt-4">
        <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">{label}</p>
        <h4 className="text-2xl font-semibold text-primary">{value}</h4>
      </div>
    </div>
  );
}
