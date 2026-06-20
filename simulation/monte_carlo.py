"""
Phase 5 (real-data rebuild) Monte Carlo scenario simulator.

`simulation/engine.py`'s `SimulationEngine` answers "what happens under
THESE specific assumptions" (Phase 7, deterministic). This module answers
"what's the plausible RANGE of outcomes, given real uncertainty in three
inputs nobody at Pacific Wings controls" - by sampling those inputs from
distributions and running many `SimulationEngine` passes.

Distributions, and why:
  - Fuel price: lognormal centred on the latest reference price
    (`simulation/cost.py`'s `latest_fuel_price()`). Sigma is the REAL
    log-return volatility of `data/reference/fuel_prices.csv`'s 2019-2024
    annual-average series (~0.67) - that period spans the COVID demand
    collapse ($0.81/gal) and the 2022 energy-price spike ($3.48/gal), so the
    resulting bands are wide because fuel genuinely was that volatile in
    recent history, not because this model invents drama. From only 6
    annual points the volatility estimate itself is uncertain - clamped to
    a [$0.40, $6.00]/gal physical sanity range as a backstop.
  - GDP growth: normal centred on the destination country's macro-snapshot
    growth rate, with std = that country's REAL year-to-year GDP growth
    standard deviation, 2010-2024 (`data/reference/macro_indicators.csv`) -
    e.g. ~1.0pp for Australia vs. ~4.0pp for Singapore, a small trade-exposed
    economy that really has had more volatile growth historically.
  - Competitor entry: illustrative, NOT fitted to real data (no public
    source for new-entrant timing probabilities exists) - a documented
    assumption that there's a 25% chance a new competitor enters during the
    scenario period, pricing at a triangular(5%, 12%, 25%) discount to
    Pacific Wings' fare. Centred on the same 10% point assumption already
    used by `simulation/presets.py`'s `competitor_entry` preset, but as a
    probability distribution instead of an on/off toggle.

Fare (a controlled decision variable, not an external uncertainty) is held
fixed per-trial at whatever `price_delta_pct` the caller passes - consistent
with how the deterministic `/what_if` treats price as a lever, not a
random variable.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))

from features import COUNTRY_ALPHA2_TO_ALPHA3, NOTIONAL_CANDIDATE_FREQUENCY  # noqa: E402

from cost import latest_fuel_price  # noqa: E402

DEFAULT_SIMULATIONS = 500
MIN_SIMULATIONS = 100
MAX_SIMULATIONS = 1000
DEFAULT_SEED = 42
HISTOGRAM_BINS = 20

# Real 2019-2024 log-return std of data/reference/fuel_prices.csv - see
# module docstring. Clamp is a physical sanity backstop, not a statistical one.
FUEL_PRICE_LOG_SIGMA = 0.67
FUEL_PRICE_MIN_USD = 0.40
FUEL_PRICE_MAX_USD = 6.00

# Illustrative, not real-data-fitted - see module docstring.
COMPETITOR_ENTRY_PROBABILITY = 0.25
COMPETITOR_DISCOUNT_TRIANGULAR = (0.05, 0.12, 0.25)  # (low, mode, high)
COMPETITOR_ENTRY_RATING = 3.9
COMPETITOR_ENTRY_NAME = "Simulated New Entrant"

_macro = pd.read_csv(ROOT / "data" / "reference" / "macro_indicators.csv")
GDP_GROWTH_STD_BY_COUNTRY = _macro.groupby("country")["gdp_growth_pct"].std().to_dict()
DEFAULT_GDP_GROWTH_STD = float(_macro["gdp_growth_pct"].std())


def _summarize(values: np.ndarray) -> dict:
    return {
        "mean": float(values.mean()),
        "std": float(values.std()),
        "min": float(values.min()),
        "p10": float(np.percentile(values, 10)),
        "p25": float(np.percentile(values, 25)),
        "p50": float(np.percentile(values, 50)),
        "p75": float(np.percentile(values, 75)),
        "p90": float(np.percentile(values, 90)),
        "max": float(values.max()),
    }


def run_monte_carlo(
    engine,
    destination: str,
    year: int,
    month: int,
    n_simulations: int = DEFAULT_SIMULATIONS,
    seed: int = DEFAULT_SEED,
    fuel_price_center: float | None = None,
    **scenario_kwargs,
) -> dict:
    """Runs `n_simulations` `SimulationEngine.run_scenario` passes with fuel
    price, GDP growth, and competitor entry randomized per-trial (see module
    docstring), returning summary statistics and a profit histogram instead
    of a single point estimate.

    `scenario_kwargs` (price_delta_pct, frequency_delta, aircraft_type,
    rating_delta) are held fixed across all trials - only the three
    uncertain inputs above are randomized.

    `fuel_price_center` optionally shifts the real lognormal fuel-price
    distribution's center away from the latest reference price (e.g. for a
    "what if fuel costs spike further" stress scenario) while keeping the
    same real volatility around it. Defaults to the latest reference price.
    """
    n_simulations = max(MIN_SIMULATIONS, min(n_simulations, MAX_SIMULATIONS))
    rng = np.random.default_rng(seed)

    route = engine.ref.route(destination)
    base_fuel_price = fuel_price_center if fuel_price_center is not None else latest_fuel_price()
    base_gdp_growth = route["market"]["gdp_growth_pct"]
    alpha3 = COUNTRY_ALPHA2_TO_ALPHA3.get(route["destination_country"])
    gdp_growth_std = GDP_GROWTH_STD_BY_COUNTRY.get(alpha3, DEFAULT_GDP_GROWTH_STD)

    fuel_prices = np.clip(
        rng.lognormal(mean=np.log(base_fuel_price), sigma=FUEL_PRICE_LOG_SIGMA, size=n_simulations),
        FUEL_PRICE_MIN_USD,
        FUEL_PRICE_MAX_USD,
    )
    gdp_growth_samples = rng.normal(base_gdp_growth, gdp_growth_std, size=n_simulations)
    competitor_enters = rng.random(n_simulations) < COMPETITOR_ENTRY_PROBABILITY
    competitor_discounts = rng.triangular(*COMPETITOR_DISCOUNT_TRIANGULAR, size=n_simulations)

    base_fare = engine.ref.default_avg_fare(destination)
    base_frequency = route["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY

    profits = np.empty(n_simulations)
    passengers = np.empty(n_simulations)
    load_factors = np.empty(n_simulations)
    shares = np.empty(n_simulations)

    for i in range(n_simulations):
        trial_kwargs = dict(scenario_kwargs)
        trial_kwargs["fuel_price_usd_per_gallon"] = round(float(fuel_prices[i]), 3)
        trial_kwargs["gdp_growth_pct_override"] = float(gdp_growth_samples[i])
        if competitor_enters[i]:
            trial_kwargs["extra_competitors"] = [
                {
                    "name": COMPETITOR_ENTRY_NAME,
                    "price": round(base_fare * (1 - competitor_discounts[i]), 2),
                    "weekly_frequency": base_frequency,
                    "rating": COMPETITOR_ENTRY_RATING,
                }
            ]
        result = engine.run_scenario(destination, year, month, **trial_kwargs)
        profits[i] = result["profit_usd"]
        passengers[i] = result["demand"]["passengers_carried"]
        load_factors[i] = result["demand"]["load_factor"]
        shares[i] = result["market_share"]["pacific_wings_share"]

    counts, edges = np.histogram(profits, bins=HISTOGRAM_BINS)

    return {
        "destination": destination,
        "year": year,
        "month": month,
        "n_simulations": n_simulations,
        "seed": seed,
        "assumptions": {
            "fuel_price_usd_per_gallon": {
                "distribution": "lognormal",
                "center": round(base_fuel_price, 3),
                "log_sigma": FUEL_PRICE_LOG_SIGMA,
                "clamp_range": [FUEL_PRICE_MIN_USD, FUEL_PRICE_MAX_USD],
                "source": "Real 2019-2024 log-return volatility, data/reference/fuel_prices.csv",
            },
            "gdp_growth_pct": {
                "distribution": "normal",
                "center": round(base_gdp_growth, 3),
                "std": round(gdp_growth_std, 3),
                "source": f"Real {alpha3 or 'pooled'} 2010-2024 GDP growth std, data/reference/macro_indicators.csv",
            },
            "competitor_entry": {
                "distribution": "bernoulli(p) x triangular discount",
                "probability": COMPETITOR_ENTRY_PROBABILITY,
                "discount_range_pct": [round(d * 100, 1) for d in COMPETITOR_DISCOUNT_TRIANGULAR],
                "source": "Illustrative assumption, not fitted to real data (no public source exists)",
            },
        },
        "profit_usd": _summarize(profits),
        "passengers_carried": _summarize(passengers),
        "load_factor": _summarize(load_factors),
        "pacific_wings_share": _summarize(shares),
        "probability_of_loss": float(np.mean(profits < 0)),
        "profit_histogram": {
            "bin_edges": [round(float(e), 2) for e in edges],
            "counts": [int(c) for c in counts],
        },
    }
