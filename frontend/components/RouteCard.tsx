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
  const profitColor = profitUsd >= 0 ? "text-green-600" : "text-red-600";

  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <h3 className="text-lg font-semibold text-gray-900">SYD → {destination}</h3>
      <p className="text-sm text-gray-500">{destinationName}</p>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500">Monthly profit</dt>
          <dd className={`font-medium ${profitColor}`}>
            ${profitUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Load factor</dt>
          <dd className="font-medium text-gray-900">{(loadFactor * 100).toFixed(1)}%</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Market share</dt>
          <dd className="font-medium text-gray-900">{(marketShare * 100).toFixed(1)}%</dd>
        </div>
      </dl>
    </div>
  );
}
