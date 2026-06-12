"""
Build data/airline_profile.json for the fictional carrier "Pacific Wings"
(based at Sydney/SYD) from the real reference data produced by
fetch_airports.py, fetch_worldbank.py, and data/aircraft_specs.json.

For each route, this script:
  - looks up real distance (great-circle, from airports.csv)
  - assigns the smallest fleet aircraft whose range covers the route
  - computes flight duration from real cruise speed
  - attaches a macro/tourism snapshot (2019, last pre-pandemic year with
    complete World Bank data for all countries) for the destination country

Output: data/airline_profile.json
"""

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
AIRCRAFT_SPECS_PATH = ROOT / "data" / "aircraft_specs.json"
AIRPORTS_PATH = ROOT / "data" / "reference" / "airports.csv"
MACRO_PATH = ROOT / "data" / "reference" / "macro_indicators.csv"
OUTPUT_PATH = ROOT / "data" / "airline_profile.json"

# ISO alpha-2 (airports.csv) -> ISO alpha-3 (World Bank macro_indicators.csv)
COUNTRY_ALPHA2_TO_ALPHA3 = {
    "AU": "AUS",
    "SG": "SGP",
    "JP": "JPN",
    "NZ": "NZL",
    "VN": "VNM",
}

# Last pre-pandemic year with complete GDP/population/tourism data for all
# relevant countries - avoids COVID-distorted figures in the demand model.
MACRO_SNAPSHOT_YEAR = 2019

ORIGIN = "SYD"

# Pacific Wings network: existing routes + one candidate.
ROUTES = [
    {"destination": "SIN", "status": "active", "weekly_frequency": 7},
    {"destination": "NRT", "status": "active", "weekly_frequency": 5},
    {"destination": "MEL", "status": "active", "weekly_frequency": 14},
    {"destination": "AKL", "status": "active", "weekly_frequency": 7},
    {"destination": "DAD", "status": "candidate", "weekly_frequency": 0},
]


def assign_aircraft(distance_km: float, fleet: list[dict]) -> dict:
    """Smallest-capacity aircraft (by total seats) with enough range for the route."""
    capable = [ac for ac in fleet if ac["range_km"] >= distance_km]
    if not capable:
        raise ValueError(f"No aircraft in fleet has range >= {distance_km} km")
    return min(capable, key=lambda ac: ac["seats"]["total"])


def main() -> None:
    aircraft_data = json.loads(AIRCRAFT_SPECS_PATH.read_text())
    fleet = aircraft_data["aircraft"]

    airports = pd.read_csv(AIRPORTS_PATH).set_index("iata")
    macro = pd.read_csv(MACRO_PATH)
    macro_snapshot = macro[macro["year"] == MACRO_SNAPSHOT_YEAR].set_index("country")

    routes_out = []
    for route in ROUTES:
        dest = route["destination"]
        dest_airport = airports.loc[dest]
        distance_km = float(dest_airport["distance_from_syd_km"])

        aircraft = assign_aircraft(distance_km, fleet)
        flight_duration_hours = round(distance_km / aircraft["cruise_speed_kmh"], 2)

        alpha3 = COUNTRY_ALPHA2_TO_ALPHA3[dest_airport["country"]]
        macro_row = macro_snapshot.loc[alpha3]

        routes_out.append(
            {
                "origin": ORIGIN,
                "destination": dest,
                "destination_name": dest_airport["name"],
                "destination_city": dest_airport["city"],
                "destination_country": dest_airport["country"],
                "distance_km": distance_km,
                "status": route["status"],
                "weekly_frequency": route["weekly_frequency"],
                "assigned_aircraft": aircraft["type"],
                "flight_duration_hours": flight_duration_hours,
                "market": {
                    "snapshot_year": MACRO_SNAPSHOT_YEAR,
                    "gdp_usd": float(macro_row["gdp_usd"]),
                    "gdp_growth_pct": float(macro_row["gdp_growth_pct"]),
                    "population": int(macro_row["population"]),
                    "tourism_arrivals": int(macro_row["tourism_arrivals"]),
                },
            }
        )

    profile = {
        "airline": {
            "name": "Pacific Wings",
            "base": ORIGIN,
            "fleet": fleet,
        },
        "routes": routes_out,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(profile, indent=2))
    print(f"Wrote {len(routes_out)} routes to {OUTPUT_PATH}")
    for r in routes_out:
        print(
            f"  {r['origin']}-{r['destination']}: {r['distance_km']:.0f} km, "
            f"{r['assigned_aircraft']}, {r['flight_duration_hours']}h, "
            f"status={r['status']}"
        )


if __name__ == "__main__":
    main()
