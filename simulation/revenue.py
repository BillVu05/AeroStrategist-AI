"""
Phase 4 revenue model. See docs/cost_assumptions.md for full methodology.

Splits a blended average fare (from the Phase 3 demand model) across cabin
classes using the assigned aircraft's real seat configuration and
calibrated fare multipliers, then adds flat per-passenger ancillary revenue.
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

ANCILLARY_REVENUE_PER_PASSENGER_USD = 25.0


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
        weighted_multiplier = sum(
            seat_shares[cabin] * multiplier for cabin, multiplier in CABIN_FARE_MULTIPLIERS.items()
        )
        base_economy_fare = avg_fare_usd / weighted_multiplier

        cabin_breakdown = {}
        ticket_revenue = 0.0
        for cabin, multiplier in CABIN_FARE_MULTIPLIERS.items():
            cabin_passengers = total_passengers * seat_shares[cabin]
            cabin_fare = base_economy_fare * multiplier
            cabin_revenue = cabin_passengers * cabin_fare
            ticket_revenue += cabin_revenue
            cabin_breakdown[cabin] = {
                "passengers": round(cabin_passengers, 1),
                "fare_usd": round(cabin_fare, 2),
                "revenue_usd": round(cabin_revenue, 2),
            }

        ancillary_revenue = total_passengers * ANCILLARY_REVENUE_PER_PASSENGER_USD

        return {
            "destination": destination,
            "total_passengers": round(total_passengers, 1),
            "avg_fare_usd": avg_fare_usd,
            "cabin_breakdown": cabin_breakdown,
            "ticket_revenue_usd": round(ticket_revenue, 2),
            "ancillary_revenue_usd": round(ancillary_revenue, 2),
            "total_revenue_usd": round(ticket_revenue + ancillary_revenue, 2),
        }
