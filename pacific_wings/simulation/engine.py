"""
The deterministic simulation core.

Given a route/month and a set of scenario levers (price, frequency, fuel
price, aircraft swap, service rating), it computes:

    market size          pacific_wings/ml/market_model.py, from real BITRE city-pair data
      x macro growth     pacific_wings/simulation/macro_projections.py
      x fare elasticity  MARKET_FARE_ELASTICITY below
      = addressable market for the month
      x market share     pacific_wings/simulation/market_share.py (QSI multinomial logit)
      = Pacific Wings demand
      capped at capacity x MAX_SELLABLE_LOAD_FACTOR
      = passengers carried, with the remainder reported as spilled

then revenue, cost, profit on the passengers actually carried.

WHY IT IS BUILT THIS WAY. Each strategy lever reaches the P&L through one
named, documented mechanism, rather than through a fitted model's response
to a feature. The previous design predicted Pacific Wings' passengers
directly from a gradient-boosted model, computed market share on a separate
line that nothing consumed, and capped the result at capacity. The
consequences were severe and none of them were visible from the code:

  - adding fourteen weekly flights moved share 9.4% -> 13.5% and carried
    passengers by exactly zero, so no capacity expansion could ever pay
  - a 110x fare increase moved demand 2%, an implied elasticity near zero,
    so profit rose without limit as price rose
  - the model's own target had been built by capping an assumed share at
    capacity, so it had learned the capacity ceiling, not a demand curve

`run_scenario` has no I/O side effects beyond loading static reference data
at construction time, and is a pure function of its inputs.
"""

import math

from pacific_wings import paths
from pacific_wings.ml.confidence import ConfidenceModel
from pacific_wings.ml.features import COUNTRY_ALPHA2_TO_ALPHA3, NOTIONAL_CANDIDATE_FREQUENCY, ReferenceData
from pacific_wings.ml.market_model import MarketModel
from pacific_wings.simulation.cost import WEEKS_PER_MONTH, CostModel
from pacific_wings.simulation.fleet import FleetModel
from pacific_wings.simulation.macro_projections import (
    AVIATION_INCOME_ELASTICITY,
    project_market_size,
    tourism_weight_for,
)
from pacific_wings.simulation.market_share import PACIFIC_WINGS_NAME, PACIFIC_WINGS_RATING, MarketShareModel
from pacific_wings.simulation.revenue import RevenueModel

ROOT = paths.ROOT

# Own-price elasticity of TOTAL market demand. Airline demand elasticity is
# consistently measured between -0.8 and -1.5 (leisure more elastic than
# business, long-haul more elastic than short); -0.8 is the conservative end,
# chosen because the share model below carries the rest of the price response
# - a fare cut both grows the market and wins share from competitors, and
# double-counting the two would overstate the case for discounting. The two
# together put Pacific Wings' own-price elasticity near -1.3.
MARKET_FARE_ELASTICITY = -0.8

# Tourism arrivals drive part of a route's traffic, not all of it: business
# and visiting-friends-and-relatives travel do not move with tourist volume.
# A 20% tourism boom therefore lifts the market ~11%, not 20%.
TOURISM_DEMAND_ELASTICITY = 0.6

# Hard ceiling on the fraction of seats sold, as a physical backstop. Real
# full-service carriers sustain 82-88%. Measured seat utilisation in the BITRE
# data for these corridors: Singapore 0.888, New Zealand 0.832, Japan 0.799,
# Vietnam 0.736. With the spill curve below in place this rarely binds.
MAX_SELLABLE_LOAD_FACTOR = 0.88

# Demand does not arrive evenly across a month's departures. Passengers spill
# from the full ones, and empty seats on the off-peak ones cannot absorb them,
# so a route never carries min(demand, capacity) - it carries less, and the
# shortfall grows as demand approaches the capacity wall.
#
# Expected carried, for departure-level demand distributed around mean D with
# standard deviation SPILL_DEMAND_CV x D, against capacity C:
#
#     E[min(x, C)] = D.PHI(z) - CV.D.phi(z) + C.(1 - PHI(z)),  z = (C - D) / (CV.D)
#
# This replaces a hard `min(demand, capacity x MAX_SELLABLE_LOAD_FACTOR)`. The
# hard clip made passengers_carried literally CONSTANT wherever demand
# exceeded capacity, which was three of five routes at baseline: a fare rise
# moved revenue and nothing else, so profit was a straight line in price and
# the tool's implicit advice was always "charge more, add flights". Melbourne
# gained $230k/month from a 20% fare rise with zero passengers lost.
#
# CV 0.45 is departure-level demand variability within a month - peak/off-peak
# and weekday/weekend spread. It reproduces roughly the load factors the hard
# cap used to produce on today's schedule while leaving every lever able to
# move the answer.
SPILL_DEMAND_CV = 0.45


