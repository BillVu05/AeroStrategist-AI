"""
Fetch real macroeconomic and tourism indicators from the World Bank Open Data API
(free, no API key required) for the countries relevant to Pacific Wings' routes.

Indicators:
  - NY.GDP.MKTP.CD   GDP (current US$)
  - NY.GDP.MKTP.KD.ZG GDP growth (annual %)
  - SP.POP.TOTL      Population, total
  - ST.INT.ARVL      International tourism, number of arrivals

Output: data/reference/macro_indicators.csv
"""

from pathlib import Path

import pandas as pd
import requests

WB_BASE_URL = "https://api.worldbank.org/v2/country/{countries}/indicator/{indicator}"

# Countries for current + candidate Pacific Wings routes:
# Australia (home), Singapore, Japan, New Zealand, Vietnam (Da Nang).
COUNTRIES = ["AU", "SG", "JP", "NZ", "VN"]

INDICATORS = {
    "NY.GDP.MKTP.CD": "gdp_usd",
    "NY.GDP.MKTP.KD.ZG": "gdp_growth_pct",
    "SP.POP.TOTL": "population",
    "ST.INT.ARVL": "tourism_arrivals",
}

DATE_RANGE = "2010:2024"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "reference" / "macro_indicators.csv"


def fetch_indicator(indicator_code: str) -> pd.DataFrame:
    url = WB_BASE_URL.format(countries=";".join(COUNTRIES), indicator=indicator_code)
    params = {"format": "json", "date": DATE_RANGE, "per_page": 1000}
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    payload = resp.json()

    if len(payload) < 2 or payload[1] is None:
        raise RuntimeError(f"World Bank API returned no data for {indicator_code}: {payload}")

    records = []
    for row in payload[1]:
        if row["value"] is None:
            continue
        records.append(
            {
                "country": row["countryiso3code"],
                "year": int(row["date"]),
                "value": row["value"],
            }
        )
    return pd.DataFrame(records)


def main() -> None:
    merged = None
    for code, col_name in INDICATORS.items():
        print(f"Fetching {code} ({col_name}) ...")
        df = fetch_indicator(code).rename(columns={"value": col_name})
        merged = df if merged is None else merged.merge(df, on=["country", "year"], how="outer")

    merged = merged.sort_values(["country", "year"]).reset_index(drop=True)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(OUTPUT_PATH, index=False)
    print(f"Wrote {len(merged)} rows to {OUTPUT_PATH}")
    print(merged.tail(10).to_string(index=False))


if __name__ == "__main__":
    main()
