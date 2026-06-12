"""
Phase 7 simulation engine: the deterministic core that ties Phases 3-6
together.

Given a route/month and a set of scenario deltas (price change, frequency
change, fuel price, aircraft swap, service rating change), recomputes:
  - demand (via the Phase 3 XGBoost model)
  - passengers actually carried (demand capped by capacity - Pacific Wings'
    own frequency/fleet choice doesn't change market demand, but it does
    change how much of that demand can be served)
  - revenue (Phase 4), cost (Phase 5), profit
  - market share (Phase 6)

This module has no I/O side effects beyond loading static reference data and
the trained model at construction time - `run_scenario` is a pure function
of its inputs.
"""

import json
import sys
from pathlib import Path

import pandas as pd
import xgboost as xgb

ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = ROOT / "models"

sys.path.insert(0, str(ROOT / "ml"))
from features import NOTIONAL_CANDIDATE_FREQUENCY, ReferenceData  # noqa: E402

from cost import CostModel  # noqa: E402
from market_share import PACIFIC_WINGS_RATING, MarketShareModel  # noqa: E402
from revenue import RevenueModel  # noqa: E402


class SimulationEngine:
    def __init__(self) -> None:
        self.ref = ReferenceData()
        self.cost_model = CostModel()
        self.revenue_model = RevenueModel()
        self.market_share_model = MarketShareModel()

        self._model = xgb.XGBRegressor()
        self._model.load_model(MODELS_DIR / "demand_model.json")
        self._feature_columns = json.loads((MODELS_DIR / "feature_columns.json").read_text())

    def run_scenario(
        self,
        destination: str,
        year: int,
        month: int,
        price_delta_pct: float = 0.0,
        frequency_delta: int = 0,
        fuel_price_usd_per_gallon: float | None = None,
        aircraft_type: str | None = None,
        rating_delta: float = 0.0,
        tourism_arrivals_multiplier: float = 1.0,
        extra_competitors: list[dict] | None = None,
    ) -> dict:
        route = self.ref.route(destination)

        base_fare = self.ref.default_avg_fare(destination)
        scenario_fare = base_fare * (1 + price_delta_pct)

        base_frequency = route["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY
        scenario_frequency = max(0, base_frequency + frequency_delta)

        scenario_aircraft = aircraft_type or route["assigned_aircraft"]

        # Demand: driven by market features + own fare, independent of
        # Pacific Wings' own capacity choices.
        features = self.ref.build_features(
            destination,
            year,
            month,
            scenario_fare,
            tourism_arrivals_multiplier=tourism_arrivals_multiplier,
            extra_competitors=extra_competitors,
        )
        X = pd.DataFrame([features])[self._feature_columns]
        predicted_passengers = float(self._model.predict(X)[0])

        capacity_monthly = self.ref.capacity_monthly(
            destination, aircraft_type=scenario_aircraft, weekly_frequency=scenario_frequency
        )
        passengers_carried = min(predicted_passengers, capacity_monthly)
        load_factor = passengers_carried / capacity_monthly if capacity_monthly > 0 else 0.0

        revenue = self.revenue_model.monthly_revenue(
            destination, passengers_carried, scenario_fare, aircraft_type=scenario_aircraft
        )
        cost = self.cost_model.monthly_cost(
            destination,
            fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
            weekly_frequency=scenario_frequency,
            aircraft_type=scenario_aircraft,
        )
        profit_usd = round(revenue["total_revenue_usd"] - cost["total_cost_usd"], 2)

        market_share = self.market_share_model.compute(
            destination,
            own_price=scenario_fare,
            own_frequency=scenario_frequency,
            own_rating=PACIFIC_WINGS_RATING + rating_delta,
            extra_competitors=extra_competitors,
        )

        return {
            "origin": route["origin"],
            "destination": destination,
            "year": year,
            "month": month,
            "scenario": {
                "avg_fare_usd": round(scenario_fare, 2),
                "weekly_frequency": scenario_frequency,
                "aircraft_type": scenario_aircraft,
                "fuel_price_usd_per_gallon": cost["fuel_price_usd_per_gallon"],
                "pacific_wings_rating": round(PACIFIC_WINGS_RATING + rating_delta, 2),
                "tourism_arrivals_multiplier": tourism_arrivals_multiplier,
                "extra_competitors": extra_competitors or [],
            },
            "demand": {
                "predicted_demand_passengers": round(predicted_passengers),
                "capacity_monthly": round(capacity_monthly),
                "passengers_carried": round(passengers_carried),
                "load_factor": round(load_factor, 4),
                "demand_constrained_by_capacity": predicted_passengers > capacity_monthly,
            },
            "revenue": revenue,
            "cost": cost,
            "profit_usd": profit_usd,
            "market_share": market_share,
        }

    def compare(self, destination: str, year: int, month: int, **scenario_kwargs) -> dict:
        """Run the baseline (no deltas) alongside a scenario for side-by-side comparison."""
        baseline = self.run_scenario(destination, year, month)
        scenario = self.run_scenario(destination, year, month, **scenario_kwargs)
        return {
            "baseline": baseline,
            "scenario": scenario,
            "delta": {
                "profit_usd": round(scenario["profit_usd"] - baseline["profit_usd"], 2),
                "passengers_carried": scenario["demand"]["passengers_carried"]
                - baseline["demand"]["passengers_carried"],
                "pacific_wings_share": round(
                    scenario["market_share"]["pacific_wings_share"]
                    - baseline["market_share"]["pacific_wings_share"],
                    4,
                ),
            },
        }
