"""
Phase 10 what-if presets: named scenarios as thin wrappers over the Phase 7
SimulationEngine. Each preset maps to a set of `run_scenario`/`compare`
keyword arguments, derived from the route's own reference data so the
preset is meaningful for whichever destination it's applied to.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))

from features import NOTIONAL_CANDIDATE_FREQUENCY  # noqa: E402

from cost import latest_fuel_price  # noqa: E402

FUEL_PRICE_SHOCK_MULTIPLIER = 1.3
TOURISM_BOOM_MULTIPLIER = 1.2
COMPETITOR_ENTRY_FARE_DISCOUNT = 0.9
COMPETITOR_ENTRY_RATING = 3.9
COMPETITOR_ENTRY_NAME = "New Entrant Air"


def _fuel_price_shock(engine, destination: str) -> dict:
    base_price = latest_fuel_price()
    return {"fuel_price_usd_per_gallon": round(base_price * FUEL_PRICE_SHOCK_MULTIPLIER, 3)}


def _tourism_boom(engine, destination: str) -> dict:
    return {"tourism_arrivals_multiplier": TOURISM_BOOM_MULTIPLIER}


def _competitor_entry(engine, destination: str) -> dict:
    route = engine.ref.route(destination)
    base_fare = engine.ref.default_avg_fare(destination)
    base_frequency = route["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY

    new_entrant = {
        "name": COMPETITOR_ENTRY_NAME,
        "price": round(base_fare * COMPETITOR_ENTRY_FARE_DISCOUNT, 2),
        "weekly_frequency": base_frequency,
        "rating": COMPETITOR_ENTRY_RATING,
    }
    return {"extra_competitors": [new_entrant]}


PRESETS = {
    "fuel_price_shock": {
        "label": "Fuel price +30%",
        "description": (
            "Jet fuel spikes 30% above the latest reference price, raising the "
            "fuel component of operating cost while demand and competition are "
            "unchanged."
        ),
        "kwargs_fn": _fuel_price_shock,
    },
    "tourism_boom": {
        "label": "Tourism boom (+20% arrivals)",
        "description": (
            "Tourism arrivals for the destination country rise 20% above baseline, "
            "increasing the market-size feature that drives the demand forecast."
        ),
        "kwargs_fn": _tourism_boom,
    },
    "competitor_entry": {
        "label": "New competitor enters the route",
        "description": (
            "A new carrier enters the route, pricing 10% below Pacific Wings' "
            "average fare at a comparable frequency. Adds a competitor to both "
            "the demand model's competitor features and the market-share model."
        ),
        "kwargs_fn": _competitor_entry,
    },
}


def list_presets() -> dict:
    return {
        name: {"label": preset["label"], "description": preset["description"]}
        for name, preset in PRESETS.items()
    }


def preset_kwargs(engine, name: str, destination: str) -> dict:
    if name not in PRESETS:
        raise KeyError(f"Unknown preset: {name}")
    return PRESETS[name]["kwargs_fn"](engine, destination)
