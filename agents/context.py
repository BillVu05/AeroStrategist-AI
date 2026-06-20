"""
Shared market context lookup for the Market and Risk agents.

Pulls real route/macro data and synthetic-but-calibrated competitor data
that already feeds the demand model (ml/features.py) - this module just
re-shapes it into a compact dict for LLM prompts. No new data sources, no
invented numbers.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import ReferenceData  # noqa: E402

# Real per-country geopolitical/currency risk tables - already built for the
# open-route feature (any worldwide destination); reused here so the 5
# existing Pacific Wings routes get the same real data instead of the
# frontend fabricating a GDP-derived proxy (real-data rebuild realism audit).
from open_route_analyst import _geo_risk, _currency_risk  # noqa: E402

_ref = ReferenceData()

# Real XGBoost feature importances from the trained demand model
# (ml/train_demand_model.py) - same for every destination (one global
# model), included here so the frontend can show genuine model-driven
# demand drivers instead of an invented "impact %" per field.
_feature_importances: dict[str, float] = json.loads(
    (ROOT / "models" / "metrics.json").read_text()
)["feature_importances"]


def market_context(destination: str, year: int) -> dict:
    """Real-data + calibrated-synthetic snapshot of a route's market for a given year."""
    route = _ref.route(destination)
    macro_row = _ref._macro_row(destination, year)

    comp = _ref.competitors[_ref.competitors["destination"] == destination]
    competitors = [
        {
            "name": row["competitor_name"],
            "weekly_frequency": int(row["weekly_frequency"]),
            "avg_fare_usd": round(float(row["avg_fare_usd"]), 2),
            "rating": float(row["rating"]),
        }
        for _, row in comp.iterrows()
    ]

    return {
        "origin": route["origin"],
        "destination": destination,
        "destination_city": route["destination_city"],
        "destination_country": route["destination_country"],
        "distance_km": route["distance_km"],
        "flight_duration_hours": route["flight_duration_hours"],
        "current_weekly_frequency": route["weekly_frequency"],
        "assigned_aircraft": route["assigned_aircraft"],
        "macro_year": int(macro_row["year"]),
        "gdp_usd": float(macro_row["gdp_usd"]),
        "gdp_growth_pct": float(macro_row["gdp_growth_pct"]),
        "population": float(macro_row["population"]),
        "tourism_arrivals_baseline": route["market"]["tourism_arrivals"],
        "tourism_arrivals_snapshot_year": route["market"]["snapshot_year"],
        "competitors": competitors,
        "geopolitical_risk": _geo_risk(route["destination_country"]),
        "currency_risk": _currency_risk(route["destination_country"]),
        "demand_feature_importances": _feature_importances,
    }
