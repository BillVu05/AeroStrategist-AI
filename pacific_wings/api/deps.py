"""
The objects every router shares.

Constructed once at import: the engine loads reference data, the fitted market
model and the confidence artifacts, and rebuilding that per request would make
every endpoint slow for no reason.
"""

import csv
import json

from fastapi import HTTPException

from pacific_wings import paths
from pacific_wings.ml.features import ReferenceData
from pacific_wings.simulation.cost import CostModel
from pacific_wings.simulation.engine import SimulationEngine
from pacific_wings.simulation.revenue import RevenueModel

metrics = json.loads(paths.METRICS.read_text(encoding="utf-8"))

# 80% empirical prediction interval on the MARKET forecast: point estimate
# plus this route's 10th/90th percentile out-of-fold residual
# (pacific_wings/ml/train.py). Out-of-fold matters - these used to come from a
# 2023-only holdout model while a different, all-rows model was deployed, so
# HND carried a permanent +830 passenger bias belonging to a model that was
# no longer in production. See docs/data_methodology.md.
residual_quantiles = metrics["residual_quantiles"]
residual_by_route = metrics["residual_quantiles_by_route"]

ref = ReferenceData()
cost_model = CostModel()
revenue_model = RevenueModel()
engine = SimulationEngine()

airline_profile = json.loads(paths.AIRLINE_PROFILE.read_text(encoding="utf-8"))
with open(paths.AIRPORTS, newline="", encoding="utf-8") as f:
    airports = {row["iata"]: row for row in csv.DictReader(f)}


def forecast_demand(destination: str, year: int, month: int, avg_fare_usd: float | None) -> dict:
    """One scenario run, reshaped for the forecast endpoints.

    Deliberately delegates to the engine rather than predicting here: the
    market model, the growth multiplier, the fare elasticity, the share
    model and the spill cap must be applied in exactly one order, in exactly
    one place.
    """
    try:
        route = ref.route(destination)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown destination: {destination}") from exc

    price_delta_pct = 0.0
    base_fare = ref.default_avg_fare(destination)
    if avg_fare_usd is not None and base_fare > 0:
        price_delta_pct = avg_fare_usd / base_fare - 1

    result = engine.run_scenario(destination, year, month, price_delta_pct=price_delta_pct)
    demand = result["demand"]

    market = float(demand["market_passengers"])
    share = result["market_share"]["pacific_wings_share"]
    capacity_monthly = float(demand["capacity_monthly"])

    # The band belongs to the MARKET forecast, which is what was measured
    # out-of-fold. Pacific Wings' band is that band times its share, then
    # capped by what it can actually fly - the same treatment the point
    # estimate gets, so the interval and the point stay consistent.
    quantiles = residual_by_route.get(destination, residual_quantiles)
    growth = demand["market_multipliers"]["macro_growth"]
    market_low = max(0.0, market + quantiles["p10"] * growth)
    market_high = max(0.0, market + quantiles["p90"] * growth)

    sellable = float(demand["sellable_seats"])
    own_low = min(market_low * share, sellable)
    own_high = min(market_high * share, sellable)

    return {
        "route": route,
        "avg_fare_usd": result["scenario"]["avg_fare_usd"],
        "market_passengers": market,
        "market_passengers_low": market_low,
        "market_passengers_high": market_high,
        "pacific_wings_share": share,
        "predicted_passengers": float(demand["predicted_demand_passengers"]),
        "predicted_passengers_low": own_low,
        "predicted_passengers_high": own_high,
        "capacity_monthly": capacity_monthly,
        "sellable_seats": sellable,
        "passengers_carried": float(demand["passengers_carried"]),
        "spilled_passengers": float(demand["spilled_passengers"]),
        "predicted_load_factor": demand["load_factor"],
        "predicted_load_factor_low": own_low / capacity_monthly if capacity_monthly else 0.0,
        "predicted_load_factor_high": own_high / capacity_monthly if capacity_monthly else 0.0,
        "confidence": {
            "confidence_pct": demand["confidence_pct"],
            "confidence_breakdown": demand["confidence_breakdown"],
            "confidence_notes": demand["confidence_notes"],
        },
        "revenue_passengers": float(demand["passengers_carried"]),
    }
