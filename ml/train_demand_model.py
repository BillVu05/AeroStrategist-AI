"""
Train an XGBoost regressor to forecast monthly route passenger demand
(Phase 3), using real distance/macro/competitor features plus the route's
own average fare and month, against the `demand_observations` ground truth -
real BITRE-derived figures for SIN/HND/AKL/DAD, a synthetic formula for
SYD-MEL (see etl/fetch_real_aviation_stats.py, the real-data rebuild Phase 3).

Train/test split is time-based: train on 2022-2023, test on 2024, so the
model is evaluated on its ability to forecast a future, unseen year. This
is the headline metric, reported in models/metrics.json's top-level
mae/mape/r2 fields.

Phase 5 (real-data rebuild) adds two validation-rigor pieces alongside that
headline split, both also written to models/metrics.json:
  - k-fold cross-validation (shuffled, ignores time order) - a second,
    independent read on model stability across different train/test splits
    of the same data, complementing the strict forward-looking holdout.
  - residual quantiles from the time-based holdout's prediction errors -
    used by api/main.py to attach an empirical prediction interval to
    /demand_forecast (a residual-bootstrap-style band: point forecast plus
    the historical 10th/90th percentile error, not a model-based interval).

Usage:
    python ml/train_demand_model.py

Outputs:
    models/demand_model.json     XGBoost model (native format)
    models/feature_columns.json  Ordered feature column names
    models/metrics.json          Holdout metrics, cross-validation, residual quantiles
"""

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error, r2_score
from sklearn.model_selection import KFold
from sqlalchemy import create_engine

from features import FEATURE_COLUMNS, ReferenceData

ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = ROOT / "models"

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg2://airline:airline@localhost:5432/airline_sim"
)

TEST_YEAR = 2024
N_CV_FOLDS = 5
CV_RANDOM_STATE = 42

MODEL_PARAMS = dict(
    n_estimators=150,
    max_depth=3,
    learning_rate=0.1,
    subsample=0.9,
    colsample_bytree=0.9,
    random_state=42,
)


def cross_validate(X: pd.DataFrame, y: pd.Series) -> dict:
    """K-fold CV (shuffled) over the full dataset, ignoring time order -
    complements the time-based holdout with a read on how much performance
    varies across different random splits of the same real-grounded data."""
    kfold = KFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=CV_RANDOM_STATE)
    fold_metrics = {"mae": [], "mape": [], "r2": []}

    for train_idx, test_idx in kfold.split(X):
        fold_model = xgb.XGBRegressor(**MODEL_PARAMS)
        fold_model.fit(X.iloc[train_idx], y.iloc[train_idx])
        pred = fold_model.predict(X.iloc[test_idx])
        y_test_fold = y.iloc[test_idx]
        fold_metrics["mae"].append(mean_absolute_error(y_test_fold, pred))
        fold_metrics["mape"].append(mean_absolute_percentage_error(y_test_fold, pred))
        fold_metrics["r2"].append(r2_score(y_test_fold, pred))

    return {
        "n_splits": N_CV_FOLDS,
        **{
            f"{metric}_{stat}": float(getattr(np, stat)(values))
            for metric, values in fold_metrics.items()
            for stat in ("mean", "std")
        },
    }


def load_observations(engine) -> pd.DataFrame:
    return pd.read_sql(
        """
        SELECT r.destination, d.year, d.month, d.passengers, d.avg_fare_usd
        FROM demand_observations d
        JOIN routes r ON r.route_id = d.route_id
        """,
        engine,
    )


def main() -> None:
    engine = create_engine(DATABASE_URL)
    obs = load_observations(engine)
    ref = ReferenceData()

    feature_rows = [
        ref.build_features(row.destination, row.year, row.month, row.avg_fare_usd)
        for row in obs.itertuples()
    ]
    X = pd.DataFrame(feature_rows)[FEATURE_COLUMNS]
    y = obs["passengers"]

    train_mask = obs["year"] < TEST_YEAR
    X_train, y_train = X[train_mask], y[train_mask]
    X_test, y_test = X[~train_mask], y[~train_mask]

    model = xgb.XGBRegressor(**MODEL_PARAMS)
    model.fit(X_train, y_train)

    pred = model.predict(X_test)
    residuals = (y_test - pred).to_numpy()
    residual_quantiles = {
        f"p{q}": float(np.percentile(residuals, q)) for q in (10, 25, 50, 75, 90)
    }

    metrics = {
        "test_year": TEST_YEAR,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "mae": float(mean_absolute_error(y_test, pred)),
        "mape": float(mean_absolute_percentage_error(y_test, pred)),
        "r2": float(r2_score(y_test, pred)),
        "cross_validation": cross_validate(X, y),
        "residual_quantiles": residual_quantiles,
    }

    importances = dict(zip(FEATURE_COLUMNS, model.feature_importances_.astype(float)))

    MODELS_DIR.mkdir(exist_ok=True)
    model.save_model(MODELS_DIR / "demand_model.json")
    (MODELS_DIR / "feature_columns.json").write_text(json.dumps(FEATURE_COLUMNS, indent=2))
    (MODELS_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2))

    print(f"Trained on {metrics['n_train']} rows, tested on {metrics['n_test']} rows ({TEST_YEAR})")
    print(f"  MAE:  {metrics['mae']:.1f} passengers")
    print(f"  MAPE: {metrics['mape']:.2%}")
    print(f"  R2:   {metrics['r2']:.3f}")
    cv = metrics["cross_validation"]
    print(f"\n{N_CV_FOLDS}-fold CV (shuffled, ignores time order):")
    print(f"  MAE:  {cv['mae_mean']:.1f} +/- {cv['mae_std']:.1f}")
    print(f"  MAPE: {cv['mape_mean']:.2%} +/- {cv['mape_std']:.2%}")
    print(f"  R2:   {cv['r2_mean']:.3f} +/- {cv['r2_std']:.3f}")
    print(f"\nHoldout residual quantiles (passengers, actual - predicted): {residual_quantiles}")
    print("\nFeature importances:")
    for name, importance in sorted(importances.items(), key=lambda kv: -kv[1]):
        print(f"  {name:28s} {importance:.3f}")


if __name__ == "__main__":
    main()
