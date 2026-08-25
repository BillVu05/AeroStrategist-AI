"""
Market share model: how the route's total market splits between Pacific
Wings and its real competitors (data/processed/competitors.csv, see
etl/generate_synthetic_demand.py for sourcing).

This is the model that turns market size into Pacific Wings passengers.
`pacific_wings/simulation/engine.py` multiplies the two - it is not a display-only number.
(It used to be: the engine computed share on one line and passengers on
another, and nothing connected them, so adding fourteen weekly flights moved
modeled share from 9.4% to 13.5% and carried passengers by exactly zero.)

    utility_i = BETA_LN_FREQUENCY * ln(frequency_i)
              - BETA_LN_PRICE     * ln(price_i)
              + BETA_RATING       * rating_i
    share_i   = exp(utility_i) / sum_j exp(utility_j)

This is the standard airline QSI (Quality of Service Index) form: a
multinomial logit whose terms are logs of frequency and price, so both act
on proportional rather than absolute differences. Fares span $27 to $755
across these routes and frequencies span 5 to 259 a week; a linear term in
either would let the densest domestic trunk route swamp every other factor.

BETA_LN_FREQUENCY = 1.15 is the S-curve exponent: at exactly 1.0 share is
proportional to frequency share, which is the core empirical regularity QSI
models are built around, and the observed effect on competitive routes is
slightly stronger than proportional. It sat at 1.0 while BETA_RATING carried
the difference; halving BETA_RATING (below) moved that work here, where it is
better evidenced.

CALIBRATION. These are calibrated constants, not fitted ones - route-level
market share is not public, so there is nothing to fit against. They were
chosen against the one real benchmark available (BITRE country-level
Australia-Singapore traffic, data/raw/, which puts Singapore Airlines near
60% of the SYD-SIN market) plus the requirement that every route produce a
plausible split. The __main__ self-check below re-asserts both.

An earlier calibration used log1p(frequency) with BETA_FREQUENCY=0.4 and
BETA_RATING=1.8. Rating dominated everything: Pacific Wings held 13.3% of
SYD-MEL on 14 weekly flights against 574 from Qantas, Virgin and Jetstar,
and a carrier with zero flights still scored 4.3% share, because log1p(0)
zeroes only the frequency term while the rating term keeps it in the market.
"""

import math

import pandas as pd

from pacific_wings import paths

ROOT = paths.ROOT

BETA_LN_FREQUENCY = 1.15
BETA_LN_PRICE = 0.5
# 0.8 made one star a 2.2x swing in utility - the strongest lever in the whole
# model, driven by rounded public star ratings and Pacific Wings' own invented
# 4.1. Halved: a star is now a 1.5x swing, which keeps rating meaningful
# without letting a subjective, one-decimal input outweigh price and frequency.
BETA_RATING = 0.4

PACIFIC_WINGS_NAME = "Pacific Wings"
PACIFIC_WINGS_RATING = 4.1

# A route with no nonstop competitor is not an uncontested market. Sydney-Da
# Nang has no direct service, but the traffic exists and flies today via
# Singapore, Hong Kong and Bangkok. Modelling those connections away handed
# Pacific Wings 100% share of every candidate route - the most optimistic
# possible assumption applied exactly where the evidence is weakest.
#
# The connecting alternative is cheap and plentiful but a materially worse
# product, which is why a nonstop entrant can take a large minority of the
# market rather than all or none of it:
#   - fare 15% below nonstop (the discount connections must offer)
#   - abundant frequency (several viable hub itineraries a day)
#   - an explicit utility penalty for the layover, the missed-connection risk,
#     the baggage re-check and the extra journey hours
#
# That penalty used to be smuggled in as a low service rating, which conflated
# two different things on one axis: halving BETA_RATING for its own good
# reasons (it was the strongest lever in the model) silently made connecting
# itineraries more attractive and cut candidate-route share by more than half.
# Product form and service quality are now separate terms.
CONNECTING_COMPETITOR_NAME = "Connecting itineraries (via hubs)"
CONNECTING_FARE_RATIO = 0.85
CONNECTING_WEEKLY_FREQUENCY = 56
CONNECTING_RATING = 3.5
# Utility cost of breaking the journey, on the same scale as the terms above -
# roughly the equivalent of losing four service-rating points. Calibrated so a
# 3x weekly nonstop takes a mid-teens share of a market flown today only via
# hubs: a material minority, which is what a new nonstop entrant actually wins.
CONNECTING_UTILITY_PENALTY = 1.5

