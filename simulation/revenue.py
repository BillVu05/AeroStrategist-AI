"""
Phase 4 revenue model. See docs/cost_assumptions.md for full methodology.

The route's `avg_fare_usd` is on an ECONOMY-fare scale: the fare formula
behind demand_observations.csv was calibrated against economy benchmark
ranges, and competitors.csv multipliers were derived from real spot-checked
economy fares divided by that same base (etl/generate_synthetic_demand.py).
Cabin fares therefore scale UP from it using the aircraft's real seat mix,
calibrated fare multipliers, and cabin fill weights (premium cabins fill
less than economy) - the realized blended average per passenger is reported
as blended_avg_fare_usd. (An earlier version divided the fare down as if it
were already blended, under-pricing premium cabins and understating revenue
by ~18-46% depending on aircraft.)
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Fare multiples vs. economy. See docs/cost_assumptions.md.
CABIN_FARE_MULTIPLIERS = {
    "economy": 1.0,
    "premium_economy": 1.6,
    "business": 3.2,
}

# Premium cabins sell fewer of their seats than economy does (industry-wide,
# business runs ~70-75% load factor vs economy ~85%+). Passengers are
# allocated to cabins by seat share x these weights (renormalized), instead
# of assuming every cabin fills evenly.
CABIN_FILL_WEIGHTS = {
    "economy": 1.0,
    "premium_economy": 0.85,
    "business": 0.7,
}


def ancillary_per_pax_usd(distance_km: float) -> float:
    """Ancillary revenue per passenger scales with journey length (bags, seat
    selection, onboard sales): $15 base + 0.2c/km capped at 10,000 km, i.e.
    ~$16 domestic, ~$28 medium-haul, $35 long-haul - within the $15-35/pax
    range cited for full-service international carriers."""
    return 15.0 + 0.002 * min(distance_km, 10_000.0)


class RevenueModel:
    def __init__(self) -> None:
        fleet = json.loads((ROOT / "data" / "aircraft_specs.json").read_text())["aircraft"]
        self.fleet_by_type = {ac["type"]: ac for ac in fleet}

        profile = json.loads((ROOT / "data" / "airline_profile.json").read_text())
        self.routes_by_destination = {r["destination"]: r for r in profile["routes"]}

    def _seat_shares(self, aircraft: dict) -> dict[str, float]:
        seats = aircraft["seats"]
        total = seats["total"]
        return {
            cabin: seats.get(cabin, 0) / total
            for cabin in CABIN_FARE_MULTIPLIERS
        }

    def monthly_revenue(
        self,
        destination: str,
        total_passengers: float,
        avg_fare_usd: float,
        aircraft_type: str | None = None,
    ) -> dict:
        if destination not in self.routes_by_destination:
            raise KeyError(f"Unknown destination: {destination}")
        route = self.routes_by_destination[destination]
        aircraft = self.fleet_by_type[aircraft_type or route["assigned_aircraft"]]

        seat_shares = self._seat_shares(aircraft)
        fill = {c: seat_shares[c] * CABIN_FILL_WEIGHTS[c] for c in CABIN_FARE_MULTIPLIERS}
        total_fill = sum(fill.values()) or 1.0

        cabin_breakdown = {}
        ticket_revenue = 0.0
        for cabin, multiplier in CABIN_FARE_MULTIPLIERS.items():
            cabin_passengers = total_passengers * fill[cabin] / total_fill
            cabin_fare = avg_fare_usd * multiplier
            cabin_revenue = cabin_passengers * cabin_fare
            ticket_revenue += cabin_revenue
            cabin_breakdown[cabin] = {
                "passengers": round(cabin_passengers, 1),
                "fare_usd": round(cabin_fare, 2),
                "revenue_usd": round(cabin_revenue, 2),
            }

        ancillary_revenue = total_passengers * ancillary_per_pax_usd(route["distance_km"])

        return {
            "destination": destination,
            "total_passengers": round(total_passengers, 1),
            "avg_fare_usd": avg_fare_usd,
            "blended_avg_fare_usd": round(ticket_revenue / total_passengers, 2)
            if total_passengers > 0
            else 0.0,
            "cabin_breakdown": cabin_breakdown,
            "ticket_revenue_usd": round(ticket_revenue, 2),
            "ancillary_revenue_usd": round(ancillary_revenue, 2),
            "total_revenue_usd": round(ticket_revenue + ancillary_revenue, 2),
        }


if __name__ == "__main__":
    # Self-check: cabin split must sum to pax x blended fare, and the blended
    # average must sit ABOVE the economy-level input fare (premium uplift).
    m = RevenueModel()
    r = m.monthly_revenue("SIN", 1000, 400.0)
    assert abs(r["ticket_revenue_usd"] - 1000 * r["blended_avg_fare_usd"]) < 10.0, r  # 1c/pax rounding
    assert r["blended_avg_fare_usd"] > 400.0, r
    assert r["cabin_breakdown"]["economy"]["fare_usd"] == 400.0, r
    print("revenue self-check OK")
