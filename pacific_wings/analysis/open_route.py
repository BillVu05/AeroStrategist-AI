"""
Open-route analysis engine for any worldwide destination.

Enables strategic evaluation of any airline route Pacific Wings might consider
— not limited to its existing five routes. Works from first principles using:

  1. World airport database + haversine distance from SYD (world_airports.py)
  2. Country macro table: GDP, population, 2019 tourism baseline
  3. Gravity model for total bilateral market size estimation
  4. Reference-route scaling: calibrated against known Pacific Wings routes
  5. Aircraft selection & range feasibility check
  6. Cost model adapted for arbitrary distance/frequency
  7. Revenue model using cabin mix from aircraft specs
  8. Multi-factor scoring: demand, financials, risk, strategic value

All financial figures are ORDER-OF-MAGNITUDE ESTIMATES suitable for
strategic screening — not operational forecasts. Confidence bands are
provided to communicate uncertainty. Use the simulation engine (engine.py)
for precise analysis of routes already in the Pacific Wings network.
"""

import json
import math

from pacific_wings import paths
from pacific_wings.analysis.world_airports import (
    lookup_airport,
    search_airports,
)
from pacific_wings.ml.features import ReferenceData
from pacific_wings.ml.market_model import MarketModel
from pacific_wings.simulation.cost import (
    BLOCK_TIME_OVERHEAD_H,
    WEEKS_PER_MONTH,
    CostModel,
    latest_fuel_price,
)
from pacific_wings.simulation.engine import (
    MARKET_FARE_ELASTICITY,
    MAX_SELLABLE_LOAD_FACTOR,
    SimulationEngine,
)
from pacific_wings.simulation.fleet import FleetModel, aircraft_in_range, usable_range_km
from pacific_wings.simulation.market_share import (
    MarketShareModel,
    connecting_alternative,
)
from pacific_wings.simulation.revenue import CABIN_FARE_MULTIPLIERS, CABIN_FILL_WEIGHTS, ancillary_per_pax_usd

# ─── constants ────────────────────────────────────────────────────────────────

KG_PER_GALLON = 3.03
# Fuel default comes from the same reference series the simulator uses, so a
# screening run and a scenario run price fuel identically.
BASELINE_FUEL_USD_PER_GAL = latest_fuel_price()

# Compare at most this many candidates in one call: each one is a full gravity
# + financial + risk screen.
MAX_COMPARISON_DESTINATIONS = 8

# ─── aircraft specs (mirrors aircraft_specs.json) ────────────────────────────

_specs_raw = json.loads(paths.AIRCRAFT_SPECS.read_text(encoding="utf-8"))["aircraft"]
AIRCRAFT: dict[str, dict] = {ac["type"]: ac for ac in _specs_raw}

# Calibrated per-ASK/per-departure non-fuel cost split (pacific_wings/simulation/cost.py).
_COST_MODEL = CostModel()
_FLEET = FleetModel()

def _select_aircraft(distance_km: float) -> str:
    """Smallest type in the fleet whose USABLE range covers the sector.

    Usable range is the shared derate in simulation/fleet.py, so the screener
    and the airline profile can no longer disagree about what can fly a route
    - the profile had Da Nang (7,183 km) on an A321neo that neither this
    function nor the range check would have allowed.
    """
    for aircraft in sorted(AIRCRAFT.values(), key=lambda a: a["seats"]["total"]):
        if aircraft_in_range(aircraft, distance_km):
            return aircraft["type"]
    return max(AIRCRAFT.values(), key=lambda a: a["range_km"])["type"]

# ─── gravity model calibration (against known Pacific Wings routes) ───────────
#
# We calibrate on the four active routes using the simulation engine's
# outputs and then scale to new destinations.  Two reference points cover
# the key distance bands:
#   - Short/medium (<4 000 km): MEL reference  pax≈170 000 annual (domestic)
#   - Long-haul (>4 000 km):    SIN reference  pax≈64 000 annual (international)
#
# Gravity formula used for total bilateral market (all carriers):
#   market_pax_annual = k × (gdp_a × gdp_b)^α / distance^β
#
# Pacific Wings share from that market:
#   own_pax = market_pax × share_factor
#
# share_factor: new entrant typically captures 15-20% of a mature market
# on launch, growing to 25-35% with regular service.

GDP_AUS_B = 1757.0        # Australia 2024 GDP (billions USD)

# ── Market size reference: calibrated against the SYD-SIN city pair ──────────
# 840,000 one-way-equivalent passengers a year (2024), which is the actual
# Sydney<->Singapore city-pair total in the BITRE data this project already
# parses (etl/fetch_real_aviation_stats.py; 70,010/month one-way-equivalent).
#
# This was previously 3,500,000, the AUSTRALIA-Singapore country-pair figure -
# a country total used to calibrate a city-pair model, which inflated every
# estimate by roughly 4x. Sydney is not the only Australian city flying to
# Singapore. The error was invisible because the gravity estimate was almost
# always discarded by a hardcoded load-factor cap downstream.
_REF_MARKET   = 840_000     # SYD-SIN one-way-equivalent pax/year
_REF_GDP_B    = 547.0       # Singapore GDP (billions)
_REF_DIST_KM  = 6_293.0     # SYD-SIN distance (km)
_REF_TOURISM  = 19.1        # Singapore inbound tourism 2019 (millions)
_DIST_DECAY   = 1.30        # distance exponent (calibrated)

# Short-haul special case: domestic/trans-Tasman markets
# have much higher density than the gravity model predicts.
_SHORT_HAUL_KM = 2_500
_SHORT_HAUL_MARKET = 5_000_000   # dense-market base, capped by destination size below


