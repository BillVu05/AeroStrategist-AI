"""
The route market-size model: monthly total market (one-way-equivalent
passengers, all carriers) for a route.

Two candidate models live here and `pacific_wings/ml/train.py` picks between
them on the same forward-looking holdout, every run, recording the winner in
models/market_model.json:

  - seasonal_index: each route's own recent mean market, times a per-month
    index built from that route's history. A per-route level plus a shape.
  - xgboost: gradient-boosted trees over distance/macro/competitor features.

The trees lost. On the 2024 holdout the seasonal index scores MAPE 10.6%
against XGBoost's 17.8%, and leave-one-route-out CV shows why the gap is
structural rather than a tuning miss: with five routes, the only features
that separate them are constants (distance, population), so the trees learn a
route lookup and cannot transfer to a route they have not seen (held-out
MAPE 34%-6300%). A per-route index does the same lookup honestly, in a
tenth of the code, and extrapolates cleanly instead of saturating.

Nothing here responds to fare or competition, deliberately. Those are
explicit, documented mechanisms applied on top by pacific_wings/simulation/engine.py: a
constant-elasticity fare term against the market, and the multinomial-logit
share model against the carriers. Burying them inside a fitted model on 120
rows was what made every strategy lever inert.

Keeping XGBoost as a live contender is the point of the selection step - if
more routes or more history ever arrive, it may start winning, and the run
that flips it will say so.
"""

import json
from pathlib import Path

from pacific_wings import paths

ROOT = paths.ROOT
MODELS_DIR = ROOT / "models"
MODEL_PATH = MODELS_DIR / "market_model.json"

SEASONAL_INDEX = "seasonal_index"
XGBOOST = "xgboost"


def fit_seasonal_index(obs, target: str) -> dict:
    """Per-route level + per-month shape.

    The level is the route's mean market over the training years; the shape
    is each month's mean relative to that level. Both are plain averages -
    with two years of history, anything fancier is fitting noise.
    """
    params = {}
    for dest, group in obs.groupby("destination"):
        base = float(group[target].mean())
        if base <= 0:
            continue
        month_index = group.groupby("month")[target].mean() / base
        params[dest] = {
            "base": base,
            # Months absent from the history fall back to a flat 1.0 rather
            # than to zero, which would silently erase a month of demand.
            "month_index": [float(month_index.get(m, 1.0)) for m in range(1, 13)],
            "n_observations": int(len(group)),
        }
    return params


class MarketModel:
    """Loads whichever candidate won at training time and serves it."""

    def __init__(self, path: Path | None = None) -> None:
        artifact = json.loads((path or MODEL_PATH).read_text())
        self.kind: str = artifact["kind"]
        self.params: dict = artifact["params"]
        self.selection: dict = artifact.get("selection", {})
        self._booster = None

        if self.kind == XGBOOST:
            import xgboost as xgb

            self._booster = xgb.XGBRegressor()
            self._booster.load_model(MODELS_DIR / "demand_model.json")
            self._feature_columns = json.loads((MODELS_DIR / "feature_columns.json").read_text())

    def routes(self) -> list[str]:
        return sorted(self.params) if self.kind == SEASONAL_INDEX else []

    def predict(self, destination: str, month: int, X=None) -> float:
        """Total monthly market for the route, before macro growth and before
        any fare-elasticity adjustment (both applied by the caller).

        `X` is a single-row feature frame, required only by the xgboost kind -
        the deployed seasonal index needs nothing but the route and the month.
        Callers that may run under either kind should pass it.
        """
        if self.kind == XGBOOST:
            if X is None:
                raise ValueError(
                    "The xgboost market model needs a feature frame; build one with "
                    "ReferenceData.build_features and pass it as X."
                )
            return float(self._booster.predict(X[self._feature_columns])[0])

        route = self.params.get(destination)
        if route is None:
            raise KeyError(f"No market model for destination: {destination}")
        return route["base"] * route["month_index"][month - 1]
