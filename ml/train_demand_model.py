"""
Train an XGBoost regressor to forecast monthly route passenger demand
(Phase 3), using real distance/macro/competitor features plus the route's
own average fare and month, against the synthetic `demand_observations`
ground truth.

Because the target is generated from a known formula
(etl/generate_synthetic_demand.py), the reported test-set accuracy reflects
how well the model recovers that generating function from features alone -
this is documented explicitly rather than presented as "real-world" accuracy.

Train/test split is time-based: train on 2022-2023, test on 2024, so the
model is evaluated on its ability to forecast a future, unseen year.

Usage:
    python ml/train_demand_model.py

Outputs:
    models/demand_model.json     XGBoost model (native format)
    models/feature_columns.json  Ordered feature column names
    models/metrics.json          Evaluation metrics on the 2024 holdout
"""

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error, r2_score
from sqlalchemy import create_engine

from features import FEATURE_COLUMNS, ReferenceData

ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = ROOT / "models"

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg2://airline:airline@localhost:5432/airline_sim"
)

TEST_YEAR = 2024


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

    model = xgb.XGBRegressor(
        n_estimators=150,
        max_depth=3,
        learning_rate=0.1,
        subsample=0.9,
        colsample_bytree=0.9,
        random_state=42,
    )
    model.fit(X_train, y_train)

    pred = model.predict(X_test)
    metrics = {
        "test_year": TEST_YEAR,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "mae": float(mean_absolute_error(y_test, pred)),
        "mape": float(mean_absolute_percentage_error(y_test, pred)),
        "r2": float(r2_score(y_test, pred)),
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
    print("\nFeature importances:")
    for name, importance in sorted(importances.items(), key=lambda kv: -kv[1]):
        print(f"  {name:28s} {importance:.3f}")


if __name__ == "__main__":
    main()