def _bilateral_market(gdp_dest_b: float, distance_km: float, tourism_m: float, pop_m: float) -> float:
    """
    Total bilateral O&D market estimate (all carriers, annual passengers).

    Calibrated against the SYD-SIN route (3.5M/yr). Uses log-damped GDP ratio
    to prevent over-prediction for very large economies (US, China), and a
    square-root tourism factor so high-tourism destinations get a modest uplift.

    Capped by destination size: a city-pair market can't exceed what the
    destination's own population and visitor volume can generate. Calibrated
    against real markets (SYD-MEL ~9M/yr, AU pop 27M; SYD-AKL ~1.6M/yr, NZ
    pop 5.3M + 3.9M tourists; SYD-NAN ~0.4-0.5M/yr, Fiji pop 0.9M + 0.9M
    tourists) - without the cap, small/island destinations inherited
    metro-sized gravity estimates from the distance term alone.
    """
    market_cap = (0.30 * pop_m + 0.15 * tourism_m) * 1_000_000

    if distance_km < _SHORT_HAUL_KM:
        # Short-haul: flat dense-market base scaled by GDP only
        gdp_scale = (math.log(max(gdp_dest_b, 10)) / math.log(_REF_GDP_B)) ** 0.4
        return min(_SHORT_HAUL_MARKET * gdp_scale, market_cap)

    gdp_ratio  = (math.log(max(gdp_dest_b, 10)) / math.log(_REF_GDP_B)) ** 0.5
    dist_ratio = (_REF_DIST_KM / distance_km) ** _DIST_DECAY
    tour_ratio = math.sqrt(_tourism_factor(tourism_m) / _tourism_factor(_REF_TOURISM))

    return min(_REF_MARKET * gdp_ratio * dist_ratio * tour_ratio, market_cap)


_SHARE_MODEL = MarketShareModel()

# Assumed incumbent service quality on an unknown route: a competent
# full-service carrier, slightly better rated than Pacific Wings, since an
# established operator on its home route usually is.
INCUMBENT_RATING = 4.2
# Incumbents are assumed to be sized to the market they serve, flying it at
# roughly this load factor - which is what converts a market estimate into
# the weekly frequency the share model needs.
INCUMBENT_LOAD_FACTOR = 0.82


def _incumbent_carriers(
    n_existing_carriers: int,
    market_pax_annual: float,
    fare: float,
    seats: int,
) -> list[dict]:
    """The competitive set on a route Pacific Wings does not fly yet.

    Incumbent frequency is derived from the market rather than invented: if
    n carriers between them carry a market of M passengers a year at
    INCUMBENT_LOAD_FACTOR, their combined weekly departures follow, and are
    split evenly. When nobody flies it nonstop, the competition is the
    connecting itinerary (pacific_wings/simulation/market_share.py), not nobody.

    This replaced a `_new_entrant_share` heuristic - 0.20/n_carriers plus a
    frequency bonus, capped at 40% - which was one of three different market
    share models in this repo and agreed with neither of the others.
    """
    if n_existing_carriers <= 0:
        return [connecting_alternative(fare)]

    weekly_seats_needed = market_pax_annual / (52 * max(INCUMBENT_LOAD_FACTOR, 0.01))
    total_weekly_frequency = max(1.0, weekly_seats_needed / max(seats, 1))
    per_carrier = total_weekly_frequency / n_existing_carriers

    return [
        {
            "name": f"Incumbent {i + 1}",
            "price": fare,
            "weekly_frequency": per_carrier,
            "rating": INCUMBENT_RATING,
        }
        for i in range(n_existing_carriers)
    ]

# ─── fare estimation by distance and region ──────────────────────────────────

# Same flat-fee + per-km formula as etl/generate_synthetic_demand.py's
# FARE_BASE_USD/FARE_PER_KM_SHORT/FARE_PER_KM_LONG (Phase 4 real-data
# rebuild) - that formula's outputs already match Phase 2's spot-checked
# real fares almost exactly for SIN/HND/MEL/AKL (it's what those competitor
# fare multipliers were derived against), whereas this module's old
# hardcoded step table ran ~60-105% above it at every distance band.
# Duplicated rather than imported - this module already avoids depending on
# etl/, which only ever produces data files for it to read.
_FARE_BASE_USD = 60.0
_FARE_PER_KM_SHORT = 0.075   # up to 2000 km
_FARE_PER_KM_LONG = 0.045    # beyond 2000 km
_FARE_SHORT_HAUL_KM = 2000.0

def _estimate_fare(distance_km: float) -> float:
    if distance_km <= _FARE_SHORT_HAUL_KM:
        return _FARE_BASE_USD + distance_km * _FARE_PER_KM_SHORT
    return (
        _FARE_BASE_USD
        + _FARE_SHORT_HAUL_KM * _FARE_PER_KM_SHORT
        + (distance_km - _FARE_SHORT_HAUL_KM) * _FARE_PER_KM_LONG
    )

# Tourism uplift factor: high-tourism destinations generate more leisure travel
def _tourism_factor(tourism_m: float) -> float:
    if tourism_m >= 50:
        return 1.4
    if tourism_m >= 20:
        return 1.25
    if tourism_m >= 10:
        return 1.15
    if tourism_m >= 5:
        return 1.05
    return 1.0

# ─── risk scoring ─────────────────────────────────────────────────────────────

_GEOPOLITICAL_RISK: dict[str, int] = {
    # 0 = low, 1 = moderate, 2 = elevated, 3 = high
    "AU": 0, "NZ": 0, "SG": 0, "JP": 0, "KR": 0, "TW": 0,
    "US": 0, "CA": 0, "GB": 0, "FR": 0, "DE": 0, "NL": 0,
    "CH": 0, "SE": 0, "NO": 0, "DK": 0, "FI": 0, "AT": 0, "BE": 0, "IE": 0,
    "ES": 0, "IT": 0, "PT": 0, "GR": 0, "CZ": 0, "PL": 0, "HU": 0,
    "MY": 1, "TH": 1, "ID": 1, "PH": 1, "VN": 1, "IN": 1, "LK": 1,
    "AE": 0, "QA": 0, "SA": 1, "OM": 0, "BH": 0, "KW": 0, "IL": 2, "JO": 1,
    "TR": 1, "EG": 2, "MA": 1, "TN": 1,
    "ZA": 1, "KE": 1, "ET": 2, "NG": 2, "GH": 1, "TZ": 1, "UG": 2, "MU": 0,
    "BR": 1, "AR": 1, "CL": 0, "CO": 1, "PE": 1, "MX": 1,
    "CN": 1, "HK": 1, "RU": 3, "KZ": 1, "UZ": 1,
    "BD": 2, "NP": 1, "MM": 3,
}

