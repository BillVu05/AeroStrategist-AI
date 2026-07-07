"""
Phase 5 cost model. See docs/cost_assumptions.md for full methodology.

Splits each aircraft's published CASM (cost per available-seat-km) into a
fuel component (recomputed from real fuel-burn figures and a scenario fuel
price) and a non-fuel component (held constant), so fuel price can be
varied as a what-if lever without touching the rest of the cost base.
"""

import json
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]

KG_PER_GALLON = 3.03
BASELINE_FUEL_PRICE_USD_PER_GALLON = 1.74  # 2019 EIA annual average
WEEKS_PER_MONTH = 4.345
NOTIONAL_CANDIDATE_FREQUENCY = 3

# Per-departure charges (landing fee + per-passenger airport/terminal/security
# charges + ground handling), USD per departure - real-world magnitude
# estimates: narrowbody ~$2-5k, widebody ~$10-15k per international turnaround.
# These are carved OUT of the published-CASM-derived non-fuel rate (see
# CostModel.non_fuel_unit_costs), not added on top, so the Qantas-anchored
# calibration total is preserved at each type's current network route mix -
# but short sectors now correctly cost more per seat-km than long ones, and
# frequency/aircraft what-ifs carry their real fixed-cost differences.
PER_DEPARTURE_COST_USD = {
    "A320-200": 3500.0,
    "A321neo": 5000.0,
    "B787-9": 12000.0,
}

# Indicative split of non-fuel CASM into display categories.
# See docs/cost_assumptions.md - illustrative only, does not affect totals.
NON_FUEL_COST_CATEGORY_SHARES = {
    "crew": 0.30,
    "maintenance": 0.15,
    "airport_and_atc": 0.15,
    "ownership_and_lease": 0.15,
    "ground_handling_and_catering": 0.10,
    "sales_and_overheads": 0.10,
    "insurance_and_other": 0.05,
}


def _fuel_price_usd_per_kg(usd_per_gallon: float) -> float:
    return usd_per_gallon / KG_PER_GALLON


def _fuel_casm(aircraft: dict, usd_per_gallon: float) -> float:
    fuel_cost_per_hour = aircraft["cruise_fuel_burn_kg_per_hour"] * _fuel_price_usd_per_kg(usd_per_gallon)
    ask_per_hour = aircraft["seats"]["total"] * aircraft["cruise_speed_kmh"]
    return fuel_cost_per_hour / ask_per_hour


def _non_fuel_casm(aircraft: dict) -> float:
    return aircraft["casm_usd"] - _fuel_casm(aircraft, BASELINE_FUEL_PRICE_USD_PER_GALLON)


def latest_fuel_price(year: int | None = None) -> float:
    """USD/gallon for the given year, falling back to the most recent available year."""
    df = pd.read_csv(ROOT / "data" / "reference" / "fuel_prices.csv")
    df["year"] = pd.to_datetime(df["price_date"]).dt.year
    if year is not None:
        row = df[df["year"] == year]
        if not row.empty:
            return float(row.iloc[0]["usd_per_gallon"])
    return float(df.sort_values("year").iloc[-1]["usd_per_gallon"])


class CostModel:
    def __init__(self) -> None:
        fleet = json.loads((ROOT / "data" / "aircraft_specs.json").read_text())["aircraft"]
        self.fleet_by_type = {ac["type"]: ac for ac in fleet}

        profile = json.loads((ROOT / "data" / "airline_profile.json").read_text())
        self.routes_by_destination = {r["destination"]: r for r in profile["routes"]}

        # Departures-per-ASK at each type's current ACTIVE network mix -
        # the rebate rate that keeps non_fuel_unit_costs anchor-neutral.
        deps: dict[str, float] = defaultdict(float)
        ask: dict[str, float] = defaultdict(float)
        for route in self.routes_by_destination.values():
            frequency = route["weekly_frequency"]
            if not frequency:
                continue  # candidate routes don't shape the calibration mix
            aircraft = self.fleet_by_type[route["assigned_aircraft"]]
            deps[aircraft["type"]] += frequency
            ask[aircraft["type"]] += aircraft["seats"]["total"] * route["distance_km"] * frequency
        self.departures_per_ask = {t: deps[t] / ask[t] for t in deps}

    def non_fuel_unit_costs(self, aircraft_type: str) -> tuple[float, float]:
        """(per-ASK non-fuel CASM, per-departure USD) for an aircraft type.

        The per-departure charge is subtracted from the published-CASM-derived
        non-fuel rate at the type's current network route mix, so each type's
        network non-fuel total is unchanged (the calibration anchor holds)
        while cost now scales correctly with departures vs. distance.
        """
        aircraft = self.fleet_by_type[aircraft_type]
        per_departure = PER_DEPARTURE_COST_USD.get(aircraft_type, 0.0)
        # Type not in the active network -> no rebate (slightly conservative).
        rebate_rate = self.departures_per_ask.get(aircraft_type, 0.0)
        return _non_fuel_casm(aircraft) - per_departure * rebate_rate, per_departure

    def monthly_cost(
        self,
        destination: str,
        fuel_price_usd_per_gallon: float | None = None,
        weekly_frequency: int | None = None,
        aircraft_type: str | None = None,
    ) -> dict:
        if destination not in self.routes_by_destination:
            raise KeyError(f"Unknown destination: {destination}")
        route = self.routes_by_destination[destination]
        aircraft = self.fleet_by_type[aircraft_type or route["assigned_aircraft"]]

        if fuel_price_usd_per_gallon is None:
            fuel_price_usd_per_gallon = latest_fuel_price()

        if weekly_frequency is None:
            weekly_frequency = route["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY

        ask_month = aircraft["seats"]["total"] * route["distance_km"] * weekly_frequency * WEEKS_PER_MONTH
        departures_month = weekly_frequency * WEEKS_PER_MONTH

        non_fuel_ask_casm, per_departure_usd = self.non_fuel_unit_costs(aircraft["type"])
        fuel_casm = _fuel_casm(aircraft, fuel_price_usd_per_gallon)

        fuel_cost = fuel_casm * ask_month
        non_fuel_cost = non_fuel_ask_casm * ask_month + per_departure_usd * departures_month
        total_casm = (fuel_cost + non_fuel_cost) / ask_month if ask_month > 0 else 0.0

        non_fuel_breakdown = {
            category: round(non_fuel_cost * share, 2)
            for category, share in NON_FUEL_COST_CATEGORY_SHARES.items()
        }

        return {
            "destination": destination,
            "aircraft_type": aircraft["type"],
            "weekly_frequency": weekly_frequency,
            "fuel_price_usd_per_gallon": fuel_price_usd_per_gallon,
            "ask_month": round(ask_month),
            "departures_month": round(departures_month, 1),
            "per_departure_cost_usd": per_departure_usd,
            "fuel_cost_usd": round(fuel_cost, 2),
            "non_fuel_cost_usd": round(non_fuel_cost, 2),
            "non_fuel_cost_breakdown_usd": non_fuel_breakdown,
            "total_cost_usd": round(fuel_cost + non_fuel_cost, 2),
            "total_casm_usd": round(total_casm, 5),
        }
