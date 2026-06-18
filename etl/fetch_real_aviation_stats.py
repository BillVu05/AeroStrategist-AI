"""
Ground Pacific Wings' demand_observations.csv in real passenger statistics
(Phase 3 of the real-data rebuild - see PLAN.md).

Parses two BITRE (Bureau of Infrastructure and Transport Research Economics)
spreadsheets that must be manually downloaded into data/raw/ first (large,
re-downloadable government files - gitignored):
  - bitre_international_citypairs.xlsx    Sydney<->foreign-city monthly
    passengers, 2009-2026 (BITRE "International Scheduled Air Transport"
    Table 5, https://www.bitre.gov.au/publications/ongoing/international_airline_activity)
  - bitre_international_flights_seats.xlsx  Australia<->country monthly
    flights/seats/passengers by airline, 1991-2026 (same BITRE series)

Direct programmatic download (data.gov.au's CKAN API, BITRE's own site)
returned HTTP 403 for both during research, so this script assumes the
files already exist locally rather than fetching them itself.

Real-data scope and assumptions, by route:
  - SIN, HND (Tokyo), AKL: genuinely BITRE-sourced. Total market = the
    Sydney<->city TotalPax for that month, halved to a one-way-equivalent
    figure (BITRE reports both directions combined; the existing capacity
    model in generate_synthetic_demand.py is one-directional). A demand-
    implied passenger count = total market x an assumed new-entrant market
    share (Pacific Wings is fictional, so this slice is necessarily an
    assumption - reuses the same heuristic agents/open_route_analyst.py
    applies to hypothetical new routes). That figure is then capped at
    Pacific Wings' own monthly seat capacity x the real BITRE
    Australia<->country seat utilisation rate (pax / seats, all reporting
    airlines, that month) - a country-wide, not Sydney-specific, load
    factor proxy (the free city-pair file has no seats column), used here
    as a realistic sell-out ceiling rather than a literal reported value.
    Reported load_factor is always passengers / capacity, so the two stay
    internally consistent. In practice the cap binds for SIN and AKL - the
    real bilateral markets on those corridors are large enough that a ~10%
    share alone would exceed Pacific Wings' modeled weekly frequency.
  - DAD: confirmed zero real nonstop SYD-DAD service in this data (a
    suppressed 3-month blip in 2014-15, nothing since). Its candidate
    market is estimated by scaling down the real SYD-Ho Chi Minh City +
    SYD-Hanoi markets by Da Nang's share of combined city population
    (Da Nang ~1.25M vs HCMC ~9.57M + Hanoi ~8.69M, 2024 metro-area
    estimates, Macrotrends) - a deliberately rough proxy for a deliberately
    speculative route. Its load_factor uses the same Vietnam-country BITRE
    utilisation rate as the SGN/HAN reference routes.
  - MEL: domestic - BITRE's free city-pair file is international-only and
    no real domestic source was downloaded (see PLAN.md). Left untouched on
    generate_synthetic_demand.py's formula.
  - avg_fare_usd is untouched here; fare recalibration is Phase 4's job.

Usage:
    python etl/generate_synthetic_demand.py   (run first, writes the baseline)
    python etl/fetch_real_aviation_stats.py    (overwrites passengers/load_factor)
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import openpyxl
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_synthetic_demand import (  # noqa: E402
    BASE_LOAD_FACTOR,
    COMPETITORS,
    DEMAND_OUTPUT_PATH,
    COMPETITORS_OUTPUT_PATH,
    NOTIONAL_CANDIDATE_FREQUENCY,
    PROFILE_PATH,
    RANDOM_SEED,
    WEEKS_PER_MONTH,
    YEARS,
    build_rows,
)

RAW_DIR = ROOT / "data" / "raw"
CITYPAIRS_PATH = RAW_DIR / "bitre_international_citypairs.xlsx"
FLIGHTS_SEATS_PATH = RAW_DIR / "bitre_international_flights_seats.xlsx"

# BITRE reports by city, not airport - Sydney-Tokyo today is entirely
# Haneda-served real traffic (see Phase 1), so "Tokyo" maps to our HND route.
CITY_TO_DESTINATION = {
    "Singapore": "SIN",
    "Tokyo": "HND",
    "Auckland": "AKL",
}
DESTINATION_COUNTRY = {
    "SIN": "Singapore",
    "HND": "Japan",
    "AKL": "New Zealand",
    "DAD": "Vietnam",
}

# DAD has no real nonstop service; scale its candidate market down from the
# real SYD-Ho Chi Minh City + SYD-Hanoi markets by relative city population.
DAD_REFERENCE_CITIES = ["Ho Chi Minh City", "Hanoi"]
DAD_POPULATION_M = 1.253
DAD_REFERENCE_POPULATION_M = 9.568 + 8.690  # HCMC + Hanoi


def _iter_data_rows(path: Path, min_row: int):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        yield from wb["Data"].iter_rows(min_row=min_row, values_only=True)
    finally:
        wb.close()


def load_city_pair_market() -> dict[tuple[str, int, int], float]:
    """(foreign_city, year, month) -> one-way-equivalent monthly passengers."""
    cities = set(CITY_TO_DESTINATION) | set(DAD_REFERENCE_CITIES)
    market: dict[tuple[str, int, int], float] = {}
    for row in _iter_data_rows(CITYPAIRS_PATH, min_row=2):
        month = row[0]
        if month is None or month.year not in YEARS:
            continue
        aus_port, foreign_port, total_pax = row[1], row[2], row[10]
        if aus_port != "Sydney" or foreign_port not in cities:
            continue
        if not isinstance(total_pax, (int, float)):
            continue  # suppressed ('..') - e.g. DAD's defunct 2014-15 blip
        market[(foreign_port, month.year, month.month)] = total_pax / 2
    return market


def load_country_load_factor() -> dict[tuple[str, int, int], float]:
    """(country, year, month) -> seat utilisation, all reporting airlines, Australia-wide."""
    countries = set(DESTINATION_COUNTRY.values())
    pax_seats: dict[tuple[str, int, int], list[float]] = defaultdict(lambda: [0.0, 0.0])
    for row in _iter_data_rows(FLIGHTS_SEATS_PATH, min_row=6):
        month = row[0]
        if month is None or month.year not in YEARS:
            continue
        country = row[2]
        if country not in countries:
            continue
        key = (country, month.year, month.month)
        pax_in, seats_in, pax_out, seats_out = row[4], row[5], row[7], row[8]
        for value, slot in ((pax_in, 0), (pax_out, 0), (seats_in, 1), (seats_out, 1)):
            if isinstance(value, (int, float)):
                pax_seats[key][slot] += value

    return {key: pax / seats for key, (pax, seats) in pax_seats.items() if seats > 0}


def _new_entrant_share(n_existing_carriers: int, weekly_frequency: float) -> float:
    """Mirrors agents/open_route_analyst.py's _new_entrant_share heuristic:
    a new entrant typically captures ~20% of a market divided among existing
    carriers, plus a modest boost for higher own frequency, capped at 40%."""
    base = 0.20 / max(1, n_existing_carriers)
    frequency_boost = min(weekly_frequency / 14, 1.0) * 0.08
    return min(base + frequency_boost, 0.40)


def main() -> None:
    rng = np.random.default_rng(RANDOM_SEED)
    profile = json.loads(PROFILE_PATH.read_text())
    routes_by_destination = {r["destination"]: r for r in profile["routes"]}
    fleet_by_type = {ac["type"]: ac for ac in profile["airline"]["fleet"]}
    demand_rows, competitor_rows = build_rows(profile, rng)

    market = load_city_pair_market()
    load_factor_by_key = load_country_load_factor()

    capacity_by_dest = {}
    for dest, route in routes_by_destination.items():
        seats_total = fleet_by_type[route["assigned_aircraft"]]["seats"]["total"]
        weekly_frequency = route["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY
        capacity_by_dest[dest] = seats_total * weekly_frequency * WEEKS_PER_MONTH

    replaced = 0
    for row in demand_rows:
        dest, year, month = row["destination"], row["year"], row["month"]

        if dest in CITY_TO_DESTINATION.values():
            city = next(c for c, d in CITY_TO_DESTINATION.items() if d == dest)
            market_pax = market.get((city, year, month))
            if market_pax is None:
                continue
        elif dest == "DAD":
            ref_total = sum(market.get((c, year, month), 0.0) for c in DAD_REFERENCE_CITIES)
            if ref_total == 0:
                continue
            market_pax = ref_total * (DAD_POPULATION_M / DAD_REFERENCE_POPULATION_M)
        else:
            continue  # MEL: domestic, no real source available (see module docstring)

        weekly_frequency = routes_by_destination[dest]["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY
        n_competitors = len(COMPETITORS.get(dest, []))
        share = _new_entrant_share(n_competitors, weekly_frequency)
        demand_implied_pax = market_pax * share

        real_load_factor = load_factor_by_key.get(
            (DESTINATION_COUNTRY[dest], year, month), BASE_LOAD_FACTOR
        )
        capacity_monthly = capacity_by_dest[dest]
        passengers = min(demand_implied_pax, capacity_monthly * real_load_factor)

        row["passengers"] = round(passengers)
        row["load_factor"] = round(passengers / capacity_monthly, 4)
        replaced += 1

    DEMAND_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(demand_rows).to_csv(DEMAND_OUTPUT_PATH, index=False)
    pd.DataFrame(competitor_rows).to_csv(COMPETITORS_OUTPUT_PATH, index=False)

    print(f"Replaced {replaced}/{len(demand_rows)} demand rows with real BITRE-derived figures")
    print(f"Wrote {DEMAND_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