_CURRENCY_RISK: dict[str, int] = {
    # 0 = stable (USD/EUR/GBP/SGD/HKD peg), 1 = moderate, 2 = volatile
    "US": 0, "CA": 0, "GB": 0, "AU": 0, "NZ": 0, "SG": 0, "HK": 0,
    "JP": 0, "KR": 0, "TW": 0, "AE": 0, "QA": 0, "BH": 0,
    "FR": 0, "DE": 0, "NL": 0, "IT": 0, "ES": 0, "AT": 0,
    "CH": 0, "DK": 0, "NO": 0, "SE": 0,
    "IN": 1, "TH": 1, "MY": 1, "ID": 1, "VN": 1, "PH": 1,
    "CN": 1, "IL": 1, "TR": 2, "EG": 2, "AR": 2, "NG": 2, "BD": 1,
}

def _geo_risk(country: str) -> int:
    return _GEOPOLITICAL_RISK.get(country, 1)

def _currency_risk(country: str) -> int:
    return _CURRENCY_RISK.get(country, 1)

_MARKET_MODEL = MarketModel()
_REFERENCE_DATA = ReferenceData()
_ENGINE = SimulationEngine()

# Screening horizon. A feasibility study is about the year you would launch,
# not the last year with data, so observed markets are grown to it using the
# same macro projection /what_if uses.
SCREENING_YEAR = _ENGINE._growth_anchor_year + 2
MONTHS_PER_YEAR = 12


def _market_size(
    iata: str, gdp_dest_b: float, distance_km: float, tourism_m: float, pop_dest_m: float
) -> tuple[float, str, bool]:
    """Annual total market for the route, real where it exists.

    Returns (passengers, provenance, is_observed). The provenance string is
    surfaced in the response: an estimate a reader cannot tell apart from an
    observation is worse than no estimate.
    """
    try:
        observed = sum(
            _MARKET_MODEL.predict(iata, month) for month in range(1, MONTHS_PER_YEAR + 1)
        )
    except KeyError:
        return (
            _bilateral_market(gdp_dest_b, distance_km, tourism_m, pop_dest_m),
            "gravity model estimate (no observed history for this route)",
            False,
        )

    # Grow the observed market to the screening year, exactly as the simulator
    # does. Screening a route against a market last observed two years ago,
    # while /what_if projects the same route forward, is how the two ended up
    # reporting different passenger counts for identical inputs.
    growth = _ENGINE.market_growth_multiplier(iata, SCREENING_YEAR)
    return (
        observed * growth,
        f"observed (BITRE city-pair) grown to {SCREENING_YEAR} (x{growth:.3f})",
        True,
    )


def _not_feasible(
    airport: dict,
    aircraft_type: str,
    aircraft: dict,
    distance_km: float,
    weekly_frequency: int,
    range_note: str,
) -> dict:
    """Verdict for a route outside the range of every aircraft in the fleet.

    Deliberately returns no demand, financial or scoring section: there is
    nothing to score, and a score invites the reader to weigh it against
    routes that can actually be flown. What it does return is the one useful
    thing - the shortfall, and what would close it.
    """
    capable = sorted(
        (ac for ac in AIRCRAFT.values() if distance_km <= ac["range_km"] * 0.95),
        key=lambda ac: ac["range_km"],
    )
    shortfall = distance_km - aircraft["range_km"]
    remedy = (
        f"{capable[0]['type']} would cover it ({capable[0]['range_km']:,} km range)."
        if capable
        else (
            f"No aircraft in the fleet covers {distance_km:,.0f} km - the longest-ranged "
            f"is the B787-9 at {AIRCRAFT['B787-9']['range_km']:,} km. This route needs a "
            "fleet addition or a technical stop, either of which changes the economics "
            "enough that screening it on the current fleet would be meaningless."
        )
    )

    return {
        "route": {
            "origin": "SYD",
            "origin_city": "Sydney",
            "destination": airport["iata"],
            "destination_city": airport["city"],
            "destination_country": (airport.get("macro") or {}).get("name", airport["country"]),
            "distance_km": distance_km,
            "flight_hours": round(distance_km / aircraft["cruise_speed_kmh"] + BLOCK_TIME_OVERHEAD_H, 2),
        },
        "operations": {
            "aircraft_type": aircraft_type,
            "aircraft_range_km": aircraft["range_km"],
            "aircraft_in_range": False,
            "range_note": range_note,
            "range_shortfall_km": round(shortfall),
            "total_seats": aircraft["seats"]["total"],
            "weekly_frequency": weekly_frequency,
        },
        "verdict": "NOT FEASIBLE",
        "verdict_reason": "Outside the range of every aircraft in the fleet.",
        "remedy": remedy,
        "pros": [],
        "cons": [range_note],
        "note": (
            "Demand, financial and scoring sections are omitted deliberately: this route "
            "cannot be operated with the current fleet, so any figures would describe a "
            "flight that does not exist."
        ),
    }


# ─── main analysis function ───────────────────────────────────────────────────

# Frequency search bounds for the schedule sizer. A launch is at least daily-
# minus-four and no more than double-daily; beyond that a screening estimate is
# not the right tool.
FREQUENCY_SEARCH_RANGE = range(3, 15)

# A launch schedule that cannot fill this much of the aircraft is not a launch
# schedule, however profitable the arithmetic says the first few flights are.
MIN_VIABLE_LOAD_FACTOR = 0.55