# How wide the guess is. BETA_LN_FREQUENCY = 1.0 makes share proportional to
# frequency share, so this one integer IS the answer on any unserved route:
# Da Nang came back at 41.5% share on 14/week and 6.6% on 140/week, and every
# candidate-route business case in the product moved with it. Sydney-Da Nang
# connects via Singapore, Hong Kong, Bangkok, Kuala Lumpur, Seoul and Taipei,
# so the shipped 28/week - four itineraries a day - was far too generous to
# Pacific Wings; 56 is the point estimate now, and callers get the low/high
# band alongside it rather than a bare number.
#
# Replace all three with per-route hub schedules when a source for them exists.
CONNECTING_WEEKLY_FREQUENCY_RANGE = (14, 140)

# A carrier with no departures is not in the choice set at all. Guarding this
# explicitly rather than relying on ln(0) -> -inf keeps the zero-frequency
# scenario (frequency_delta below current service) from producing NaN shares.
MIN_FREQUENCY = 1e-9


def connecting_alternative(nonstop_price: float) -> dict:
    """The one-stop option a passenger has when nobody flies the route direct.

    Used for candidate routes with no nonstop competitor, so that entering an
    unserved market means winning traffic away from connections rather than
    inheriting the whole market by default.
    """
    return {
        "name": CONNECTING_COMPETITOR_NAME,
        "price": max(1.0, nonstop_price * CONNECTING_FARE_RATIO),
        "weekly_frequency": CONNECTING_WEEKLY_FREQUENCY,
        "rating": CONNECTING_RATING,
        "utility_penalty": CONNECTING_UTILITY_PENALTY,
    }


class MarketShareModel:
    def __init__(self) -> None:
        self.competitors = pd.read_csv(ROOT / "data" / "processed" / "competitors.csv")

    def _utility(
        self, price: float, weekly_frequency: float, rating: float, penalty: float = 0.0
    ) -> float:
        """`penalty` is a product-form cost, not a service-quality one - today
        only the connecting itinerary carries it."""
        return (
            BETA_LN_FREQUENCY * math.log(max(weekly_frequency, MIN_FREQUENCY))
            - BETA_LN_PRICE * math.log(max(price, 1.0))
            + BETA_RATING * rating
            - penalty
        )

    def carriers_on(
        self,
        destination: str,
        extra_competitors: list[dict] | None = None,
        own_price: float = 0.0,
    ) -> list[dict]:
        """Every competing carrier on the route: real, scenario-added, and -
        where no nonstop competitor exists - the connecting alternative."""
        comp = self.competitors[self.competitors["destination"] == destination]
        carriers = [
            {
                "name": row.competitor_name,
                "price": float(row.avg_fare_usd),
                "weekly_frequency": float(row.weekly_frequency),
                "rating": float(row.rating),
            }
            for row in comp.itertuples()
        ]
        if not carriers:
            carriers.append(connecting_alternative(own_price))
        carriers.extend(extra_competitors or [])
        return carriers

    def compute(
        self,
        destination: str,
        own_price: float,
        own_frequency: float,
        own_rating: float = PACIFIC_WINGS_RATING,
        extra_competitors: list[dict] | None = None,
    ) -> dict:
        carriers = [
            {
                "name": PACIFIC_WINGS_NAME,
                "price": own_price,
                "weekly_frequency": own_frequency,
                "rating": own_rating,
            }
        ] + self.carriers_on(destination, extra_competitors, own_price=own_price)

        result = self.shares_from_carriers(carriers)

        # On a route contested only by connections, report how far the answer
        # moves across the plausible range of that assumption (F-04) - a bare
        # point estimate hides that it is the single most load-bearing number
        # in any candidate-route case.
        if any(c["name"] == CONNECTING_COMPETITOR_NAME for c in carriers):
            band = []
            for frequency in CONNECTING_WEEKLY_FREQUENCY_RANGE:
                varied = [
                    {**c, "weekly_frequency": frequency}
                    if c["name"] == CONNECTING_COMPETITOR_NAME
                    else c
                    for c in carriers
                ]
                band.append(self.shares_from_carriers(varied)["pacific_wings_share"])
            result["pacific_wings_share_range"] = [min(band), max(band)]
            result["share_range_note"] = (
                "No carrier flies this route nonstop, so share is set against an assumed "
                f"{CONNECTING_WEEKLY_FREQUENCY}/week of connecting itineraries. The range spans "
                f"{CONNECTING_WEEKLY_FREQUENCY_RANGE[0]}-{CONNECTING_WEEKLY_FREQUENCY_RANGE[1]}/week; "
                "it is an assumption, not an observation."
            )

        return result

    def shares_from_carriers(self, carriers: list[dict]) -> dict:
        """Split the market across an explicit carrier list.

        Exposed separately so pacific_wings/analysis/open_route.py can score a
        proposed new route with the same logit instead of its own heuristic.
        There used to be three different market-share models in this repo -
        this one, a `_new_entrant_share` formula for open routes, and a third
        assumption baked into the training labels - and they disagreed by up
        to $14.8M a year on the same route.
        """
        # Carriers not actually operating are excluded rather than given a
        # floor share. If Pacific Wings is the one grounded, its share is 0.
        flying = [c for c in carriers if c["weekly_frequency"] > 0]
        if not flying:
            return {"pacific_wings_share": 0.0, "shares_by_carrier": {}}

        exp_utilities = [
            math.exp(
                self._utility(
                    c["price"], c["weekly_frequency"], c["rating"], c.get("utility_penalty", 0.0)
                )
            )
            for c in flying
        ]
        total = sum(exp_utilities)
        shares = {c["name"]: round(eu / total, 4) for c, eu in zip(flying, exp_utilities)}

        return {
            "pacific_wings_share": shares.get(PACIFIC_WINGS_NAME, 0.0),
            "shares_by_carrier": shares,
        }


