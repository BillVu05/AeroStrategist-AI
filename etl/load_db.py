"""
Load all reference, profile, and processed CSV/JSON data into the
PostgreSQL schema defined in db/schema.sql.

Requires the database to be up, e.g.:
    docker compose up -d

Connection is configured via the DATABASE_URL environment variable,
defaulting to the docker-compose service.
"""

import json
import os
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[1]

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg2://airline:airline@localhost:5432/airline_sim"
)


def load_airports(engine) -> None:
    df = pd.read_csv(ROOT / "data" / "reference" / "airports.csv")
    df = df[["iata", "name", "city", "country", "lat", "lon"]]
    df.to_sql("airports", engine, if_exists="append", index=False)
    print(f"Loaded {len(df)} airports")


def load_aircraft(engine) -> None:
    data = json.loads((ROOT / "data" / "aircraft_specs.json").read_text())
    rows = []
    for ac in data["aircraft"]:
        seats = ac["seats"]
        rows.append(
            {
                "type": ac["type"],
                "manufacturer": ac["manufacturer"],
                "seats_business": seats.get("business", 0),
                "seats_premium_economy": seats.get("premium_economy", 0),
                "seats_economy": seats.get("economy", 0),
                "seats_total": seats["total"],
                "range_km": ac["range_km"],
                "cruise_fuel_burn_kg_per_hour": ac["cruise_fuel_burn_kg_per_hour"],
                "cruise_speed_kmh": ac["cruise_speed_kmh"],
                "casm_usd": ac["casm_usd"],
            }
        )
    pd.DataFrame(rows).to_sql("aircraft", engine, if_exists="append", index=False)
    print(f"Loaded {len(rows)} aircraft types")


def load_macro_indicators(engine) -> None:
    df = pd.read_csv(ROOT / "data" / "reference" / "macro_indicators.csv")
    df.to_sql("macro_indicators", engine, if_exists="append", index=False)
    print(f"Loaded {len(df)} macro indicator rows")


def load_routes(engine) -> dict[tuple[str, str], int]:
    profile = json.loads((ROOT / "data" / "airline_profile.json").read_text())
    route_ids: dict[tuple[str, str], int] = {}
    with engine.begin() as conn:
        for route in profile["routes"]:
            result = conn.execute(
                text(
                    """
                    INSERT INTO routes (origin, destination, distance_km, aircraft_type, weekly_frequency, status)
                    VALUES (:origin, :destination, :distance_km, :aircraft_type, :weekly_frequency, :status)
                    RETURNING route_id
                    """
                ),
                {
                    "origin": route["origin"],
                    "destination": route["destination"],
                    "distance_km": route["distance_km"],
                    "aircraft_type": route["assigned_aircraft"],
                    "weekly_frequency": route["weekly_frequency"],
                    "status": route["status"],
                },
            )
            route_ids[(route["origin"], route["destination"])] = result.scalar_one()
    print(f"Loaded {len(route_ids)} routes")
    return route_ids


def load_competitors(engine, route_ids: dict[tuple[str, str], int]) -> None:
    df = pd.read_csv(ROOT / "data" / "processed" / "competitors.csv")
    df["route_id"] = df.apply(lambda r: route_ids[(r["origin"], r["destination"])], axis=1)
    df = df[["route_id", "competitor_name", "weekly_frequency", "avg_fare_usd", "rating"]]
    df.to_sql("competitors", engine, if_exists="append", index=False)
    print(f"Loaded {len(df)} competitor rows")


def load_demand_observations(engine, route_ids: dict[tuple[str, str], int]) -> None:
    df = pd.read_csv(ROOT / "data" / "processed" / "demand_observations.csv")
    df["route_id"] = df.apply(lambda r: route_ids[(r["origin"], r["destination"])], axis=1)
    df = df[["route_id", "year", "month", "passengers", "avg_fare_usd", "load_factor"]]
    df.to_sql("demand_observations", engine, if_exists="append", index=False)
    print(f"Loaded {len(df)} demand observation rows")


def main() -> None:
    engine = create_engine(DATABASE_URL)
    load_airports(engine)
    load_aircraft(engine)
    load_macro_indicators(engine)
    route_ids = load_routes(engine)
    load_competitors(engine, route_ids)
    load_demand_observations(engine, route_ids)
    print("Done.")


if __name__ == "__main__":
    main()
