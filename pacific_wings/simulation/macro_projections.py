"""
Macro indicator projection engine for future years.

Projects GDP, population, tourism arrivals, and fuel prices forward using
mathematical models calibrated on historical data from data/reference/:
  - GDP: exponential weighted trend + mean reversion toward long-run rate
  - Population: OLS linear trend extrapolation
  - Tourism: latest observed arrivals, grown at a structural CAGR that
    decays toward a long-run rate
  - Fuel price: discrete Ornstein-Uhlenbeck mean-reversion model

All outputs are deterministic point estimates (no Monte Carlo). Use the
simulation engine's scenario_kwargs for uncertainty exploration.

The demand_multiplier produced here is what SimulationEngine applies to
passenger predictions beyond the model's training window (tree models can't
extrapolate — see engine.py). Sources for the constants:
  - Long-run GDP growth: IMF World Economic Outlook potential-growth
    estimates per country (https://www.imf.org/en/publications/weo).
  - Income elasticity 1.5: IATA economics briefing "Air Travel Demand"
    (long-haul / developing-market elasticity range 1.2-2.0).
  - Tourism CAGR: World Bank/UNWTO arrivals data in
    data/reference/macro_indicators.csv, pre-COVID 2015-2019 structural
    trend, clamped to [1%, 15%].
  - Sanity check: IATA reported Asia-Pacific international traffic +10.9%
    in 2025, the fastest of any region
    (https://www.iata.org/en/pressroom/2026-releases/2026-01-29-02/), and
    projects global pax to exceed 12B by 2030 led by Asia-Pacific — the
    ~3-11%/yr per-market multipliers produced here sit inside that band.
"""

import math

import pandas as pd

from pacific_wings import paths

ROOT = paths.ROOT

# IMF WEO potential growth rates (%, long-run equilibrium)
LONG_RUN_GDP_GROWTH_PCT: dict[str, float] = {
    "AUS": 2.3,
    "JPN": 0.9,
    "NZL": 2.2,
    "SGP": 2.6,
    "VNM": 6.0,
}
LONG_RUN_GDP_GROWTH_DEFAULT = 2.5

# IATA income elasticity of aviation demand. Applied to GDP PER CAPITA, not
# to total GDP: total GDP already contains population growth, so putting a 1.5
# elasticity on it counted population twice. Population enters separately and
# linearly below, which is what it actually is - more people, more trips.
AVIATION_INCOME_ELASTICITY = 1.5

# Long-run tourism growth (UNWTO's ~3-4%/yr steady state) and how fast a
# country's own structural CAGR decays toward it. Without the decay, Vietnam's
# clamped 15%/yr compounded for the entire projection horizon.
LONG_RUN_TOURISM_GROWTH = 0.04
TOURISM_GROWTH_DECAY = 0.25

# Weight on tourism in the composite demand multiplier. Zero for a domestic
# route: SYD-MEL was being grown by Australia's INBOUND tourist arrivals, which
# projected the world's fifth-busiest and most mature corridor at +7.5%/yr
# while the observed data had it falling 9% year on year.
TOURISM_BLEND_WEIGHT = 0.4

# Pacific Wings' home market. A route to it is domestic.
HOME_COUNTRY_ALPHA3 = "AUS"


