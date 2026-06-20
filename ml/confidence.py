"""
Forecast confidence scoring (realism audit follow-up).

Combines three real, independently-computed signals into one 0-100
confidence_pct for a given demand forecast - replacing the fabricated
"Confidence %" badges removed from the frontend during the realism audit
(see docs/data_methodology.md):

  1. Bootstrap ensemble disagreement (epistemic uncertainty) - how much the
     prediction varies across the bootstrap ensemble (ml/train_demand_model.py
     trains N_BOOTSTRAP models, each on a resample-with-replacement of the
     training rows). High disagreement means the model's answer is
     sensitive to exactly which training rows it happened to see.
  2. Per-route historical reliability (aleatoric uncertainty) - how wide
     this route's real holdout residuals were (models/metrics.json's
     residual_quantiles_by_route), relative to the predicted value. Some
     routes (e.g. DAD, tiny passenger counts) are just noisier to forecast
     than others, independent of model quality.
  3. Extrapolation distance - how far the request is from what the model
     was actually trained on: years beyond the training window
     (train_year_min/max), and how far any input feature (most likely
     avg_fare_usd under an extreme what-if override) falls outside the
     range seen in training (feature_ranges).

None of these are fitted to a labeled "this forecast was right/wrong"
dataset - none exists, since Pacific Wings isn't a real airline with a
track record to grade against. The combination weights below are a
documented, illustrative choice, same as other calibrated-not-fitted
constants elsewhere in this project (e.g. simulation/market_share.py's
betas). What IS real is every input feeding the formula: the bootstrap
spread, the historical residuals, and the training data's actual
year/feature ranges.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = ROOT / "models"
BOOTSTRAP_DIR = MODELS_DIR / "bootstrap"

# Deduction caps and scaling - illustrative combination weights (see module
# docstring), chosen so each signal can meaningfully move the score but none
# can zero it out alone, and the floor/ceiling avoid claiming false
# certainty or impossibility. Calibrated by inspecting real outputs across
# all 5 routes (see PLAN.md) rather than fitted to any ground truth.
MAX_BOOTSTRAP_DEDUCTION = 35.0
MAX_RELIABILITY_DEDUCTION = 40.0
MAX_EXTRAPOLATION_DEDUCTION = 25.0
BOOTSTRAP_CV_SCALE = 120.0
RELIABILITY_SCALE = 60.0
YEARS_BEYOND_SATURATION = 5.0  # extrapolation deduction maxes out this many years outside the training window
FEATURE_OVERSHOOT_NOTE_THRESHOLD = 0.10
CONFIDENCE_FLOOR = 5.0
CONFIDENCE_CEILING = 95.0


class ConfidenceModel:
    def __init__(self) -> None:
        metrics = json.loads((MODELS_DIR / "metrics.json").read_text())
        self.residual_quantiles_pooled = metrics["residual_quantiles"]
        self.residual_quantiles_by_route = metrics["residual_quantiles_by_route"]
        self.feature_ranges = metrics["feature_ranges"]
        self.train_year_min = metrics["train_year_min"]
        self.train_year_max = metrics["train_year_max"]

        self.bootstrap_models: list[xgb.XGBRegressor] = []
        for path in sorted(BOOTSTRAP_DIR.glob("model_*.json"), key=lambda p: p.name):
            model = xgb.XGBRegressor()
            model.load_model(path)
            self.bootstrap_models.append(model)

    def _bootstrap_uncertainty(self, X: pd.DataFrame, predicted: float) -> float:
        if not self.bootstrap_models or predicted <= 0:
            return 0.0
        preds = np.array([model.predict(X)[0] for model in self.bootstrap_models])
        coefficient_of_variation = float(preds.std()) / predicted
        return min(MAX_BOOTSTRAP_DEDUCTION, coefficient_of_variation * BOOTSTRAP_CV_SCALE)

    def _historical_reliability(self, destination: str, predicted: float) -> float:
        rq = self.residual_quantiles_by_route.get(destination, self.residual_quantiles_pooled)
        relative_spread = abs(rq["p90"] - rq["p10"]) / max(predicted, 1.0)
        return min(MAX_RELIABILITY_DEDUCTION, relative_spread * RELIABILITY_SCALE)

    def _extrapolation(self, year: int, features: dict) -> tuple[float, list[str]]:
        notes = []

        years_beyond = max(0, year - self.train_year_max) + max(0, self.train_year_min - year)
        temporal_score = min(1.0, years_beyond / YEARS_BEYOND_SATURATION)
        if years_beyond > 0:
            notes.append(
                f"Forecast year {year} is {years_beyond} year(s) outside the model's "
                f"{self.train_year_min}-{self.train_year_max} training window."
            )

        overshoots = []
        for col, value in features.items():
            rng = self.feature_ranges.get(col)
            if not rng:
                continue
            lo, hi = rng["min"], rng["max"]
            span = hi - lo
            if span <= 0:
                continue
            if value < lo:
                overshoot = (lo - value) / span
            elif value > hi:
                overshoot = (value - hi) / span
            else:
                overshoot = 0.0
            overshoots.append(min(1.0, overshoot))
            if overshoot > FEATURE_OVERSHOOT_NOTE_THRESHOLD:
                notes.append(f"{col}={value:.1f} is outside the training range [{lo:.1f}, {hi:.1f}].")

        feature_score = max(overshoots) if overshoots else 0.0
        combined = min(1.0, 0.5 * temporal_score + 0.5 * feature_score)
        return combined * MAX_EXTRAPOLATION_DEDUCTION, notes

    def score(
        self,
        destination: str,
        year: int,
        features: dict,
        X: pd.DataFrame,
        predicted_passengers: float,
    ) -> dict:
        """
        Args:
            destination: Route IATA code, for the per-route reliability lookup.
            year: Requested forecast year, for the extrapolation check.
            features: The same feature dict passed to the main model (named,
                for range-checking each value).
            X: The same single-row feature DataFrame passed to the main
                model's .predict() - reused here for the bootstrap ensemble.
            predicted_passengers: The main model's point prediction, used to
                express the other two deductions as relative (%) terms.
        """
        bootstrap_deduction = self._bootstrap_uncertainty(X, predicted_passengers)
        reliability_deduction = self._historical_reliability(destination, predicted_passengers)
        extrapolation_deduction, notes = self._extrapolation(year, features)

        confidence = 100.0 - bootstrap_deduction - reliability_deduction - extrapolation_deduction
        confidence = max(CONFIDENCE_FLOOR, min(CONFIDENCE_CEILING, confidence))

        return {
            "confidence_pct": round(confidence, 1),
            "confidence_breakdown": {
                "bootstrap_uncertainty_deduction": round(bootstrap_deduction, 1),
                "historical_reliability_deduction": round(reliability_deduction, 1),
                "extrapolation_deduction": round(extrapolation_deduction, 1),
            },
            "confidence_notes": notes,
        }
