"""
Phase 6 market share model.

Synthetic-but-feature-driven: a multinomial logit ("attraction") model over
Pacific Wings and the synthetic competitors in
data/processed/competitors.csv, using price, weekly frequency, and a service
rating. This is a simulation component for relative what-if comparisons
(e.g. "what if we cut fares 10%?"), not a model fitted to real market-share
data - real route-level market share isn't publicly available.

    utility_i = BETA_PRICE * price_i + BETA_FREQUENCY * weekly_frequency_i + BETA_RATING * rating_i
    share_i   = exp(utility_i) / sum_j(exp(utility_j))
"""

import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]

# Calibration constants - illustrative, chosen so that price, frequency, and
# rating each have a visible but not dominant effect on share for the
# magnitudes seen in this dataset (fares ~$100-500, frequencies ~3-21/week,
# ratings ~3.8-4.3).
BETA_PRICE = -0.01
BETA_FREQUENCY = 0.15
BETA_RATING = 1.0

PACIFIC_WINGS_NAME = "Pacific Wings"
PACIFIC_WINGS_RATING = 4.1


class MarketShareModel:
    def __init__(self) -> None:
        self.competitors = pd.read_csv(ROOT / "data" / "processed" / "competitors.csv")

    def _utility(self, price: float, weekly_frequency: float, rating: float) -> float:
        return BETA_PRICE * price + BETA_FREQUENCY * weekly_frequency + BETA_RATING * rating

    def compute(
        self,
        destination: str,
        own_price: float,
        own_frequency: float,
        own_rating: float = PACIFIC_WINGS_RATING,
    ) -> dict:
        comp = self.competitors[self.competitors["destination"] == destination]

        carriers = [
            {
                "name": PACIFIC_WINGS_NAME,
                "price": own_price,
                "weekly_frequency": own_frequency,
                "rating": own_rating,
            }
        ]
        for row in comp.itertuples():
            carriers.append(
                {
                    "name": row.competitor_name,
                    "price": row.avg_fare_usd,
                    "weekly_frequency": row.weekly_frequency,
                    "rating": row.rating,
                }
            )

        utilities = [self._utility(c["price"], c["weekly_frequency"], c["rating"]) for c in carriers]
        exp_utilities = [math.exp(u) for u in utilities]
        total = sum(exp_utilities)

        shares = {c["name"]: round(eu / total, 4) for c, eu in zip(carriers, exp_utilities)}

        return {
            "pacific_wings_share": shares[PACIFIC_WINGS_NAME],
            "shares_by_carrier": shares,
        }