def _size_weekly_frequency(
    iata: str,
    distance_km: float,
    aircraft_type: str,
    market_pax_annual: float,
    economy_fare: float,
    reference_fare: float,
    competitor_set: list[dict],
    fuel_price_usd_per_gallon: float | None,
) -> tuple[int, list[dict]]:
    """Choose the launch frequency, rather than being handed one.

    Every candidate used to be screened at a fixed 3x/week, and because the
    logit's share shrinks in almost exact proportion as the market grows, that
    made `market x share` a near-constant: Tokyo, Seoul and Honolulu all came
    back at ~27,000 passengers a year, a 0.72-0.73 load factor and annual
    profit within 5% of each other, across markets differing by 1.8x in size.
    The screener could not rank destinations, which is the one thing it exists
    to do. Sizing the schedule to the market is what puts market size back into
    the answer.

    Picks the most profitable frequency that both clears MIN_VIABLE_LOAD_FACTOR
    and fits the fleet alongside today's network (F-03). Returns the choice and
    the whole search, so the caller can show its working.
    """
    options = []
    for frequency in FREQUENCY_SEARCH_RANGE:
        sim = _ENGINE.run_open_route(
            destination=iata,
            market_passengers_annual=market_pax_annual,
            distance_km=distance_km,
            aircraft_type=aircraft_type,
            weekly_frequency=frequency,
            economy_fare_usd=economy_fare,
            reference_fare_usd=reference_fare,
            competitors=competitor_set,
            fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
        )
        fleet = _FLEET.check(iata, aircraft_type, frequency, distance_km=distance_km)
        options.append({
            "weekly_frequency": frequency,
            "load_factor": round(sim["load_factor"], 3),
            "annual_profit_usd": round(sim["profit_usd"] * 12),
            "fleet_feasible": fleet["feasible"],
        })

    viable = [
        o for o in options
        if o["fleet_feasible"] and o["load_factor"] >= MIN_VIABLE_LOAD_FACTOR
    ]
    if viable:
        chosen = max(viable, key=lambda o: o["annual_profit_usd"])
    else:
        # Nothing clears both bars. Screen the smallest fleet-feasible
        # schedule so the numbers describe the least-bad version of the route,
        # and let the verdict say why it fails.
        feasible = [o for o in options if o["fleet_feasible"]] or options
        chosen = min(feasible, key=lambda o: o["weekly_frequency"])
    return chosen["weekly_frequency"], options