def expected_passengers_carried(
    demand: float, capacity: float, cv: float = SPILL_DEMAND_CV
) -> float:
    """Passengers carried once spill from full departures is accounted for.

    Strictly increasing in `demand` and strictly below it, so every lever that
    moves demand still moves the P&L - which a hard capacity clip does not.
    """
    if capacity <= 0 or demand <= 0:
        return 0.0
    sigma = cv * demand
    z = (capacity - demand) / sigma
    pdf = math.exp(-0.5 * z * z) / math.sqrt(2 * math.pi)
    cdf = 0.5 * (1 + math.erf(z / math.sqrt(2)))
    carried = demand * cdf - sigma * pdf + capacity * (1 - cdf)
    return min(carried, capacity * MAX_SELLABLE_LOAD_FACTOR)


# Spill below this share of demand is the ordinary unevenness of any schedule,
# not a capacity problem worth flagging on screen.
SPILL_MATERIALITY = 0.02


class SimulationEngine:
    def __init__(self) -> None:
        self.ref = ReferenceData()
        self.cost_model = CostModel()
        self.revenue_model = RevenueModel()
        self.market_share_model = MarketShareModel()
        self.confidence_model = ConfidenceModel()
        self.market_model = MarketModel()
        self.fleet_model = FleetModel()

        # Market growth beyond the last observed year is applied as an
        # explicit macro multiplier (IMF WEO long-run GDP x IATA income
        # elasticity, blended with pre-COVID tourism CAGR) rather than being
        # asked of the market model, which has no way to see a year it was
        # never fitted on.
        self._growth_anchor_year = self.confidence_model.train_year_max
        self._growth_cache: dict[tuple[str, int], float] = {}

    def market_growth_multiplier(self, destination: str, year: int) -> float:
        """Total-addressable-market growth since the last observed year
        (1.0 for years inside the observed window)."""
        if year <= self._growth_anchor_year:
            return 1.0
        key = (destination, year)
        if key not in self._growth_cache:
            route = self.ref.route(destination)
            alpha3 = COUNTRY_ALPHA2_TO_ALPHA3[route["destination_country"]]
            market = project_market_size(
                alpha3,
                float(route["market"]["tourism_arrivals"]),
                int(route["market"]["snapshot_year"]),
                self._growth_anchor_year,
                year,
                tourism_weight=tourism_weight_for(alpha3),
            )
            for y, m in market.items():
                self._growth_cache[(destination, y)] = m["demand_multiplier"]
        return self._growth_cache[key]

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
        gdp_growth_pct_override: float | None = None,
        demand_noise_multiplier: float = 1.0,
    ) -> dict:
        route = self.ref.route(destination)

        base_fare = self.ref.default_avg_fare(destination)
        scenario_fare = base_fare * (1 + price_delta_pct)

        base_frequency = route["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY
        scenario_frequency = max(0, base_frequency + frequency_delta)
        scenario_aircraft = aircraft_type or route["assigned_aircraft"]

        # ---- 1. market size -------------------------------------------------
        # The deployed market model needs a route and a month; the confidence
        # score needs the fare, to tell whether it is outside the observed
        # range. Building the full ten-feature frame here was left over from
        # the XGBoost candidate that lost selection - it cost a DataFrame
        # construction on every Monte Carlo trial to produce nine values
        # nothing read.
        base_market = self.market_model.predict(destination, month)
        confidence = self.confidence_model.score(
            destination, year, month, {"avg_fare_usd": scenario_fare}, base_market
        )

        growth_multiplier = self.market_growth_multiplier(destination, year)

        # Fare moves the size of the market, share moves who carries it.
        fare_multiplier = (
            (scenario_fare / base_fare) ** MARKET_FARE_ELASTICITY if base_fare > 0 and scenario_fare > 0 else 1.0
        )
        tourism_multiplier = tourism_arrivals_multiplier**TOURISM_DEMAND_ELASTICITY

        # A GDP-growth shock (Monte Carlo, or a manual override) moves the
        # market through the IATA income elasticity, as a one-year level
        # effect relative to the route's baseline growth rate.
        gdp_multiplier = 1.0
        if gdp_growth_pct_override is not None:
            baseline_growth = float(route["market"]["gdp_growth_pct"])
            gdp_multiplier = max(
                0.0, 1 + (gdp_growth_pct_override - baseline_growth) / 100
            ) ** AVIATION_INCOME_ELASTICITY

        market_passengers = (
            base_market
            * growth_multiplier
            * fare_multiplier
            * tourism_multiplier
            * gdp_multiplier
            * demand_noise_multiplier
        )

        # ---- 2. share of it -------------------------------------------------
        market_share = self.market_share_model.compute(
            destination,
            own_price=scenario_fare,
            own_frequency=scenario_frequency,
            own_rating=PACIFIC_WINGS_RATING + rating_delta,
            extra_competitors=extra_competitors,
        )
        own_demand = market_passengers * market_share["pacific_wings_share"]

        # Can the airline actually fly this schedule? Reported, not enforced:
        # "you need 11 A321neos and you have 3" is the useful answer to a
        # growth scenario, and refusing to price it is not.
        fleet = self.fleet_model.check(destination, scenario_aircraft, scenario_frequency)

        # ---- 3. what can actually be flown ----------------------------------
        capacity_monthly = self.ref.capacity_monthly(
            destination, aircraft_type=scenario_aircraft, weekly_frequency=scenario_frequency
        )
        sellable = capacity_monthly * MAX_SELLABLE_LOAD_FACTOR
        passengers_carried = expected_passengers_carried(own_demand, capacity_monthly)
        spilled = max(0.0, own_demand - passengers_carried)
        load_factor = passengers_carried / capacity_monthly if capacity_monthly > 0 else 0.0

        revenue = self.revenue_model.monthly_revenue(
            destination, passengers_carried, scenario_fare, aircraft_type=scenario_aircraft
        )
        cost = self.cost_model.monthly_cost(
            destination,
            fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
            weekly_frequency=scenario_frequency,
            aircraft_type=scenario_aircraft,
            year=year,
        )
        profit_usd = round(revenue["total_revenue_usd"] - cost["total_cost_usd"], 2)

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
                "market_passengers": round(market_passengers),
                "market_multipliers": {
                    "macro_growth": round(growth_multiplier, 4),
                    "fare_elasticity": round(fare_multiplier, 4),
                    "tourism": round(tourism_multiplier, 4),
                    "gdp_shock": round(gdp_multiplier, 4),
                },
                "predicted_demand_passengers": round(own_demand),
                "capacity_monthly": round(capacity_monthly),
                "sellable_seats": round(sellable),
                "passengers_carried": round(passengers_carried),
                "spilled_passengers": round(spilled),
                "load_factor": round(load_factor, 4),
                "demand_constrained_by_capacity": spilled > SPILL_MATERIALITY * own_demand,
                **confidence,
            },
            "revenue": revenue,
            "cost": cost,
            "profit_usd": profit_usd,
            "market_share": market_share,
            "fleet": fleet,
        }

    def run_open_route(
        self,
        destination: str,
        market_passengers_annual: float,
        distance_km: float,
        aircraft_type: str,
        weekly_frequency: int,
        economy_fare_usd: float,
        reference_fare_usd: float,
        competitors: list[dict],
        fuel_price_usd_per_gallon: float | None = None,
        rating_delta: float = 0.0,
    ) -> dict:
        """The same allocation and financials as `run_scenario`, for a route
        that is not in the airline profile yet.

        This exists so pacific_wings/analysis/open_route.py can screen a proposed
        destination without reimplementing the pipeline. It previously had its
        own market model, its own share heuristic, its own load-factor target
        and its own fuel/revenue arithmetic, and the two engines returned
        opposite verdicts on the same route - Da Nang came back as +$4.9M/yr
        PROCEED from one and -$9.9M/yr from the other.

        Figures are monthly, on an average month: a screening estimate has no
        month to be asked about.
        """
        route_override = {
            "distance_km": distance_km,
            "assigned_aircraft": aircraft_type,
            "weekly_frequency": weekly_frequency,
        }
        seats = self.ref.fleet_by_type[aircraft_type]["seats"]["total"]

        monthly_market = market_passengers_annual / 12
        if reference_fare_usd > 0 and economy_fare_usd > 0:
            monthly_market *= (economy_fare_usd / reference_fare_usd) ** MARKET_FARE_ELASTICITY

        share = self.market_share_model.shares_from_carriers(
            [
                {
                    "name": PACIFIC_WINGS_NAME,
                    "price": economy_fare_usd,
                    "weekly_frequency": weekly_frequency,
                    "rating": PACIFIC_WINGS_RATING + rating_delta,
                }
            ]
            + competitors
        )
        own_demand = monthly_market * share["pacific_wings_share"]

        capacity_monthly = seats * weekly_frequency * WEEKS_PER_MONTH
        sellable = capacity_monthly * MAX_SELLABLE_LOAD_FACTOR
        passengers_carried = expected_passengers_carried(own_demand, capacity_monthly)
        spilled = max(0.0, own_demand - passengers_carried)
        load_factor = passengers_carried / capacity_monthly if capacity_monthly > 0 else 0.0

        revenue = self.revenue_model.monthly_revenue(
            destination, passengers_carried, economy_fare_usd, route_override=route_override
        )
        cost = self.cost_model.monthly_cost(
            destination,
            fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
            weekly_frequency=weekly_frequency,
            aircraft_type=aircraft_type,
            route_override=route_override,
        )

        return {
            "market_passengers_monthly": monthly_market,
            "market_share": share,
            "own_demand_monthly": own_demand,
            "capacity_monthly": capacity_monthly,
            "sellable_seats": sellable,
            "passengers_carried": passengers_carried,
            "spilled_passengers": spilled,
            "load_factor": load_factor,
            "revenue": revenue,
            "cost": cost,
            "profit_usd": round(revenue["total_revenue_usd"] - cost["total_cost_usd"], 2),
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
                "spilled_passengers": scenario["demand"]["spilled_passengers"]
                - baseline["demand"]["spilled_passengers"],
                "pacific_wings_share": round(
                    scenario["market_share"]["pacific_wings_share"]
                    - baseline["market_share"]["pacific_wings_share"],
                    4,
                ),
                "fleet_feasible": scenario["fleet"]["feasible"],
            },
        }
