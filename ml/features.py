"""
Shared feature engineering for the demand forecasting model.

Used by both ml/train_demand_model.py (training) and api/main.py (inference)
so the two stay in sync. Combines:
  - real per-route distance, fleet, frequency (data/airline_profile.json)
  - real per-year GDP/population (data/reference/macro_indicators.csv)
  - real-but-static 2019 tourism baseline (post-2020 World Bank tourism data
    is largely missing, so it's used as a fixed market-size feature rather
    than a per-year one)
  - synthetic-but-calibrated competitor landscape (data/processed/competitors.csv)
"""

import json
import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]

COUNTRY_ALPHA2_TO_ALPHA3 = {
    "AU": "AUS",
    "SG": "SGP",
    "JP": "JPN",
    "NZ": "NZL",
    "VN": "VNM",
}

WEEKS_PER_MONTH = 4.345
NOTIONAL_CANDIDATE_FREQUENCY = 3

# Ordered feature columns the model is trained/predicted on.
FEATURE_COLUMNS = [
    "distance_km",
    "gdp_usd",
    "gdp_growth_pct",
    "population",
    "tourism_arrivals_baseline",
    "competitor_count",
    "competitor_avg_fare_usd",
    "avg_fare_usd",
    "month_sin",
    "month_cos",
]


class ReferenceData:
    """Loads and caches all reference data needed for feature building."""

    def __init__(self) -> None:
        profile = json.loads((ROOT / "data" / "airline_profile.json").read_text())
        self.fleet_by_type = {ac["type"]: ac for ac in profile["airline"]["fleet"]}
        self.routes_by_destination = {r["destination"]: r for r in profile["routes"]}

        self.macro = pd.read_csv(ROOT / "data" / "reference" / "macro_indicators.csv")
        self.competitors = pd.read_csv(ROOT / "data" / "processed" / "competitors.csv")

        demand = pd.read_csv(ROOT / "data" / "processed" / "demand_observations.csv")
        self.avg_fare_by_destination = demand.groupby("destination")["avg_fare_usd"].mean().to_dict()

    def route(self, destination: str) -> dict:
        if destination not in self.routes_by_destination:
            raise KeyError(f"Unknown destination: {destination}")
        return self.routes_by_destination[destination]

    def capacity_monthly(
        self,
        destination: str,
        aircraft_type: str | None = None,
        weekly_frequency: float | None = None,
    ) -> float:
        route = self.route(destination)
        aircraft = self.fleet_by_type[aircraft_type or route["assigned_aircraft"]]
        if weekly_frequency is None:
            weekly_frequency = route["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY
        return aircraft["seats"]["total"] * weekly_frequency * WEEKS_PER_MONTH

    def default_avg_fare(self, destination: str) -> float:
        return float(self.avg_fare_by_destination.get(destination, 0.0))

    def _macro_row(self, destination: str, year: int) -> pd.Series:
        route = self.route(destination)
        alpha3 = COUNTRY_ALPHA2_TO_ALPHA3[route["destination_country"]]
        country_macro = self.macro[self.macro["country"] == alpha3]

        row = country_macro[country_macro["year"] == year]
        if row.empty:
            # Fall back to the most recent year with data (e.g. forecasting
            # future years beyond the macro dataset's coverage).
            row = country_macro.sort_values("year").iloc[[-1]]
        return row.iloc[0]

    def build_features(self, destination: str, year: int, month: int, avg_fare_usd: float | None = None) -> dict:
        route = self.route(destination)
        macro_row = self._macro_row(destination, year)

        comp = self.competitors[self.competitors["destination"] == destination]
        competitor_count = len(comp)
        competitor_avg_fare = float(comp["avg_fare_usd"].mean()) if not comp.empty else 0.0

        if avg_fare_usd is None:
            avg_fare_usd = self.default_avg_fare(destination)

        return {
            "distance_km": route["distance_km"],
            "gdp_usd": float(macro_row["gdp_usd"]),
            "gdp_growth_pct": float(macro_row["gdp_growth_pct"]),
            "population": float(macro_row["population"]),
            "tourism_arrivals_baseline": float(route["market"]["tourism_arrivals"]),
            "competitor_count": competitor_count,
            "competitor_avg_fare_usd": competitor_avg_fare,
            "avg_fare_usd": float(avg_fare_usd),
            "month_sin": math.sin(2 * math.pi * month / 12),
            "month_cos": math.cos(2 * math.pi * month / 12),
        }