def analyze_open_route(
    destination: str,
    aircraft_type: str | None = None,
    weekly_frequency: int | None = None,
    avg_fare_usd: float | None = None,
    fuel_price_usd_per_gallon: float | None = None,
    n_existing_carriers: int | None = None,
) -> dict:
    """
    Full strategic analysis of a proposed new route SYD → destination.

    Args:
        destination: IATA code (e.g. "LHR") or city name (e.g. "London").
        aircraft_type: Force a specific aircraft ("A320-200", "A321neo",
            "B787-9"). Auto-selected from distance if omitted.
        weekly_frequency: Proposed weekly departures. Sized to the market
            when omitted - see `_size_weekly_frequency`.
        avg_fare_usd: Assumed one-way average fare. Auto-estimated from
            distance if omitted.
        fuel_price_usd_per_gallon: Scenario fuel price. Defaults to
            projected near-term price ($2.40/gal).
        n_existing_carriers: Number of other carriers already serving this
            route (used for market share modelling). Auto-estimated if omitted.

    Returns:
        A comprehensive dict with airport info, demand estimate, revenue/cost/
        profit estimates, risk scores, feasibility verdict, and pros/cons list.
    """
    # ── 1. Airport lookup ──────────────────────────────────────────────────────
    airport = lookup_airport(destination)
    if airport is None:
        return {
            "error": f"Airport not found: '{destination}'. "
                     "Try an IATA code (e.g. 'LHR') or a major city name.",
            "suggestions": search_airports(destination, limit=5),
        }

    iata = airport["iata"]
    city = airport["city"]
    country = airport["country"]
    distance_km = airport["distance_from_syd_km"]
    macro = airport.get("macro") or {}

    gdp_dest_b = macro.get("gdp_b", 200)
    pop_dest_m  = macro.get("pop_m", 10)
    tourism_m   = macro.get("tourism_m", 2)
    country_name = macro.get("name", country)

    # ── 2. Aircraft selection & range feasibility ──────────────────────────────
    aircraft_type = aircraft_type or _select_aircraft(distance_km)
    aircraft = AIRCRAFT.get(aircraft_type)
    if aircraft is None:
        return {"error": f"Unknown aircraft type: {aircraft_type}"}

    range_km = aircraft["range_km"]
    # Shared derate for payload, wind and reserves (simulation/fleet.py).
    in_range = aircraft_in_range(aircraft, distance_km)
    usable_km = usable_range_km(aircraft)
    range_note = (
        f"{aircraft_type} has {range_km:,} km published range, {usable_km:,.0f} km usable after the "
        f"payload/wind/reserve derate; route is {distance_km:,.0f} km — "
        + (
            "within range."
            if in_range
            else f"EXCEEDS usable range by {distance_km - usable_km:,.0f} km. Aircraft upgrade required."
        )
    )

    if not in_range:
        # Stop here. A route no aircraft in the fleet can fly has no
        # financials to report, and reporting them anyway was actively
        # misleading: SYD-LHR came back NOT FEASIBLE with a composite score of
        # 67/100 and eight pros, including "Estimated profitable at launch:
        # $6.8M annual profit" for a flight that cannot be operated.
        return _not_feasible(
            airport, aircraft_type, aircraft, distance_km, weekly_frequency, range_note
        )

    seats = aircraft["seats"]
    total_seats = seats["total"]

    # ── 3. Market size estimation ─────────────────────────────────────────────
    # Prefer real observed market size. The gravity model exists for
    # destinations with no history; using it on a route the project already
    # has BITRE figures for is how the two engines came to disagree by up to
    # $14.8M a year on the same route.
    market_pax_annual, market_source, observed_market = _market_size(
        iata, gdp_dest_b, distance_km, tourism_m, pop_dest_m
    )

    # Estimate number of existing competitors if not provided
    if n_existing_carriers is None:
        # Heuristic: more competing carriers for high-GDP, popular tourist destinations
        if distance_km < 3000:
            n_existing_carriers = 4
        elif gdp_dest_b > 3000 or tourism_m > 30:
            n_existing_carriers = 5
        elif gdp_dest_b > 1000 or tourism_m > 10:
            n_existing_carriers = 3
        else:
            n_existing_carriers = 2

    # Fare is decided below, but share and market size both depend on it, so
    # resolve it first.
    seat_shares = {cabin: seats.get(cabin, 0) / total_seats for cabin in CABIN_FARE_MULTIPLIERS}
    fill = {c: seat_shares[c] * CABIN_FILL_WEIGHTS[c] for c in CABIN_FARE_MULTIPLIERS}
    total_fill = sum(fill.values()) or 1.0
    realized_multiplier = sum(
        (fill[c] / total_fill) * m for c, m in CABIN_FARE_MULTIPLIERS.items()
    )
    # FARE CONVENTION. `economy_fare` is the economy-cabin fare, which is the
    # scale pacific_wings/simulation/revenue.py works on and the scale competitors.csv fares
    # were derived at. Everything that compares fares - the share logit, the
    # elasticity - uses it. Only revenue scales up to the blended average via
    # the cabin mix. Mixing the two conventions made this module value a
    # SYD-SIN seat at $454 while the engine valued the same seat at $511,
    # a $305k/month revenue gap on identical passenger counts.
    # Observed fare where the route has one, distance formula otherwise -
    # the same rule market size and competitors follow. _estimate_fare put
    # SYD-SIN at $403 against the $454 actually observed in the demand data,
    # which alone was a $305k/month revenue disagreement between the two
    # engines on identical passenger counts.
    reference_fare = _REFERENCE_DATA.default_avg_fare(iata) or _estimate_fare(distance_km)
    economy_fare = avg_fare_usd if avg_fare_usd is not None else reference_fare
    avg_fare = economy_fare * realized_multiplier  # blended, for revenue only

    # Pricing away from the reference moves the size of the market, on the
    # same elasticity the main simulator uses (pacific_wings/simulation/engine.py).
    if avg_fare_usd is not None and reference_fare > 0 and economy_fare > 0:
        market_pax_annual *= (economy_fare / reference_fare) ** MARKET_FARE_ELASTICITY

    # Share comes from the same QSI logit the existing-network simulator uses,
    # against a competitive set sized to the market.
    # Real competitors where they exist, synthetic incumbents only where they
    # do not - the same "prefer the observation" rule the market size follows.
    # "Known" means the project has observed data for the route, NOT that the
    # route has competitor rows. Da Nang has no nonstop competitor by
    # definition, and keying off the competitor table classified it as an
    # unknown destination - so it got synthetic incumbents sized to its tiny
    # market instead of the connecting itineraries it actually competes with,
    # and its passenger estimate came out 91% above the simulator's.
    known_route = observed_market
    real_competitors = _SHARE_MODEL.carriers_on(iata, own_price=economy_fare)
    competitor_set = (
        real_competitors
        if known_route
        else _incumbent_carriers(n_existing_carriers, market_pax_annual, economy_fare, total_seats)
    )
    competitor_source = (
        "real carriers on this route" if known_route else "synthetic incumbents sized to the market"
    )
    # ── 4-5. Allocation and financials: THE SHARED ENGINE ─────────────────────
    # Everything from here - share, spill, revenue, cost - is
    # SimulationEngine.run_open_route, the same code path /what_if runs. This
    # module used to carry its own copies of all of it, and the two answered
    # the same question differently: Da Nang screened as +$4.9M/yr PROCEED
    # here while the simulator called it -$9.9M/yr on the same route.
    fuel_for_screen = fuel_price_usd_per_gallon or BASELINE_FUEL_USD_PER_GAL
    if weekly_frequency is None:
        weekly_frequency, frequency_options = _size_weekly_frequency(
            iata, distance_km, aircraft_type, market_pax_annual,
            economy_fare, reference_fare, competitor_set, fuel_for_screen,
        )
    else:
        frequency_options = []

    # F-03: the screener used to check aircraft RANGE and nothing else, so
    # three candidates could each come back PROCEED on a 787 fleet with 90
    # spare block hours a week between them and need 171.
    fleet_check = _FLEET.check(iata, aircraft_type, weekly_frequency, distance_km=distance_km)

    sim = _ENGINE.run_open_route(
        destination=iata,
        market_passengers_annual=market_pax_annual,
        distance_km=distance_km,
        aircraft_type=aircraft_type,
        weekly_frequency=weekly_frequency,
        economy_fare_usd=economy_fare,
        reference_fare_usd=reference_fare,
        competitors=competitor_set,
        fuel_price_usd_per_gallon=fuel_for_screen,
    )

    share_result = sim["market_share"]
    own_share = share_result["pacific_wings_share"]
    passengers_monthly = sim["passengers_carried"]
    passengers_annual = passengers_monthly * 12
    spilled_annual = sim["spilled_passengers"] * 12
    load_factor = sim["load_factor"]
    capacity_annual = sim["capacity_monthly"] * 12

    # Confidence band: gravity models are ±40% accurate at this stage
    low_pax = round(passengers_annual * 0.60)
    high_pax = round(passengers_annual * 1.40)

    fuel_price = sim["cost"]["fuel_price_usd_per_gallon"]
    avg_fare = sim["revenue"]["blended_avg_fare_usd"] or avg_fare
    ancillary_rate = ancillary_per_pax_usd(distance_km)
    flight_hours = distance_km / aircraft["cruise_speed_kmh"] + BLOCK_TIME_OVERHEAD_H

    total_rev_monthly = sim["revenue"]["total_revenue_usd"]
    total_rev_annual = total_rev_monthly * 12
    total_cost_monthly = sim["cost"]["total_cost_usd"]
    total_cost_annual = total_cost_monthly * 12
    profit_monthly = sim["profit_usd"]
    profit_annual = profit_monthly * 12
    margin = profit_annual / total_rev_annual if total_rev_annual > 0 else 0.0

    # Each passenger contributes fare + ancillary, so breakeven counts both.
    revenue_per_pax = avg_fare + ancillary_rate
    breakeven_pax_monthly = total_cost_monthly / revenue_per_pax if revenue_per_pax > 0 else 0
    breakeven_lf = breakeven_pax_monthly / (total_seats * weekly_frequency * WEEKS_PER_MONTH)

    # ── 6. Risk scoring (0=low, 1=moderate, 2=elevated, 3=high) ──────────────
    risk_geo  = _geo_risk(country)
    risk_fx   = _currency_risk(country)

    # Demand risk: very long routes or small markets are uncertain
    if distance_km > 14000 or market_pax_annual < 300_000:
        risk_demand = 2
    elif distance_km > 10000 or market_pax_annual < 800_000:
        risk_demand = 1
    else:
        risk_demand = 0

    # Competition risk: many established carriers
    risk_competition = min(3, max(0, n_existing_carriers - 2))

    # Financial risk: thin margins or breakeven LF is very high
    if breakeven_lf > 0.85 or margin < 0:
        risk_financial = 2
    elif breakeven_lf > 0.75 or margin < 0.05:
        risk_financial = 1
    else:
        risk_financial = 0

    risk_components = {
        "geopolitical_risk": risk_geo,
        "currency_risk": risk_fx,
        "demand_risk": risk_demand,
        "competition_risk": risk_competition,
        "financial_risk": risk_financial,
    }
    overall_risk = round(
        0.25 * risk_geo + 0.20 * risk_fx + 0.25 * risk_demand +
        0.15 * risk_competition + 0.15 * risk_financial,
        2
    )
    # A weighted mean reported Tokyo at 0.7 ("low") while its competition
    # component sat at 3, the top of the scale. A maximum-severity component
    # does not average away: it floors the headline at "elevated" and is named.
    worst_risk_name = max(risk_components, key=lambda k: risk_components[k])
    worst_risk = risk_components[worst_risk_name]
    if worst_risk >= 3:
        overall_risk = max(overall_risk, 2.0)

    # ── 7. Multi-factor strategic score (0-100) ───────────────────────────────
    demand_score = min(100, max(0, round(
        20 * math.log10(max(market_pax_annual, 1) / 500_000 + 1)
        + 30 * min(load_factor / MAX_SELLABLE_LOAD_FACTOR, 1.0)
    )))
    financial_score = min(100, max(0, round(
        50 * min(max(margin + 0.1, 0) / 0.2, 1.0)
        + 50 * (1 - max(breakeven_lf - 0.5, 0) / 0.4)
    )))
    strategic_score = min(100, max(0, round(
        30 * _tourism_factor(tourism_m) / 1.4
        + 20 * (1 - min(overall_risk / 2, 1))
        + 20 * min(gdp_dest_b / 1000, 1.0)
        + 30 * (1 if profit_annual > 0 else 0)
    )))
    composite_score = round(0.35 * demand_score + 0.40 * financial_score + 0.25 * strategic_score)

    # ── 8. Verdict and recommendation ────────────────────────────────────────
    if not in_range or not fleet_check["feasible"]:
        verdict = "NOT FEASIBLE"
    elif composite_score >= 65 and profit_annual > 0:
        verdict = "PROCEED"
    elif composite_score >= 45 or profit_annual > 0:
        verdict = "PROCEED WITH CAUTION"
    else:
        verdict = "DO NOT PROCEED"

    # ── 9. Pros and cons list ─────────────────────────────────────────────────
    pros: list[str] = []
    cons: list[str] = []

    # Demand pros/cons
    # One sentence per band, with the band named. Two separate pro and con
    # templates meant 842K read as "moderate" while 756K read as "small -
    # limited scale": an 11% difference flipped the tone across a boundary the
    # reader could not see.
    if market_pax_annual > 2_000_000:
        pros.append(
            f"Large bilateral market ({market_pax_annual/1e6:.1f}M total annual passengers, "
            "all carriers; large = above 2M)."
        )
    elif market_pax_annual > 800_000:
        pros.append(
            f"Moderate bilateral market ({market_pax_annual/1e6:.1f}M total annual passengers, "
            "all carriers; moderate = 0.8M-2M)."
        )
    else:
        cons.append(
            f"Small bilateral market ({market_pax_annual/1000:.0f}K total annual passengers, "
            "all carriers; small = below 0.8M) — limited scale."
        )

    if tourism_m >= 20:
        pros.append(f"High-tourism destination ({tourism_m:.0f}M international arrivals/year) supports leisure demand.")
    elif tourism_m >= 5:
        pros.append(f"Moderate tourism ({tourism_m:.1f}M arrivals/year) provides leisure demand base.")
    else:
        cons.append(f"Low tourism volume ({tourism_m:.1f}M arrivals/year) — route relies heavily on business/VFR traffic.")

    if gdp_dest_b >= 1000:
        pros.append(f"High-income destination (GDP ${gdp_dest_b/1000:.1f}T) supports premium yields.")
    elif gdp_dest_b >= 200:
        pros.append(f"Growing economy (GDP ${gdp_dest_b:.0f}B) with solid income base.")
    else:
        cons.append(f"Smaller economy (GDP ${gdp_dest_b:.0f}B) limits yield potential and business demand.")

    # Financial pros/cons
    if profit_annual > 0:
        pros.append(f"Estimated profitable at launch: ${profit_annual/1e6:.1f}M annual profit at {weekly_frequency}×/week.")
    else:
        cons.append(
            f"Estimated loss at launch ({weekly_frequency}×/week): "
            f"${profit_annual/1e6:.1f}M/year. Higher frequency or fare needed."
        )

    if margin >= 0.08:
        pros.append(f"Healthy operating margin ({margin*100:.1f}%) above the 8% target.")
    elif margin >= 0.03:
        cons.append(f"Thin operating margin ({margin*100:.1f}%) — limited buffer against cost shocks.")
    else:
        cons.append(f"Very thin/negative margin ({margin*100:.1f}%) — route is financially fragile.")

    if breakeven_lf <= 0.70:
        pros.append(f"Low breakeven load factor ({breakeven_lf*100:.0f}%) — route profitable even at moderate demand.")
    elif breakeven_lf <= 0.80:
        cons.append(f"Moderate breakeven LF ({breakeven_lf*100:.0f}%) — requires consistent demand to stay profitable.")
    else:
        cons.append(f"High breakeven LF ({breakeven_lf*100:.0f}%) — operationally risky, little room for seasonality.")

    # Competition
    if n_existing_carriers <= 2:
        pros.append(f"Low competition ({n_existing_carriers} existing carrier(s)) — opportunity for meaningful market share.")
    elif n_existing_carriers <= 4:
        cons.append(f"Moderate competition ({n_existing_carriers} existing carriers) — Pacific Wings would enter as challenger.")
    else:
        cons.append(f"High competition ({n_existing_carriers} established carriers) — market share capture will be slow and costly.")

    if not fleet_check["feasible"]:
        cons.append(
            "No aircraft available: " + "; ".join(fleet_check["shortfalls"])
            + ". The schedule does not fit alongside the current network."
        )
    elif frequency_options:
        blocked = [o for o in frequency_options if not o["fleet_feasible"]]
        if blocked:
            cons.append(
                f"Fleet caps this route at {min(b['weekly_frequency'] for b in blocked) - 1}×/week "
                "before another aircraft is needed."
            )

    # Distance / operations
    if in_range:
        if distance_km >= 8000:
            pros.append(f"Long-haul route ({distance_km:,.0f} km) — higher per-trip revenue; builds premium brand.")
        elif distance_km >= 4000:
            pros.append(f"Medium-haul route ({distance_km:,.0f} km) — good unit economics for the {aircraft_type}.")
    else:
        cons.append(
            f"Route distance ({distance_km:,.0f} km) exceeds {aircraft_type} range "
            f"({range_km:,} km). Requires fleet upgrade or stopping rights."
        )

    # Risk
    if risk_geo >= 2:
        cons.append(f"Elevated geopolitical risk in {country_name} — operational disruption exposure.")
    if risk_fx >= 2:
        cons.append(f"Currency volatility risk: {country_name} currency may erode USD-denominated revenues.")
    if risk_geo == 0 and risk_fx == 0:
        pros.append(f"Stable regulatory and currency environment in {country_name} — low operational risk.")

    # Strategic
    if load_factor >= 0.80:
        pros.append(f"Projected {load_factor*100:.0f}% load factor — strong asset utilisation.")
    elif load_factor < 0.60:
        cons.append(f"Projected low load factor ({load_factor*100:.0f}%) — aircraft will operate below efficient utilisation.")

    return {
        "route": {
            "origin": "SYD",
            "origin_city": "Sydney",
            "destination": iata,
            "destination_city": city,
            "destination_country": country_name,
            "distance_km": distance_km,
            "flight_hours": round(flight_hours, 2),
        },
        "market": {
            "destination_gdp_usd_billions": gdp_dest_b,
            "destination_population_millions": pop_dest_m,
            "destination_tourism_millions_2019": tourism_m,
            "market_size_source": market_source,
            "competitor_source": competitor_source,
            "bilateral_market_estimate_annual_pax": round(market_pax_annual),
            "bilateral_market_low": round(market_pax_annual * 0.60),
            "bilateral_market_high": round(market_pax_annual * 1.40),
            "existing_competitors_estimate": n_existing_carriers,
            "pacific_wings_market_share_estimate": round(own_share * 100, 1),
        },
        "operations": {
            "aircraft_type": aircraft_type,
            "aircraft_range_km": range_km,
            "aircraft_in_range": in_range,
            "range_note": range_note,
            "total_seats": total_seats,
            "weekly_frequency": weekly_frequency,
            "frequency_basis": (
                "sized to the market: most profitable schedule that clears a "
                f"{MIN_VIABLE_LOAD_FACTOR:.0%} load factor and fits the current fleet"
                if frequency_options
                else "supplied by the caller"
            ),
            "frequency_options": frequency_options,
            "fleet": {
                "feasible": fleet_check["feasible"],
                "shortfalls": fleet_check["shortfalls"],
                "by_aircraft_type": fleet_check["by_aircraft_type"],
            },
            "monthly_capacity_seats": round(capacity_annual / 12),
        },
        "demand_estimate": {
            "annual_passengers_pacific_wings": round(passengers_annual),
            "monthly_passengers": round(passengers_monthly),
            "load_factor_estimate": round(load_factor, 3),
            "spilled_annual_passengers": round(spilled_annual),
            "capacity_constrained": spilled_annual > 0,
            "confidence_low_annual": low_pax,
            "confidence_high_annual": high_pax,
            "note": "Gravity model estimate ±40%; treat as order-of-magnitude for strategic screening.",
        },
        "financials": {
            "economy_fare_usd": round(economy_fare),
            "avg_fare_usd": round(avg_fare),
            "fuel_price_usd_per_gallon": fuel_price,
            "monthly_revenue_usd": round(total_rev_monthly),
            "monthly_cost_usd": round(total_cost_monthly),
            "monthly_profit_usd": round(profit_monthly),
            "annual_revenue_usd": round(total_rev_annual),
            "annual_cost_usd": round(total_cost_annual),
            "annual_profit_usd": round(profit_annual),
            "operating_margin_pct": round(margin * 100, 1),
            "breakeven_load_factor": round(breakeven_lf, 3),
            "note": "Estimates derived from calibrated cost/revenue models; ±30% accuracy at this stage.",
        },
        "risk": {
            "geopolitical_risk": risk_geo,
            "currency_risk": risk_fx,
            "demand_risk": risk_demand,
            "competition_risk": risk_competition,
            "financial_risk": risk_financial,
            "overall_risk_score": overall_risk,
            "worst_component": worst_risk_name,
            "worst_component_score": worst_risk,
            "risk_scale": "0=low · 1=moderate · 2=elevated · 3=high",
        },
        "scoring": {
            "demand_score": demand_score,
            "financial_score": financial_score,
            "strategic_score": strategic_score,
            "composite_score": composite_score,
            "score_scale": "0–100, higher is better",
        },
        "verdict": verdict,
        "pros": pros,
        "cons": cons,
    }


