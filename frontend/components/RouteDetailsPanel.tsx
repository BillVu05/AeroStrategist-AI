import type { AirportInfo, RouteInfo } from "@/lib/types";

interface RouteDetailsPanelProps {
  route: RouteInfo | null;
  origin: AirportInfo;
}

export default function RouteDetailsPanel({ route, origin }: RouteDetailsPanelProps) {
  if (!route) {
    return (
      <div className="glass-panel rounded-lg p-4 text-sm text-on-surface-variant">
        Click a route on the map to see its details.
      </div>
    );
  }

  const { market } = route;

  return (
    <div className="glass-panel rounded-lg p-4 text-sm">
      <h2 className="text-lg font-semibold text-on-surface">
        {origin.iata} → {route.destination}
      </h2>
      <p className="text-on-surface-variant">
        {route.destination_name}, {route.destination_city}, {route.destination_country}
      </p>

      <span
        className={`mt-2 inline-block rounded px-2 py-0.5 font-label text-[10px] uppercase tracking-widest ${
          route.status === "active"
            ? "bg-tertiary/10 text-tertiary border border-tertiary/20"
            : "bg-white/5 text-on-surface-variant border border-white/10"
        }`}
      >
        {route.status === "active" ? "Active route" : "Candidate route"}
      </span>

      <dl className="mt-4 grid grid-cols-2 gap-2">
        <dt className="text-on-surface-variant">Distance</dt>
        <dd className="text-right font-medium text-on-surface">{route.distance_km.toLocaleString()} km</dd>

        <dt className="text-on-surface-variant">Flight duration</dt>
        <dd className="text-right font-medium text-on-surface">{route.flight_duration_hours} h</dd>

        <dt className="text-on-surface-variant">Weekly frequency</dt>
        <dd className="text-right font-medium text-on-surface">{route.weekly_frequency}</dd>

        <dt className="text-on-surface-variant">Assigned aircraft</dt>
        <dd className="text-right font-medium text-on-surface">{route.assigned_aircraft}</dd>
      </dl>

      <h3 className="mt-4 font-semibold text-primary">Market ({market.snapshot_year})</h3>
      <dl className="mt-2 grid grid-cols-2 gap-2">
        <dt className="text-on-surface-variant">GDP</dt>
        <dd className="text-right font-medium text-on-surface">
          ${(market.gdp_usd / 1e9).toFixed(1)}B
        </dd>

        <dt className="text-on-surface-variant">GDP growth</dt>
        <dd className="text-right font-medium text-on-surface">{market.gdp_growth_pct.toFixed(2)}%</dd>

        <dt className="text-on-surface-variant">Population</dt>
        <dd className="text-right font-medium text-on-surface">{market.population.toLocaleString()}</dd>

        <dt className="text-on-surface-variant">Tourism arrivals</dt>
        <dd className="text-right font-medium text-on-surface">{market.tourism_arrivals.toLocaleString()}</dd>
      </dl>
    </div>
  );
}
