interface RouteCardProps {
  destination: string;
  destinationName: string;
  profitUsd: number;
  loadFactor: number;
  marketShare: number;
}

export default function RouteCard({
  destination,
  destinationName,
  profitUsd,
  loadFactor,
  marketShare,
}: RouteCardProps) {
  const profitColor = profitUsd >= 0 ? "text-tertiary" : "text-error";

  return (
    <div className="glass-panel rounded-lg p-4 transition-all hover:border-tertiary/30">
      <h3 className="text-lg font-semibold text-on-surface">SYD → {destination}</h3>
      <p className="text-sm text-on-surface-variant">{destinationName}</p>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Monthly profit
          </dt>
          <dd className={`font-medium ${profitColor}`}>
            ${profitUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Load factor
          </dt>
          <dd className="font-medium text-on-surface">{(loadFactor * 100).toFixed(1)}%</dd>
        </div>
        <div className="flex justify-between">
          <dt className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Market share
          </dt>
          <dd className="font-medium text-on-surface">{(marketShare * 100).toFixed(1)}%</dd>
        </div>
      </dl>
    </div>
  );
}