def compare_route_alternatives(
    destinations: list[str],
    weekly_frequency: int | None = None,
    fuel_price_usd_per_gallon: float | None = None,
) -> dict:
    """
    Analyse and rank multiple potential new destinations side-by-side.

    Args:
        destinations: List of IATA codes or city names (2-8 destinations).
        weekly_frequency: Weekly departures applied to all routes. Each route
            is sized to its own market when omitted.
        fuel_price_usd_per_gallon: Optional fuel price scenario.

    Returns:
        Ranked list of routes with summary metrics for direct comparison, plus
        a JOINT fleet check across everything that came back PROCEED. Each
        route is screened against the fleet on its own, which is the wrong
        question for a shortlist: three candidates each fitting the spare 787
        hours individually needed 171 of the 90 available between them, and the
        comparison table had no fleet column at all.
    """
    if not 2 <= len(destinations) <= MAX_COMPARISON_DESTINATIONS:
        # This used to be a silent `destinations[:8]`: ask for ten candidates,
        # get eight ranked as though that were the shortlist.
        raise ValueError(
            f"Compare 2-{MAX_COMPARISON_DESTINATIONS} destinations at a time; got {len(destinations)}."
        )

    results = []
    errors = []

    for dest in destinations:
        analysis = analyze_open_route(
            dest,
            weekly_frequency=weekly_frequency,
            fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
        )
        if "error" in analysis:
            errors.append({"destination": dest, "error": analysis["error"]})
        else:
            results.append({
                "destination": analysis["route"]["destination"],
                "city": analysis["route"]["destination_city"],
                "country": analysis["route"]["destination_country"],
                "distance_km": analysis["route"]["distance_km"],
                "aircraft_type": analysis["operations"]["aircraft_type"],
                "in_range": analysis["operations"]["aircraft_in_range"],
                "annual_passengers": analysis["demand_estimate"]["annual_passengers_pacific_wings"],
                "load_factor": analysis["demand_estimate"]["load_factor_estimate"],
                "annual_profit_usd": analysis["financials"]["annual_profit_usd"],
                "operating_margin_pct": analysis["financials"]["operating_margin_pct"],
                "breakeven_lf": analysis["financials"]["breakeven_load_factor"],
                "overall_risk": analysis["risk"]["overall_risk_score"],
                "composite_score": analysis["scoring"]["composite_score"],
                "verdict": analysis["verdict"],
                "top_pro": analysis["pros"][0] if analysis["pros"] else "—",
                "top_con": analysis["cons"][0] if analysis["cons"] else "—",
                "weekly_frequency": analysis["operations"]["weekly_frequency"],
                "fleet_feasible_alone": analysis["operations"]["fleet"]["feasible"],
            })

    results.sort(key=lambda r: r["composite_score"], reverse=True)

    # Everything not ruled out, flown at once, against today's network.
    shortlist = [r for r in results if r["verdict"].startswith("PROCEED")]
    schedule = _FLEET.current_schedule()
    distances = {}
    for r in shortlist:
        schedule[r["destination"]] = (r["aircraft_type"], r["weekly_frequency"])
        distances[r["destination"]] = r["distance_km"]
    joint = _FLEET.check_schedule(schedule, extra_distances=distances)

    return {
        "weekly_frequency": weekly_frequency,
        "routes_analysed": len(results),
        "combined_fleet_check": {
            "shortlist": [r["destination"] for r in shortlist],
            "feasible": joint["feasible"] if shortlist else True,
            "shortfalls": joint["shortfalls"] if shortlist else [],
            "by_aircraft_type": joint["by_aircraft_type"] if shortlist else {},
            "note": (
                "Every route above is scored on its own. This is the answer to flying the "
                "whole shortlist at once."
                if shortlist
                else "Nothing on the shortlist to fly."
            ),
        },
        "ranked_routes": results,
        "errors": errors,
    }


