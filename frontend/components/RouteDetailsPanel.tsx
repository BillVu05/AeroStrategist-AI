import type { AirportInfo, RouteInfo } from "@/lib/types";

interface RouteDetailsPanelProps {
  route: RouteInfo | null;
  origin: AirportInfo;
}

export default function RouteDetailsPanel({ route, origin }: RouteDetailsPanelProps) {
  if (!route) {
    return (
      <div className="rounded border border-gray-200 bg-white p-4 text-sm text-gray-500">
        Click a route on the map to see its details.
      </div>
    );
  }

  const { market } = route;

  return (
    <div className="rounded border border-gray-200 bg-white p-4 text-sm">
      <h2 className="text-lg font-semibold text-gray-900">
        {origin.iata} → {route.destination}
      </h2>
      <p className="text-gray-600">
        {route.destination_name}, {route.destination_city}, {route.destination_country}
      </p>

      <span
        className={`mt-2 inline-block rounded px-2 py-0.5 text-xs font-medium ${
          route.status === "active"
            ? "bg-green-100 text-green-700"
            : "bg-gray-100 text-gray-600"
        }`}
      >
        {route.status === "active" ? "Active route" : "Candidate route"}
      </span>

      <dl className="mt-4 grid grid-cols-2 gap-2">
        <dt className="text-gray-500">Distance</dt>
        <dd className="text-right font-medium">{route.distance_km.toLocaleString()} km</dd>

        <dt className="text-gray-500">Flight duration</dt>
        <dd className="text-right font-medium">{route.flight_duration_hours} h</dd>

        <dt className="text-gray-500">Weekly frequency</dt>
        <dd className="text-right font-medium">{route.weekly_frequency}</dd>

        <dt className="text-gray-500">Assigned aircraft</dt>
        <dd className="text-right font-medium">{route.assigned_aircraft}</dd>
      </dl>

      <h3 className="mt-4 font-semibold text-gray-900">Market ({market.snapshot_year})</h3>
      <dl className="mt-2 grid grid-cols-2 gap-2">
        <dt className="text-gray-500">GDP</dt>
        <dd className="text-right font-medium">
          ${(market.gdp_usd / 1e9).toFixed(1)}B
        </dd>

        <dt className="text-gray-500">GDP growth</dt>
        <dd className="text-right font-medium">{market.gdp_growth_pct.toFixed(2)}%</dd>

        <dt className="text-gray-500">Population</dt>
        <dd className="text-right font-medium">{market.population.toLocaleString()}</dd>

        <dt className="text-gray-500">Tourism arrivals</dt>
        <dd className="text-right font-medium">{market.tourism_arrivals.toLocaleString()}</dd>
      </dl>
    </div>
  );
}
