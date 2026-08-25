"""
Phase 5 (real-data rebuild) Monte Carlo scenario simulator.

`pacific_wings/simulation/engine.py`'s `SimulationEngine` answers "what happens under
THESE specific assumptions" (Phase 7, deterministic). This module answers
"what's the plausible RANGE of outcomes, given real uncertainty in four
inputs nobody at Pacific Wings controls" - by sampling those inputs from
distributions and running many `SimulationEngine` passes.

Distributions, and why:
  - Fuel price: lognormal centred on the latest reference price
    (`pacific_wings/simulation/cost.py`'s `latest_fuel_price()`). Sigma is the REAL
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
    used by `pacific_wings/simulation/presets.py`'s `competitor_entry` preset, but as a
    probability distribution instead of an on/off toggle.
  - Demand-model error: the market forecast itself is uncertain - often the
    largest uncertainty in a scenario. Each trial multiplies the market
    estimate by a normal noise term whose spread is the model's REAL
    out-of-fold residual spread for this route (models/metrics.json,
    p10-p90 converted to a sigma), so routes the model historically
    forecast poorly get wider profit bands.

Fare (a controlled decision variable, not an external uncertainty) is held
fixed per-trial at whatever `price_delta_pct` the caller passes - consistent
with how the deterministic `/what_if` treats price as a lever, not a
random variable.
"""

import json

import numpy as np
import pandas as pd

from pacific_wings import paths
from pacific_wings.ml.features import COUNTRY_ALPHA2_TO_ALPHA3, NOTIONAL_CANDIDATE_FREQUENCY
from pacific_wings.simulation.cost import latest_fuel_price
from pacific_wings.simulation.macro_projections import project_gdp

ROOT = paths.ROOT

DEFAULT_SIMULATIONS = 500
MIN_SIMULATIONS = 100
MAX_SIMULATIONS = 1000
DEFAULT_SEED = 42
HISTOGRAM_BINS = 20

# Annual log-return volatility of jet fuel.
#
# Measured straight off data/reference/fuel_prices.csv's six annual points this
# came to 0.67, and that number was doing real damage. A lognormal that wide
# put p10-p90 at roughly $0.97-$5.43 for a single scenario, pushed 7.6% of
# trials into the $6.00 clamp - a point mass of identical near-breakeven
# outcomes that showed up on the histogram as a second mode and WAS most of the
# reported probability of loss - and, because a lognormal's mean sits above its
# median, dragged mean profit 12% below the deterministic estimate.
#
# Two of the five annual returns in that series are the COVID collapse and its
# rebound. Excluding them (the same _COVID_YEARS exclusion the projection module
# already applies) leaves 0.47, still inflated by the 2022 energy shock, so it
# is capped at the top of the published long-run annual jet-fuel volatility
# range. The clamp below is back to being a physical backstop that essentially
# never binds.
# Bounds are the published long-run annual jet-fuel volatility range. The
# COVID exclusion leaves only two usable annual returns, which estimate 0.18 -
# too few points to believe, and understating fuel risk is no better than
# overstating it. Both ends of the clamp are therefore doing real work: the
# ceiling holds the 2022 energy shock in check, the floor stops a two-point
# sample from claiming fuel is calm.
FUEL_PRICE_LOG_SIGMA_MAX = 0.35
FUEL_PRICE_LOG_SIGMA_MIN = 0.25
FUEL_PRICE_MIN_USD = 0.40
FUEL_PRICE_MAX_USD = 6.00
_COVID_YEARS = {2020, 2021}