def tourism_weight_for(destination_country_alpha3: str) -> float:
    """Weight to give inbound tourism when growing this route's market."""
    return 0.0 if destination_country_alpha3 == HOME_COUNTRY_ALPHA3 else TOURISM_BLEND_WEIGHT

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
    Project annual tourism arrivals forward from the latest OBSERVED year.

    This used to compound the pre-COVID 2015-2019 CAGR from the 2019 snapshot
    through every intervening year, which is to say straight through the
    pandemic as though it had not happened. With arrivals data ending at 2020
    it produced 73.8M Japanese arrivals for 2026 against a real 36.9M in 2024,
    47.9M for Vietnam against 17.6M, and 28.4M for Singapore against 16.5M -
    every published arrivals figure in the product was roughly double reality.

    Two changes fix it. The anchor is the most recent year with an observed
    figure (etl/fetch_worldbank.py now backfills 2021-2024), and the growth
    rate decays from the structural CAGR toward a long-run rate instead of
    compounding a boom forever - Vietnam's clamped 15%/yr was still running at
    15% a decade out.

    `snapshot_tourism`/`snapshot_year` remain the fallback anchor for a country
    with no observed series at all.

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

    observed = country[country["tourism_arrivals"].notna()]
    if not observed.empty:
        anchor_year = int(observed.iloc[-1]["year"])
        anchor_value = float(observed.iloc[-1]["tourism_arrivals"])
    else:
        anchor_year, anchor_value = snapshot_year, snapshot_tourism

    observed_by_year = {
        int(r.year): float(r.tourism_arrivals) for r in observed.itertuples()
    }

    result: dict[int, float] = {}
    for year in range(from_year, to_year + 1):
        if year in observed_by_year:
            result[year] = round(observed_by_year[year])
            continue
        value = anchor_value
        for n in range(1, year - anchor_year + 1):
            rate = LONG_RUN_TOURISM_GROWTH + (structural_cagr - LONG_RUN_TOURISM_GROWTH) * math.exp(
                -TOURISM_GROWTH_DECAY * (n - 1)
            )
            value *= 1 + rate
        result[year] = round(value)

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
    tourism_weight: float = TOURISM_BLEND_WEIGHT,
) -> dict[int, dict]:
    """
    Composite market-size index for a bilateral route.

    Combines income growth and tourism growth into a demand multiplier
    relative to from_year:
        income     = (gdp_per_capita_ratio ^ elasticity) * population_ratio
        multiplier = (1 - w) * income + w * tourism_ratio,  w = tourism_weight

    `tourism_weight` is 0.0 for a domestic route, which has no inbound-tourism
    driver at all.

    Returns per-year dict with gdp, population, tourism, fuel price, indices,
    and the composite demand_multiplier.
    """
    gdp = project_gdp(country_alpha3, from_year, to_year)
    pop = project_population(country_alpha3, from_year, to_year)
    tourism = project_tourism(country_alpha3, snapshot_tourism, snapshot_year, from_year, to_year)
    fuel = project_fuel_price(from_year, to_year)

    base_gdp = gdp[from_year]["gdp_usd"]
    base_pop = pop[from_year]
    base_tourism = tourism[from_year]
    base_gdp_per_capita = base_gdp / base_pop if base_pop else 0.0

    result: dict[int, dict] = {}
    for year in range(from_year, to_year + 1):
        gdp_ratio = gdp[year]["gdp_usd"] / base_gdp if base_gdp > 0 else 1.0
        pop_ratio = pop[year] / base_pop if base_pop else 1.0
        gdp_per_capita = gdp[year]["gdp_usd"] / pop[year] if pop[year] else 0.0
        income_ratio = gdp_per_capita / base_gdp_per_capita if base_gdp_per_capita > 0 else 1.0
        tour_ratio = tourism[year] / base_tourism if base_tourism > 0 else 1.0

        income_term = (income_ratio ** AVIATION_INCOME_ELASTICITY) * pop_ratio
        demand_multiplier = (1 - tourism_weight) * income_term + tourism_weight * tour_ratio

        result[year] = {
            "gdp_usd": gdp[year]["gdp_usd"],
            "gdp_growth_pct": gdp[year]["gdp_growth_pct"],
            "gdp_index": round(gdp_ratio, 4),
            "gdp_per_capita_index": round(income_ratio, 4),
            "population": pop[year],
            "tourism_arrivals": tourism[year],
            "tourism_index": round(tour_ratio, 4),
            "tourism_weight": tourism_weight,
            "fuel_price_usd_per_gallon": fuel[year],
            "demand_multiplier": round(demand_multiplier, 4),
            "data_source": gdp[year]["source"],
        }

    return result
