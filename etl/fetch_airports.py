"""
Fetch real airport reference data (codes, coordinates, country) from OurAirports'
free, public CSV dump, filter to the airports used in this simulation, and compute
real great-circle distances from Sydney (SYD) to each destination.

Output: data/reference/airports.csv
"""

import math
from pathlib import Path

import pandas as pd
import requests

OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"

# IATA codes for the airports used by Pacific Wings + candidate routes.
# HND (Haneda) not NRT (Narita) - matches real Sydney-Tokyo service today.
RELEVANT_IATA = ["SYD", "SIN", "HND", "MEL", "AKL", "DAD"]

OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "reference" / "airports.csv"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points, in kilometers."""
    r = 6371.0  # Earth radius in km
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def main() -> None:
    print(f"Downloading airport master data from {OURAIRPORTS_URL} ...")
    df = pd.read_csv(OURAIRPORTS_URL, low_memory=False)

    df = df[df["iata_code"].isin(RELEVANT_IATA)].copy()
    df = df[["iata_code", "name", "municipality", "iso_country", "latitude_deg", "longitude_deg"]]
    df = df.rename(
        columns={
            "iata_code": "iata",
            "municipality": "city",
            "iso_country": "country",
            "latitude_deg": "lat",
            "longitude_deg": "lon",
        }
    )

    missing = set(RELEVANT_IATA) - set(df["iata"])
    if missing:
        raise RuntimeError(f"Could not find airport data for: {missing}")

    syd = df[df["iata"] == "SYD"].iloc[0]
    df["distance_from_syd_km"] = df.apply(
        lambda row: round(haversine_km(syd["lat"], syd["lon"], row["lat"], row["lon"]), 1),
        axis=1,
    )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)
    print(f"Wrote {len(df)} airports to {OUTPUT_PATH}")
    print(df[["iata", "city", "country", "distance_from_syd_km"]].to_string(index=False))


if __name__ == "__main__":
    main()