def _fuel_log_sigma() -> float:
    """Log-return std of the reference series, excluding COVID-affected years."""
    df = pd.read_csv(ROOT / "data" / "reference" / "fuel_prices.csv")
    df["year"] = pd.to_datetime(df["price_date"]).dt.year
    df = df.sort_values("year").reset_index(drop=True)
    returns = [
        np.log(df.usd_per_gallon[i] / df.usd_per_gallon[i - 1])
        for i in range(1, len(df))
        if df.year[i] not in _COVID_YEARS and df.year[i - 1] not in _COVID_YEARS
    ]
    if len(returns) < 2:
        return FUEL_PRICE_LOG_SIGMA_MAX
    return float(np.clip(np.std(returns, ddof=1), FUEL_PRICE_LOG_SIGMA_MIN, FUEL_PRICE_LOG_SIGMA_MAX))


FUEL_PRICE_LOG_SIGMA = _fuel_log_sigma()

# Illustrative, not real-data-fitted - see module docstring.
COMPETITOR_ENTRY_PROBABILITY = 0.25
COMPETITOR_DISCOUNT_TRIANGULAR = (0.05, 0.12, 0.25)  # (low, mode, high)
COMPETITOR_ENTRY_RATING = 3.9
COMPETITOR_ENTRY_NAME = "Simulated New Entrant"

# GDP-growth spread, with the COVID years excluded. Including them put
# Singapore's standard deviation at 3.98pp around a 1.31pp centre, so more than
# a third of trials drew a recession - a pandemic-scale shock sampled as if it
# were the ordinary year-to-year variation of a scenario.
_macro = pd.read_csv(ROOT / "data" / "reference" / "macro_indicators.csv")
_macro_structural = _macro[~_macro["year"].isin(_COVID_YEARS)]
GDP_GROWTH_STD_BY_COUNTRY = _macro_structural.groupby("country")["gdp_growth_pct"].std().to_dict()
DEFAULT_GDP_GROWTH_STD = float(_macro_structural["gdp_growth_pct"].std())

_METRICS = json.loads((ROOT / "models" / "metrics.json").read_text())

# Demand-model error: the largest real uncertainty in any scenario, sampled
# per-trial from the model's own OUT-OF-FOLD residual spread (per-route where
# available, pooled otherwise). p90-p10 of a normal spans 2.5631 sigma.
DEMAND_NOISE_REL_STD_MIN = 0.02
DEMAND_NOISE_REL_STD_MAX = 0.50
DEMAND_NOISE_CLIP = (0.3, 1.7)


