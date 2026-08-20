"""
Ground Pacific Wings' demand_observations.csv in real passenger statistics


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

The written column is `market_passengers`: the TOTAL route market, all
carriers, one-way-equivalent. It is a real observable, and it is deliberately
NOT reduced to a Pacific Wings slice here. Pacific Wings' own carried
passengers are derived at simulation time (pacific_wings/simulation/engine.py) as
market x modeled share, capped by capacity. An earlier version of this script
multiplied by an assumed new-entrant share and then capped the result at
Pacific Wings' own seat capacity - which made the training label a function
of Pacific Wings' fleet decisions, so the demand model learned the capacity
ceiling rather than a demand curve, and no strategy lever could move it.

Real-data scope and assumptions, by route:
  - SIN, HND (Tokyo), AKL: genuinely BITRE-sourced. Market = the
    Sydney<->city TotalPax for that month, halved to a one-way-equivalent
    figure (BITRE reports both directions combined; the capacity model in
    generate_synthetic_demand.py is one-directional).
  - DAD: confirmed zero real nonstop SYD-DAD service in this data (a
    suppressed 3-month blip in 2014-15, nothing since). Its candidate
    market is estimated by scaling down the real SYD-Ho Chi Minh City +
    SYD-Hanoi markets by Da Nang's share of combined city population
    (Da Nang ~1.25M vs HCMC ~9.57M + Hanoi ~8.69M, 2024 metro-area
    estimates, Macrotrends) - a deliberately rough proxy for a deliberately
    speculative route.
  - MEL: domestic - BITRE's free city-pair file is international-only and no
    real domestic source was downloaded. Left on
    generate_synthetic_demand.py's ROUTE_MONTHLY_MARKET_ANCHOR, which is
    calibrated to the published ~9.2M/yr Melbourne-Sydney total.
  - avg_fare_usd is untouched here; fare recalibration is Phase 4's job.

Usage:
    python -m etl.generate_synthetic_demand   (run first, writes the baseline)
    python -m etl.fetch_real_aviation_stats    (overwrites market_passengers)
"""

import json
from pathlib import Path

import numpy as np
import openpyxl
import pandas as pd

from etl.generate_synthetic_demand import (
    COMPETITORS_OUTPUT_PATH,
    DEMAND_OUTPUT_PATH,
    PROFILE_PATH,
    RANDOM_SEED,
    YEARS,
    build_rows,
)
from pacific_wings import paths

RAW_DIR = paths.RAW_DIR
CITYPAIRS_PATH = RAW_DIR / "bitre_international_citypairs.xlsx"
FLIGHTS_SEATS_PATH = RAW_DIR / "bitre_international_flights_seats.xlsx"

# BITRE reports by city, not airport - Sydney-Tokyo today is entirely
# Haneda-served real traffic (see Phase 1), so "Tokyo" maps to our HND route.
CITY_TO_DESTINATION = {
    "Singapore": "SIN",
    "Tokyo": "HND",
    "Auckland": "AKL",
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


def main() -> None:
    rng = np.random.default_rng(RANDOM_SEED)
    profile = json.loads(PROFILE_PATH.read_text())
    demand_rows, competitor_rows = build_rows(profile, rng)

    market = load_city_pair_market()

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

        row["market_passengers"] = round(market_pax)
        replaced += 1

    DEMAND_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(demand_rows).to_csv(DEMAND_OUTPUT_PATH, index=False)
    pd.DataFrame(competitor_rows).to_csv(COMPETITORS_OUTPUT_PATH, index=False)

    print(f"Replaced {replaced}/{len(demand_rows)} market_passengers with real BITRE figures")
    print(f"Wrote {DEMAND_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
