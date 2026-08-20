"""
Forecast confidence scoring: one 0-100 number for a given market forecast,
built from three real signals.

  1. RESAMPLING SPREAD (epistemic). models/bootstrap.json holds, per route
     and month, the coefficient of variation of the market model refitted on
     N resamples-with-replacement of the observed rows. High spread means the
     answer depends heavily on exactly which months happened to be observed.
  2. HISTORICAL RELIABILITY (aleatoric). How wide this route's out-of-fold
     residuals were (models/metrics.json's residual_quantiles_by_route),
     relative to the prediction. Some routes are simply noisier.
  3. EXTRAPOLATION DISTANCE. How far the request sits outside what was
     actually observed - years beyond the training window, and fares beyond
     the trained range.

None of these are fitted to a labeled "this forecast was right" dataset -
none exists, since Pacific Wings has no track record to grade against. The
combination weights are a documented, illustrative choice, in the same
spirit as pacific_wings/simulation/market_share.py's betas. What is real is every input:
the resampling spread, the out-of-fold residuals, and the observed ranges.

The extrapolation term is deliberately UNCAPPED. It used to saturate five
years out and contribute at most 25 points, which meant a forecast for the
year 2100 returned 84.6% confidence - and so did one for 1900, since the
distance term treated them identically. Both scored above a real, in-window
2026 forecast for a route with real data. A tool that declines to answer is
more useful than one that answers the year 2100 at 85% confidence.
"""

import json

from pacific_wings import paths

ROOT = paths.ROOT
MODELS_DIR = ROOT / "models"

# Bounded signals: neither can zero the score alone.
MAX_SPREAD_DEDUCTION = 35.0
MAX_RELIABILITY_DEDUCTION = 40.0
SPREAD_CV_SCALE = 120.0
RELIABILITY_SCALE = 60.0

# Unbounded signal. 12 points per year outside the observed window means
# confidence from this term alone is spent after ~8 years, and a request for
# 2100 floors immediately rather than reporting a comfortable 85%.
EXTRAPOLATION_PER_YEAR = 12.0
# A fare at twice the observed range costs a full 100 points on its own.
EXTRAPOLATION_PER_FARE_MULTIPLE = 100.0
FARE_OVERSHOOT_NOTE_THRESHOLD = 0.05

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

        bootstrap_path = MODELS_DIR / "bootstrap.json"
        self.spread_by_route_month = (
            json.loads(bootstrap_path.read_text()) if bootstrap_path.exists() else {}
        )

    def _resampling_spread(self, destination: str, month: int) -> float:
        route = self.spread_by_route_month.get(destination)
        if not route:
            return 0.0
        coefficient_of_variation = float(route.get(str(month), 0.0))
        return min(MAX_SPREAD_DEDUCTION, coefficient_of_variation * SPREAD_CV_SCALE)

    def _historical_reliability(self, destination: str, predicted: float) -> float:
        rq = self.residual_quantiles_by_route.get(destination, self.residual_quantiles_pooled)
        relative_spread = abs(rq["p90"] - rq["p10"]) / max(predicted, 1.0)
        return min(MAX_RELIABILITY_DEDUCTION, relative_spread * RELIABILITY_SCALE)

    def _extrapolation(self, year: int, features: dict) -> tuple[float, list[str]]:
        notes = []

        years_beyond = max(0, year - self.train_year_max) + max(0, self.train_year_min - year)
        deduction = years_beyond * EXTRAPOLATION_PER_YEAR
        if years_beyond:
            notes.append(
                f"Forecast year {year} is {years_beyond} year(s) outside the observed "
                f"{self.train_year_min}-{self.train_year_max} window."
            )

        # Only the fare is a caller-controlled feature that can leave the
        # observed range; the rest move with the calendar, and the year term
        # above already accounts for those.
        fare_range = self.feature_ranges.get("avg_fare_usd")
        fare = features.get("avg_fare_usd")
        if fare_range and fare is not None:
            lo, hi = fare_range["min"], fare_range["max"]
            span = hi - lo
            overshoot = 0.0
            if span > 0:
                if fare < lo:
                    overshoot = (lo - fare) / span
                elif fare > hi:
                    overshoot = (fare - hi) / span
            deduction += overshoot * EXTRAPOLATION_PER_FARE_MULTIPLE
            if overshoot > FARE_OVERSHOOT_NOTE_THRESHOLD:
                notes.append(
                    f"Fare ${fare:,.0f} is outside the observed range "
                    f"${lo:,.0f}-${hi:,.0f}; the elasticity assumption is doing all the work."
                )

        return deduction, notes

    def score(
        self,
        destination: str,
        year: int,
        month: int,
        features: dict,
        predicted_market: float,
    ) -> dict:
        """
        Args:
            destination: Route IATA code, for the per-route lookups.
            year: Requested forecast year, for the extrapolation check.
            month: Requested month, for the resampling-spread lookup.
            features: The feature dict for this request, range-checked here.
            predicted_market: The point prediction, used to express the
                reliability deduction in relative terms.
        """
        spread_deduction = self._resampling_spread(destination, month)
        reliability_deduction = self._historical_reliability(destination, predicted_market)
        extrapolation_deduction, notes = self._extrapolation(year, features)

        confidence = 100.0 - spread_deduction - reliability_deduction - extrapolation_deduction
        confidence = max(CONFIDENCE_FLOOR, min(CONFIDENCE_CEILING, confidence))

        if confidence <= CONFIDENCE_FLOOR:
            notes.append(
                "Confidence is at the floor: this request is far enough outside the "
                "observed data that the figures are an extrapolation, not a forecast."
            )

        return {
            "confidence_pct": round(confidence, 1),
            "confidence_breakdown": {
                "resampling_spread_deduction": round(spread_deduction, 1),
                "historical_reliability_deduction": round(reliability_deduction, 1),
                "extrapolation_deduction": round(extrapolation_deduction, 1),
            },
            "confidence_notes": notes,
        }


if __name__ == "__main__":
    c = ConfidenceModel()
    base = {"avg_fare_usd": 454.0}

    in_window = c.score("SIN", c.train_year_max, 7, base, 70_000)["confidence_pct"]
    near = c.score("SIN", c.train_year_max + 2, 7, base, 70_000)["confidence_pct"]
    far = c.score("SIN", 2100, 7, base, 70_000)["confidence_pct"]
    past = c.score("SIN", 1900, 7, base, 70_000)["confidence_pct"]
    wild_fare = c.score("SIN", c.train_year_max, 7, {"avg_fare_usd": 5000.0}, 70_000)["confidence_pct"]

    # Confidence must fall monotonically with distance from the data, and
    # absurd requests must bottom out rather than plateau in the 80s.
    assert in_window > near > far, (in_window, near, far)
    assert far == past == CONFIDENCE_FLOOR, (far, past)
    assert wild_fare == CONFIDENCE_FLOOR, wild_fare
    print(f"confidence self-check OK (in-window {in_window}, +2yr {near}, 2100 {far}, $5k fare {wild_fare})")