def _demand_noise_rel_std(destination: str, baseline_predicted_pax: float) -> float:
    quantiles = _METRICS.get("residual_quantiles_by_route", {}).get(
        destination, _METRICS["residual_quantiles"]
    )
    sigma_abs = (quantiles["p90"] - quantiles["p10"]) / 2.5631
    rel = sigma_abs / max(baseline_predicted_pax, 1.0)
    return float(np.clip(rel, DEMAND_NOISE_REL_STD_MIN, DEMAND_NOISE_REL_STD_MAX))


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
    price, GDP growth, competitor entry, and demand-model error randomized
    per-trial (see module docstring), returning summary statistics and a
    profit histogram instead of a single point estimate.

    `scenario_kwargs` (price_delta_pct, frequency_delta, aircraft_type,
    rating_delta) are held fixed across all trials - only the four
    uncertain inputs above are randomized.

    `fuel_price_center` optionally shifts the real lognormal fuel-price
    distribution's center away from the latest reference price (e.g. for a
    "what if fuel costs spike further" stress scenario) while keeping the
    same real volatility around it. Defaults to the latest reference price.
    """
    n_simulations = max(MIN_SIMULATIONS, min(n_simulations, MAX_SIMULATIONS))
    rng = np.random.default_rng(seed)

    route = engine.ref.route(destination)
    base_fuel_price = fuel_price_center if fuel_price_center is not None else latest_fuel_price(year)
    alpha3 = COUNTRY_ALPHA2_TO_ALPHA3.get(route["destination_country"])
    gdp_growth_std = GDP_GROWTH_STD_BY_COUNTRY.get(alpha3, DEFAULT_GDP_GROWTH_STD)
    # Centre on the growth rate projected FOR THE SCENARIO YEAR. It used to be
    # the route's 2019 macro snapshot, so /monte_carlo sampled around 1.31% for
    # Singapore in 2026 while /macro_projection on the same screen said 3.12%.
    base_gdp_growth = float(route["market"]["gdp_growth_pct"])
    if alpha3:
        base_gdp_growth = float(project_gdp(alpha3, year, year)[year]["gdp_growth_pct"])

    # Centred on the MEAN, not the median: exp(N(log(c), s)) has mean
    # c.exp(s^2/2), so sampling around log(c) quietly made every trial's
    # expected fuel price higher than the deterministic run's.
    fuel_prices = np.clip(
        rng.lognormal(
            mean=np.log(base_fuel_price) - 0.5 * FUEL_PRICE_LOG_SIGMA**2,
            sigma=FUEL_PRICE_LOG_SIGMA,
            size=n_simulations,
        ),
        FUEL_PRICE_MIN_USD,
        FUEL_PRICE_MAX_USD,
    )
    gdp_growth_samples = rng.normal(base_gdp_growth, gdp_growth_std, size=n_simulations)
    competitor_enters = rng.random(n_simulations) < COMPETITOR_ENTRY_PROBABILITY
    competitor_discounts = rng.triangular(*COMPETITOR_DISCOUNT_TRIANGULAR, size=n_simulations)

    # The residual quantiles are measured on the MARKET forecast, so the
    # relative noise must be taken against the market figure - dividing a
    # market-scale residual by Pacific Wings' own passenger count would
    # overstate the noise by roughly the inverse of its market share.
    baseline_market = engine.run_scenario(destination, year, month, **scenario_kwargs)[
        "demand"
    ]["market_passengers"]
    demand_rel_std = _demand_noise_rel_std(destination, baseline_market)
    demand_noise = np.clip(
        rng.normal(1.0, demand_rel_std, size=n_simulations), *DEMAND_NOISE_CLIP
    )

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
        trial_kwargs["demand_noise_multiplier"] = float(demand_noise[i])
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

    # The deterministic answer, alongside the sampled one. A skewed input
    # distribution pulls the Monte Carlo mean away from the point estimate, and
    # a reader comparing two screens deserves to see both numbers rather than
    # discover the gap.
    deterministic_profit = float(
        engine.run_scenario(
            destination,
            year,
            month,
            fuel_price_usd_per_gallon=base_fuel_price,
            **scenario_kwargs,
        )["profit_usd"]
    )

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
                "source": (
                    "Log-return volatility of data/reference/fuel_prices.csv excluding the "
                    "COVID years, capped at the published long-run annual jet-fuel range"
                ),
            },
            "gdp_growth_pct": {
                "distribution": "normal",
                "center": round(base_gdp_growth, 3),
                "std": round(gdp_growth_std, 3),
                "source": (
                    f"Centre: {alpha3 or 'route'} growth projected for {year}. Spread: real "
                    f"{alpha3 or 'pooled'} 2010-2024 GDP growth std excluding COVID years, "
                    "data/reference/macro_indicators.csv"
                ),
            },
            "competitor_entry": {
                "distribution": "bernoulli(p) x triangular discount",
                "probability": COMPETITOR_ENTRY_PROBABILITY,
                "discount_range_pct": [round(d * 100, 1) for d in COMPETITOR_DISCOUNT_TRIANGULAR],
                "source": "Illustrative assumption, not fitted to real data (no public source exists)",
            },
            "demand_model_error": {
                "distribution": "normal multiplier on predicted demand",
                "rel_std": round(demand_rel_std, 4),
                "clip_range": list(DEMAND_NOISE_CLIP),
                "source": f"Real {destination} holdout residual spread (p10-p90), models/metrics.json",
            },
        },
        "deterministic_profit_usd": round(deterministic_profit, 2),
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
