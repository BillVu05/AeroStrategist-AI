"""
Macro indicator projection engine for future years.

Projects GDP, population, tourism arrivals, and fuel prices forward using
mathematical models calibrated on historical data from data/reference/:
  - GDP: exponential weighted trend + mean reversion toward long-run rate
  - Population: OLS linear trend extrapolation
  - Tourism: pre-COVID structural CAGR compounded from 2019 baseline
  - Fuel price: discrete Ornstein-Uhlenbeck mean-reversion model

All outputs are deterministic point estimates (no Monte Carlo). Use the
simulation engine's scenario_kwargs for uncertainty exploration.
"""

import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]

# IMF WEO potential growth rates (%, long-run equilibrium)
LONG_RUN_GDP_GROWTH_PCT: dict[str, float] = {
    "AUS": 2.3,
    "JPN": 0.9,
    "NZL": 2.2,
    "SGP": 2.6,
    "VNM": 6.0,
}
LONG_RUN_GDP_GROWTH_DEFAULT = 2.5

# IATA income elasticity of aviation demand
AVIATION_INCOME_ELASTICITY = 1.5

# Long-run jet fuel equilibrium (USD/gallon) and O-U mean-reversion speed
LONG_RUN_FUEL_PRICE_USD = 2.50
FUEL_MEAN_REVERSION_SPEED = 0.30

# Years disrupted by COVID — excluded from structural trend fitting
_COVID_YEARS: set[int] = {2020, 2021}

# EWMA half-life for weighting recent growth rates (years)
_EWMA_SPAN = 4


def _load_macro() -> pd.DataFrame:
    return pd.read_csv(ROOT / "data" / "reference" / "macro_indicators.csv")


def _load_fuel() -> pd.DataFrame:
    df = pd.read_csv(ROOT / "data" / "reference" / "fuel_prices.csv")
    df["year"] = pd.to_datetime(df["price_date"]).dt.year
    return df.sort_values("year").reset_index(drop=True)


def _ewma(values: list[float], span: int = _EWMA_SPAN) -> float:
    """Exponential weighted mean — most-recent value has highest weight."""
    if not values:
        return 0.0
    weights = [math.exp(i / span) for i in range(len(values))]
    return sum(v * w for v, w in zip(values, weights)) / sum(weights)