if __name__ == "__main__":
    m = MarketShareModel()

    # 1. The real benchmark: Singapore Airlines near its ~60% reported share
    #    of the Australia-Singapore market.
    sin = m.compute("SIN", own_price=454, own_frequency=7)
    sq = sin["shares_by_carrier"]["Singapore Airlines"]
    assert 0.45 < sq < 0.70, sin["shares_by_carrier"]

    # 2. A small carrier on a dense trunk route gets a small share. Pacific
    #    Wings flies 14 of 588 weekly departures on SYD-MEL; the old
    #    calibration handed it 13.3%.
    mel = m.compute("MEL", own_price=143, own_frequency=14)
    assert 0.01 < mel["pacific_wings_share"] < 0.08, mel["shares_by_carrier"]

    # 3. Frequency moves share, monotonically, and a grounded carrier has none.
    shares = [m.compute("SIN", own_price=454, own_frequency=f)["pacific_wings_share"]
              for f in (3, 7, 14, 28)]
    assert all(b > a for a, b in zip(shares, shares[1:])), shares
    assert m.compute("SIN", own_price=454, own_frequency=0)["pacific_wings_share"] == 0.0

    # 4. Undercutting the market gains share; charging more loses it.
    cheap = m.compute("SIN", own_price=300, own_frequency=7)["pacific_wings_share"]
    dear = m.compute("SIN", own_price=700, own_frequency=7)["pacific_wings_share"]
    assert cheap > sin["pacific_wings_share"] > dear, (cheap, dear)

    # 5. An unserved route is contested by connections, not handed over whole.
    dad = m.compute("DAD", own_price=562, own_frequency=3)
    assert 0.10 < dad["pacific_wings_share"] < 0.45, dad["shares_by_carrier"]

    print(f"market_share self-check OK (SQ={sq:.0%}, PW on SIN={sin['pacific_wings_share']:.1%}, "
          f"PW on MEL={mel['pacific_wings_share']:.1%}, PW on DAD={dad['pacific_wings_share']:.1%})")
    for route, freq, fare in (("SIN", 7, 454), ("HND", 5, 472), ("MEL", 14, 143), ("AKL", 7, 217), ("DAD", 3, 562)):
        r = m.compute(route, own_price=fare, own_frequency=freq)
        print(f"  {route}: " + "  ".join(f"{n} {s:.0%}" for n, s in r["shares_by_carrier"].items()))
