"""
Generate synthetic-but-calibrated monthly demand observations for each
Pacific Wings route, driven by the real features in data/airline_profile.json
(distance, destination population/tourism/GDP growth) plus seasonality and
noise; and real-airline competitor data (see COMPETITORS below for sourcing).

Pacific Wings' own demand (demand_observations.csv) generated here is a
formula-driven baseline. For SIN/HND/AKL/DAD, etl/fetch_real_aviation_stats.py
(Phase 3) overwrites the passengers/load_factor columns with real
BITRE-derived figures after this script runs - SYD-MEL is domestic, has no
downloaded real source, and is left on this formula.

Outputs:
  data/processed/demand_observations.csv  (route, year, month, passengers, avg_fare_usd, load_factor)
  data/processed/competitors.csv          (route, competitor_name, weekly_frequency, avg_fare_usd, rating)
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PROFILE_PATH = ROOT / "data" / "airline_profile.json"
DEMAND_OUTPUT_PATH = ROOT / "data" / "processed" / "demand_observations.csv"
COMPETITORS_OUTPUT_PATH = ROOT / "data" / "processed" / "competitors.csv"

RANDOM_SEED = 42

# Observation window. Macro snapshot is 2019 (last pre-pandemic full year),
# used as the base year for the GDP-growth trend factor below.
YEARS = [2022, 2023, 2024]
MACRO_BASE_YEAR = 2019

# Average flight-days per month.
WEEKS_PER_MONTH = 4.345

# Candidate routes (zero current frequency) get a notional reference
# frequency so a load factor / demand level can still be estimated.
NOTIONAL_CANDIDATE_FREQUENCY = 3

# Industry-typical long-run average load factor (IATA benchmark ~75-85%).
BASE_LOAD_FACTOR = 0.80

# Monthly seasonality multipliers (Jan..Dec). "leisure" peaks around AU
# summer (Dec/Jan) and AU school holidays (Jul); "domestic" is flatter,
# reflecting steadier business travel on SYD-MEL.
SEASONALITY = {
    "leisure": [1.15, 1.08, 0.95, 0.92, 0.88, 0.95, 1.10, 1.00, 0.92, 0.90, 0.97, 1.18],
    "domestic": [1.05, 1.00, 0.98, 1.00, 1.00, 1.00, 1.05, 1.00, 0.98, 1.00, 1.00, 1.10],
}
ROUTE_SEASONALITY = {
    "SIN": "leisure",
    "HND": "leisure",
    "MEL": "domestic",
    "AKL": "leisure",
    "DAD": "leisure",
}

# Fare model: blended average fare (USD) ~ flat fee + per-km rate, with
# diminishing per-km rate on long-haul (economies of scale). Calibrated to
# rough published regional benchmark ranges (AU domestic ~$100-180,
# trans-Tasman ~$150-280, AU-Asia long-haul ~$350-650).
FARE_BASE_USD = 60.0
FARE_PER_KM_SHORT = 0.075   # applied up to 2000 km
FARE_PER_KM_LONG = 0.045    # applied beyond 2000 km
FARE_SHORT_HAUL_KM = 2000.0
FARE_ANNUAL_INFLATION = 0.03

# Demand index: scales the load factor up/down based on destination tourism
# arrivals (larger inbound tourism market => easier to fill the plane).
# tourism_arrivals is in raw headcount/year; normalize against a reference.
TOURISM_REFERENCE = 10_000_000

# Real competitors per route (name, real weekly frequency, fare multiplier
# relative to Pacific Wings' own modeled avg fare, real Skytrax World Airline
# Star Rating). Sourced June 2026:
#   - Frequencies: flight-aggregator schedules (FlightConnections/FlightsFrom/
#     Directflights) + BITRE international airline activity (data/raw/) for
#     relative carrier scale - see PLAN.md/README.md for full citations.
#   - Fare multipliers: spot-checked one-way economy fares (Google
#     Flights/Skyscanner/Kayak/Qantas/Travelocity, AUD converted at ~0.65
#     USD/AUD where noted) divided by Pacific Wings' own modeled base fare for
#     that route - indicative dynamic fares observed June 2026, not a
#     historical dataset (none exists for free at this granularity).
#   - Ratings: real Skytrax World Airline Star Rating (skytraxratings.com),
#     1-5 scale, both mainline and low-cost certifications.
COMPETITORS = {
    "SIN": [
        ("Singapore Airlines", 28, 1.60, 5),  # $647 fare / $403 base
        ("Scoot", 14, 0.42, 4),  # $168 fare / $403 base (Skytrax 4-star low-cost)
        ("Qantas", 19, 1.76, 4),  # $710 fare / $403 base
    ],
    "HND": [
        ("Qantas", 14, 1.55, 4),  # $732 fare / $472 base
        ("Japan Airlines", 7, 1.60, 5),  # no exact fare found; assumed ~JAL/ANA premium parity with Qantas
        ("All Nippon Airways", 14, 1.60, 5),
    ],
    "MEL": [
        ("Qantas", 259, 1.22, 4),  # AU$212 -> $137.80 / $113 base
        ("Virgin Australia", 189, 0.74, 4),  # AU$129 -> $83.85 / $113 base
        ("Jetstar", 126, 0.24, 3),  # AU$41 -> $26.65 / $113 base (Skytrax 3-star low-cost)
    ],
    "AKL": [
        ("Qantas", 40, 0.90, 4),  # AU$299 -> $194.35 / $217 base
        ("Air New Zealand", 30, 0.90, 4),  # no exact fare found; assumed parity with Qantas on this route
        ("Jetstar", 11, 0.60, 3),  # AU$200 -> $130 / $217 base
    ],
    # DAD: no airline flies Sydney-Da Nang nonstop today - intentionally
    # zero competitors. Closest real comparables are SYD-SGN (Qantas daily +
    # Vietnam Airlines ~daily) and SYD-HAN (Vietnam Airlines + VietJet,
    # ~3-4x/week); DAD is modeled as a speculative, currently-unserved
    # secondary-market opportunity, not a mainstream route.
    "DAD": [],
}


def build_rows(profile: dict, rng: np.random.Generator) -> tuple[list[dict], list[dict]]:
    """Build (demand_rows, competitor_rows) for every route in the profile.

    Factored out of main() so etl/fetch_real_aviation_stats.py (Phase 3) can
    reuse the fare formula and competitor data, then overwrite the
    passengers/load_factor columns with real BITRE-derived figures for the
    routes real data is available for.
    """
    demand_rows = []
    competitor_rows = []

    for route in profile["routes"]:
        dest = route["destination"]
        distance_km = route["distance_km"]
        market = route["market"]

        weekly_frequency = route["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY
        seats_total = next(
            ac["seats"]["total"]
            for ac in profile["airline"]["fleet"]
            if ac["type"] == route["assigned_aircraft"]
        )
        capacity_monthly = seats_total * weekly_frequency * WEEKS_PER_MONTH

        tourism_factor = np.clip(market["tourism_arrivals"] / TOURISM_REFERENCE, 0.3, 1.5)
        demand_index = 0.85 + 0.15 * tourism_factor  # ~0.895 to 1.075

        seasonality = SEASONALITY[ROUTE_SEASONALITY[dest]]

        if distance_km <= FARE_SHORT_HAUL_KM:
            base_fare = FARE_BASE_USD + distance_km * FARE_PER_KM_SHORT
        else:
            base_fare = (
                FARE_BASE_USD
                + FARE_SHORT_HAUL_KM * FARE_PER_KM_SHORT
                + (distance_km - FARE_SHORT_HAUL_KM) * FARE_PER_KM_LONG
            )

        for year in YEARS:
            growth_years = year - MACRO_BASE_YEAR
            # Dampened: passenger demand grows slower than headline GDP.
            trend_factor = (1 + 0.3 * market["gdp_growth_pct"] / 100) ** growth_years
            fare_inflation = (1 + FARE_ANNUAL_INFLATION) ** growth_years

            for month in range(1, 13):
                seasonal = seasonality[month - 1]
                noise = rng.normal(1.0, 0.03)

                load_factor = float(
                    np.clip(BASE_LOAD_FACTOR * demand_index * seasonal * trend_factor * noise, 0.45, 0.98)
                )
                passengers = int(round(capacity_monthly * load_factor))

                fare_noise = rng.normal(1.0, 0.04)
                avg_fare_usd = round(base_fare * fare_inflation * fare_noise, 2)

                demand_rows.append(
                    {
                        "origin": route["origin"],
                        "destination": dest,
                        "year": year,
                        "month": month,
                        "passengers": passengers,
                        "avg_fare_usd": avg_fare_usd,
                        "load_factor": round(load_factor, 4),
                    }
                )

        for name, freq, fare_mult, rating in COMPETITORS.get(dest, []):
            competitor_rows.append(
                {
                    "origin": route["origin"],
                    "destination": dest,
                    "competitor_name": name,
                    "weekly_frequency": freq,
                    "avg_fare_usd": round(base_fare * fare_mult, 2),
                    "rating": rating,
                }
            )

    return demand_rows, competitor_rows


def main() -> None:
    rng = np.random.default_rng(RANDOM_SEED)
    profile = json.loads(PROFILE_PATH.read_text())
    demand_rows, competitor_rows = build_rows(profile, rng)

    DEMAND_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(demand_rows).to_csv(DEMAND_OUTPUT_PATH, index=False)
    pd.DataFrame(competitor_rows).to_csv(COMPETITORS_OUTPUT_PATH, index=False)

    print(f"Wrote {len(demand_rows)} demand observations to {DEMAND_OUTPUT_PATH}")
    print(f"Wrote {len(competitor_rows)} competitor rows to {COMPETITORS_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
