"""
Phase 6 market share model.

A multinomial logit ("attraction") model over Pacific Wings and its real
competitors in data/processed/competitors.csv (see etl/generate_synthetic_demand.py
for sourcing), using price, weekly frequency, and a service rating. This is a
simulation component for relative what-if comparisons (e.g. "what if we cut
fares 10%?"), not a model fitted to real market-share data - real route-level
market share isn't publicly available.

    utility_i = BETA_PRICE * price_i + BETA_FREQUENCY * log1p(weekly_frequency_i) + BETA_RATING * rating_i
    share_i   = exp(utility_i) / sum_j(exp(utility_j))

Frequency enters as log1p(frequency) rather than raw frequency - standard in
airline QSI (Quality of Service Index) market-share modeling - because real
weekly frequencies span almost two orders of magnitude across these routes
(SYD-DAD: 0 vs SYD-MEL: Qantas alone ~259/week), and a linear term would let
the densest domestic trunk route swamp every other factor.
"""

import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]

# Calibration constants - illustrative, chosen so that price, frequency, and
# rating each have a visible but not dominant effect on share for the
# magnitudes seen in this dataset (fares ~$25-720, frequencies ~3-259/week,
# ratings: real Skytrax star ratings, 3-5). Real fares span a much wider range
# than the old synthetic set ($100-500), so BETA_PRICE is rescaled down from
# -0.01 (same reasoning as the frequency log1p change above). Sanity-checked
# against the one real benchmark available (BITRE country-level AU-Singapore
# traffic shares, data/raw/): this calibration puts Singapore Airlines at
# ~61% modeled share on SYD-SIN vs. its real ~60% reported share - not a
# fitted model, but a useful cross-check that the magnitudes are sane.
BETA_PRICE = -0.002
BETA_FREQUENCY = 0.4
BETA_RATING = 1.8

PACIFIC_WINGS_NAME = "Pacific Wings"
PACIFIC_WINGS_RATING = 4.1


class MarketShareModel:
    def __init__(self) -> None:
        self.competitors = pd.read_csv(ROOT / "data" / "processed" / "competitors.csv")

    def _utility(self, price: float, weekly_frequency: float, rating: float) -> float:
        return BETA_PRICE * price + BETA_FREQUENCY * math.log1p(weekly_frequency) + BETA_RATING * rating

    def compute(
        self,
        destination: str,
        own_price: float,
        own_frequency: float,
        own_rating: float = PACIFIC_WINGS_RATING,
        extra_competitors: list[dict] | None = None,
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
        for extra in extra_competitors or []:
            carriers.append(
                {
                    "name": extra["name"],
                    "price": extra["price"],
                    "weekly_frequency": extra["weekly_frequency"],
                    "rating": extra["rating"],
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