def _ols_slope_intercept(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Ordinary least squares: returns (slope, intercept)."""
    n = len(xs)
    if n < 2:
        return 0.0, ys[0] if ys else 0.0
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    denom = sum((x - mean_x) ** 2 for x in xs)
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denom if denom else 0.0
    return slope, mean_y - slope * mean_x


def project_gdp(country_alpha3: str, from_year: int, to_year: int) -> dict[int, dict]:
    """
    Project GDP (USD) and growth rate for each year in [from_year, to_year].

    Blends an exponential-weighted average of historical non-COVID growth rates
    with the country's long-run equilibrium rate. The blend shifts toward
    long-run as the projection horizon lengthens (alpha = e^{-0.12 * horizon}).

    Returns: {year: {"gdp_usd": float, "gdp_growth_pct": float, "source": str}}
    """
    df = _load_macro()
    country = df[df["country"] == country_alpha3].sort_values("year")

    structural = country[~country["year"].isin(_COVID_YEARS)].dropna(subset=["gdp_growth_pct"])
    recent_rates = list(structural["gdp_growth_pct"].tail(6))
    ewma_rate = _ewma(recent_rates)
    long_run = LONG_RUN_GDP_GROWTH_PCT.get(country_alpha3, LONG_RUN_GDP_GROWTH_DEFAULT)

    latest_row = country.sort_values("year").iloc[-1]
    seed_year = int(latest_row["year"])
    seed_gdp = float(latest_row["gdp_usd"])

    result: dict[int, dict] = {}
    current_gdp = seed_gdp

    for year in range(from_year, to_year + 1):
        if year <= seed_year:
            hist = country[country["year"] == year]
            if not hist.empty:
                row = hist.iloc[0]
                current_gdp = float(row["gdp_usd"])
                result[year] = {
                    "gdp_usd": current_gdp,
                    "gdp_growth_pct": round(float(row["gdp_growth_pct"]), 4),
                    "source": "historical",
                }
                continue

        horizon = year - seed_year
        alpha = math.exp(-0.12 * horizon)
        proj_rate = alpha * ewma_rate + (1 - alpha) * long_run
        current_gdp = current_gdp * (1 + proj_rate / 100)
        result[year] = {
            "gdp_usd": round(current_gdp, 2),
            "gdp_growth_pct": round(proj_rate, 4),
            "source": "projected",
        }

    return result


def project_population(country_alpha3: str, from_year: int, to_year: int) -> dict[int, float]:
    """
    Project population using OLS linear trend fitted to the last 6 historical years.

    Returns: {year: population_float}
    """
    df = _load_macro()
    country = df[df["country"] == country_alpha3].sort_values("year").dropna(subset=["population"])

    recent = country.tail(6)
    xs = list(recent["year"].astype(float))
    ys = list(recent["population"].astype(float))
    slope, intercept = _ols_slope_intercept(xs, ys)

    latest_year = int(country.iloc[-1]["year"])
    result: dict[int, float] = {}

    for year in range(from_year, to_year + 1):
        if year <= latest_year:
            hist = country[country["year"] == year]
            if not hist.empty:
                result[year] = float(hist.iloc[0]["population"])
                continue
        result[year] = round(slope * year + intercept)

    return result


def project_tourism(
    destination_country_alpha3: str,
    snapshot_tourism: float,
    snapshot_year: int,
    from_year: int,
    to_year: int,
) -> dict[int, float]:
    """
    Project annual tourism arrivals from a 2019 baseline value.

    Structural CAGR is computed from the pre-COVID 2015-2019 period in macro
    data. Projections compound the 2019 snapshot at that rate, meaning the
    2019 value is the anchor (consistent with how the demand model uses it).

    Returns: {year: arrivals_float}
    """
    df = _load_macro()
    country = df[df["country"] == destination_country_alpha3].sort_values("year")

    pre_covid = country[
        country["year"].between(2015, 2019) & country["tourism_arrivals"].notna()
    ]

    if len(pre_covid) >= 2:
        t0, t1 = float(pre_covid.iloc[0]["tourism_arrivals"]), float(pre_covid.iloc[-1]["tourism_arrivals"])
        n_yrs = float(pre_covid.iloc[-1]["year"] - pre_covid.iloc[0]["year"])
        structural_cagr = ((t1 / t0) ** (1 / n_yrs) - 1) if t0 > 0 and n_yrs > 0 else 0.04
    else:
        structural_cagr = 0.04

    structural_cagr = max(0.01, min(0.15, structural_cagr))

    result: dict[int, float] = {}
    for year in range(from_year, to_year + 1):
        n = year - snapshot_year
        result[year] = round(snapshot_tourism * ((1 + structural_cagr) ** n))

    return result


def project_fuel_price(from_year: int, to_year: int) -> dict[int, float]:
    """
    Project annual jet fuel price (USD/gallon) using a discrete
    Ornstein-Uhlenbeck mean-reversion model:
        P[t] = P[t-1] + speed * (equilibrium - P[t-1])

    Returns: {year: price_float}
    """
    df = _load_fuel()
    seed_year = int(df.iloc[-1]["year"])
    seed_price = float(df.iloc[-1]["usd_per_gallon"])

    result: dict[int, float] = {}
    current = seed_price

    for year in range(from_year, to_year + 1):
        if year <= seed_year:
            hist = df[df["year"] == year]
            if not hist.empty:
                current = float(hist.iloc[0]["usd_per_gallon"])
                result[year] = round(current, 3)
                continue
        current = current + FUEL_MEAN_REVERSION_SPEED * (LONG_RUN_FUEL_PRICE_USD - current)
        result[year] = round(current, 3)

    return result


def project_market_size(
    country_alpha3: str,
    snapshot_tourism: float,
    snapshot_year: int,
    from_year: int,
    to_year: int,
) -> dict[int, dict]:
    """
    Composite market-size index for a bilateral route.

    Combines GDP growth (scaled by aviation income elasticity) and tourism
    growth into a demand multiplier relative to from_year:
        multiplier = 0.6 * (gdp_ratio ^ elasticity) + 0.4 * tourism_ratio

    Returns per-year dict with gdp, population, tourism, fuel price, indices,
    and the composite demand_multiplier.
    """
    gdp = project_gdp(country_alpha3, from_year, to_year)
    pop = project_population(country_alpha3, from_year, to_year)
    tourism = project_tourism(country_alpha3, snapshot_tourism, snapshot_year, from_year, to_year)
    fuel = project_fuel_price(from_year, to_year)

    base_gdp = gdp[from_year]["gdp_usd"]
    base_tourism = tourism[from_year]

    result: dict[int, dict] = {}
    for year in range(from_year, to_year + 1):
        gdp_ratio = gdp[year]["gdp_usd"] / base_gdp if base_gdp > 0 else 1.0
        tour_ratio = tourism[year] / base_tourism if base_tourism > 0 else 1.0

        demand_multiplier = (
            0.6 * (gdp_ratio ** AVIATION_INCOME_ELASTICITY) + 0.4 * tour_ratio
        )

        result[year] = {
            "gdp_usd": gdp[year]["gdp_usd"],
            "gdp_growth_pct": gdp[year]["gdp_growth_pct"],
            "gdp_index": round(gdp_ratio, 4),
            "population": pop[year],
            "tourism_arrivals": tourism[year],
            "tourism_index": round(tour_ratio, 4),
            "fuel_price_usd_per_gallon": fuel[year],
            "demand_multiplier": round(demand_multiplier, 4),
            "data_source": gdp[year]["source"],
        }

    return result