if __name__ == "__main__":
    # 1. Flyable markets: cost/revenue accounting must be internally
    #    consistent, and breakeven load factor must be a real fraction.
    for _dest in ("SIN", "AKL", "LAX", "NRT"):
        _r = analyze_open_route(_dest)
        _f = _r["financials"]
        assert _r["operations"]["aircraft_in_range"], _dest
        assert 0 < _f["breakeven_load_factor"] < 1.0, (_dest, _f)
        assert _f["monthly_revenue_usd"] > 0 and _f["monthly_cost_usd"] > 0, (_dest, _f)

    # 2. A route beyond the fleet's range reports the shortfall and NOTHING
    #    that would let a reader treat it as a candidate.
    _lhr = analyze_open_route("LHR")
    assert _lhr["verdict"] == "NOT FEASIBLE", _lhr["verdict"]
    assert "financials" not in _lhr and "scoring" not in _lhr, sorted(_lhr)
    assert _lhr["pros"] == [], _lhr["pros"]
    assert _lhr["operations"]["range_shortfall_km"] > 0, _lhr["operations"]

    # 3. Load factor must be able to fall below the cap - it is an outcome of
    #    demand, not a target. A thin market cannot report a full aeroplane.
    _thin = analyze_open_route("APW", weekly_frequency=3)   # Apia, Samoa
    assert _thin["demand_estimate"]["load_factor_estimate"] < MAX_SELLABLE_LOAD_FACTOR, (
        _thin["demand_estimate"]
    )

    # 4. Share must respond to frequency, via the shared logit.
    _low = analyze_open_route("NRT", weekly_frequency=2)["market"]["pacific_wings_market_share_estimate"]
    _high = analyze_open_route("NRT", weekly_frequency=14)["market"]["pacific_wings_market_share_estimate"]
    assert _high > _low, (_low, _high)

    print(f"open_route_analyst self-check OK "
          f"(LHR short-circuits, APW LF={_thin['demand_estimate']['load_factor_estimate']}, "
          f"NRT share {_low}% -> {_high}% on 2 -> 14 weekly)")
