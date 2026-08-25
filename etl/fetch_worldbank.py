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


import pandas as pd
import requests

from pacific_wings import paths

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
OUTPUT_PATH = paths.MACRO_INDICATORS

# The World Bank's ST.INT.ARVL series stops at 2020 for every country here, so
# a fetch leaves 2021-2024 arrivals blank. Projecting tourism from the 2019
# snapshot to fill that hole compounded the 2015-19 boom straight through the
# pandemic: Japan came out at 73.8M arrivals for 2026 against a real 36.9M in
# 2024, Vietnam at 47.9M against 17.6M. These are the national tourism
# authorities' published figures (JNTO, Singapore Tourism Board, Vietnam
# National Authority of Tourism, ABS short-term visitor arrivals, Stats NZ),
# rounded to the nearest thousand, written in after the fetch.
TOURISM_BACKFILL = {
    "AUS": {2021:   245_000, 2022: 3_700_000, 2023:  6_600_000, 2024:  7_600_000},
    "JPN": {2021:   246_000, 2022: 3_832_000, 2023: 25_066_000, 2024: 36_870_000},
    "NZL": {2021:   100_000, 2022:   900_000, 2023:  2_900_000, 2024:  3_300_000},
    "SGP": {2021:   330_000, 2022: 6_310_000, 2023: 13_610_000, 2024: 16_530_000},
    "VNM": {2021:   157_000, 2022: 3_661_000, 2023: 12_600_000, 2024: 17_600_000},
}


def apply_tourism_backfill(df):
    """Fill the arrivals the World Bank has not published yet."""
    for country, years in TOURISM_BACKFILL.items():
        for year, value in years.items():
            mask = (df["country"] == country) & (df["year"] == year)
            df.loc[mask & df["tourism_arrivals"].isna(), "tourism_arrivals"] = float(value)
    return df


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
    merged = apply_tourism_backfill(merged)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(OUTPUT_PATH, index=False)
    print(f"Wrote {len(merged)} rows to {OUTPUT_PATH}")
    print(merged.tail(10).to_string(index=False))


if __name__ == "__main__":
    main()
