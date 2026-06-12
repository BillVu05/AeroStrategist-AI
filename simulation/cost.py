"""
Phase 5 cost model. See docs/cost_assumptions.md for full methodology.

Splits each aircraft's published CASM (cost per available-seat-km) into a
fuel component (recomputed from real fuel-burn figures and a scenario fuel
price) and a non-fuel component (held constant), so fuel price can be
varied as a what-if lever without touching the rest of the cost base.
"""

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]

KG_PER_GALLON = 3.03
BASELINE_FUEL_PRICE_USD_PER_GALLON = 1.74  # 2019 EIA annual average
WEEKS_PER_MONTH = 4.345
NOTIONAL_CANDIDATE_FREQUENCY = 3

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

        non_fuel_casm = _non_fuel_casm(aircraft)
        fuel_casm = _fuel_casm(aircraft, fuel_price_usd_per_gallon)
        total_casm = non_fuel_casm + fuel_casm

        fuel_cost = fuel_casm * ask_month
        non_fuel_cost = non_fuel_casm * ask_month

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
            "fuel_cost_usd": round(fuel_cost, 2),
            "non_fuel_cost_usd": round(non_fuel_cost, 2),
            "non_fuel_cost_breakdown_usd": non_fuel_breakdown,
            "total_cost_usd": round(fuel_cost + non_fuel_cost, 2),
            "total_casm_usd": round(total_casm, 5),
        }
