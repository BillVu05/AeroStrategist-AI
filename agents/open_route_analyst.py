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
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "simulation"))
sys.path.insert(0, str(ROOT / "ml"))

from world_airports import (  # noqa: E402
    lookup_airport,
    search_airports,
    COUNTRY_MACRO,
    haversine_km,
    SYD_LAT,
    SYD_LON,
)

# ─── constants ────────────────────────────────────────────────────────────────

KG_PER_GALLON = 3.03
WEEKS_PER_MONTH = 4.345
BASELINE_FUEL_USD_PER_GAL = 2.40   # near-term projected (2025)

ANCILLARY_PER_PAX = 25.0          # USD, consistent with revenue.py

CABIN_FARE_MULTIPLIERS = {
    "economy": 1.0,
    "premium_economy": 1.6,
    "business": 3.2,
}

# ─── aircraft specs (mirrors aircraft_specs.json) ────────────────────────────

_specs_raw = json.loads((ROOT / "data" / "aircraft_specs.json").read_text())["aircraft"]
AIRCRAFT: dict[str, dict] = {ac["type"]: ac for ac in _specs_raw}

# Aircraft selection by distance (with 5% reserve buffer: A320→5842km, A321neo→7030km, B787→13433km)
def _select_aircraft(distance_km: float) -> str:
    if distance_km <= 1800:
        return "A320-200"
    if distance_km <= 6800:   # safely under A321neo's 7400km range with 5% reserve
        return "A321neo"
    return "B787-9"

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

# ── Market size reference: calibrated against the SYD-SIN bilateral ───────────
# AU-SG total bilateral O&D passengers (all carriers, 2019): ~3.5M/year
# Source: BITRE Australian aviation statistics
_REF_MARKET   = 3_500_000   # AU-SG pax/year
_REF_GDP_B    = 547.0       # Singapore GDP (billions)
_REF_DIST_KM  = 6_293.0     # SYD-SIN distance (km)
_REF_TOURISM  = 19.1        # Singapore inbound tourism 2019 (millions)
_DIST_DECAY   = 1.30        # distance exponent (calibrated)

# Short-haul special case: domestic/trans-Tasman markets
# have much higher density than the gravity model predicts.
_SHORT_HAUL_KM = 2_500
_SHORT_HAUL_MARKET = 5_000_000   # conservative floor for dense AU-NZ routes


def _bilateral_market(gdp_dest_b: float, distance_km: float, tourism_m: float) -> float:
    """
    Total bilateral O&D market estimate (all carriers, annual passengers).

    Calibrated against the SYD-SIN route (3.5M/yr). Uses log-damped GDP ratio
    to prevent over-prediction for very large economies (US, China), and a
    square-root tourism factor so high-tourism destinations get a modest uplift.
    """
    if distance_km < _SHORT_HAUL_KM:
        # Short-haul: flat reference scaled by GDP only
        gdp_scale = (math.log(max(gdp_dest_b, 10)) / math.log(_REF_GDP_B)) ** 0.4
        return min(_SHORT_HAUL_MARKET * gdp_scale, 12_000_000)

    gdp_ratio  = (math.log(max(gdp_dest_b, 10)) / math.log(_REF_GDP_B)) ** 0.5
    dist_ratio = (_REF_DIST_KM / distance_km) ** _DIST_DECAY
    tour_ratio = math.sqrt(_tourism_factor(tourism_m) / _tourism_factor(_REF_TOURISM))

    return _REF_MARKET * gdp_ratio * dist_ratio * tour_ratio


# Pacific Wings market share model for a new route
def _new_entrant_share(n_existing_carriers: int, weekly_frequency: int) -> float:
    """Estimated Pacific Wings market share as a new entrant."""
    base = 0.20 / max(1, n_existing_carriers)
    frequency_boost = min(weekly_frequency / 14, 1.0) * 0.08
    return min(base + frequency_boost, 0.40)

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
    if tourism_m >= 50:    return 1.4
    if tourism_m >= 20:    return 1.25
    if tourism_m >= 10:    return 1.15
    if tourism_m >= 5:     return 1.05
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

# ─── main analysis function ───────────────────────────────────────────────────

def analyze_open_route(
    destination: str,
    aircraft_type: str | None = None,
    weekly_frequency: int = 3,
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
        weekly_frequency: Proposed weekly departures. Defaults to 3
            (typical launch frequency for a new long-haul route).
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
    # Add 5% range buffer for reserves/alternate fuel
    in_range = distance_km <= range_km * 0.95
    range_note = (
        f"{aircraft_type} has range {range_km:,} km; route is {distance_km:,.0f} km — "
        + ("within range." if in_range else f"EXCEEDS range by {distance_km - range_km:.0f} km. Aircraft upgrade required.")
    )

    seats = aircraft["seats"]
    total_seats = seats["total"]

    # ── 3. Market size estimation (calibrated bilateral model) ────────────────
    market_pax_annual = _bilateral_market(gdp_dest_b, distance_km, tourism_m)

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

    own_share = _new_entrant_share(n_existing_carriers, weekly_frequency)
    own_pax_annual = market_pax_annual * own_share

    # Capacity constraint
    capacity_annual = total_seats * weekly_frequency * WEEKS_PER_MONTH * 12
    passengers_annual = min(own_pax_annual, capacity_annual * 0.82)  # 82% target LF
    load_factor = passengers_annual / capacity_annual if capacity_annual > 0 else 0.0
    passengers_monthly = passengers_annual / 12

    # Confidence band: gravity models are ±40% accurate at this stage
    low_pax  = round(passengers_annual * 0.60)
    high_pax = round(passengers_annual * 1.40)

    # ── 4. Fare & revenue estimation ──────────────────────────────────────────
    avg_fare = avg_fare_usd if avg_fare_usd is not None else _estimate_fare(distance_km)

    # Weighted blended fare across cabin mix
    seat_shares = {cabin: seats.get(cabin, 0) / total_seats for cabin in CABIN_FARE_MULTIPLIERS}
    weighted_multiplier = sum(seat_shares.get(c, 0) * m for c, m in CABIN_FARE_MULTIPLIERS.items())
    base_economy_fare = avg_fare / weighted_multiplier if weighted_multiplier > 0 else avg_fare

    ticket_rev_monthly = sum(
        passengers_monthly * seat_shares.get(c, 0) * base_economy_fare * m
        for c, m in CABIN_FARE_MULTIPLIERS.items()
    )
    ancillary_rev_monthly = passengers_monthly * ANCILLARY_PER_PAX
    total_rev_monthly = ticket_rev_monthly + ancillary_rev_monthly
    total_rev_annual = total_rev_monthly * 12

    # ── 5. Cost estimation ────────────────────────────────────────────────────
    fuel_price = fuel_price_usd_per_gallon or BASELINE_FUEL_USD_PER_GAL
    fuel_burn_kg_h = aircraft["cruise_fuel_burn_kg_per_hour"]
    speed_kmh = aircraft["cruise_speed_kmh"]
    flight_hours = distance_km / speed_kmh

    fuel_cost_per_sector = fuel_burn_kg_h * flight_hours * (fuel_price / KG_PER_GALLON)
    fuel_cost_monthly = fuel_cost_per_sector * 2 * weekly_frequency * WEEKS_PER_MONTH  # 2 legs

    ask_monthly = total_seats * distance_km * weekly_frequency * WEEKS_PER_MONTH
    non_fuel_casm = aircraft["casm_usd"] - (
        fuel_burn_kg_h * (BASELINE_FUEL_USD_PER_GAL / KG_PER_GALLON) / (total_seats * speed_kmh)
    )
    non_fuel_cost_monthly = non_fuel_casm * ask_monthly

    total_cost_monthly = fuel_cost_monthly + non_fuel_cost_monthly
    total_cost_annual = total_cost_monthly * 12

    profit_monthly = total_rev_monthly - total_cost_monthly
    profit_annual = total_rev_annual - total_cost_annual
    margin = profit_annual / total_rev_annual if total_rev_annual > 0 else 0.0

    # Breakeven load factor
    cost_per_pax = total_cost_monthly / passengers_monthly if passengers_monthly > 0 else 0
    breakeven_pax_monthly = total_cost_monthly / avg_fare if avg_fare > 0 else 0
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

    overall_risk = round(
        0.25 * risk_geo + 0.20 * risk_fx + 0.25 * risk_demand +
        0.15 * risk_competition + 0.15 * risk_financial,
        2
    )

    # ── 7. Multi-factor strategic score (0-100) ───────────────────────────────
    demand_score = min(100, max(0, round(
        20 * math.log10(max(market_pax_annual, 1) / 500_000 + 1)
        + 30 * min(load_factor / 0.82, 1.0)
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
    if not in_range:
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
    if market_pax_annual > 2_000_000:
        pros.append(f"Large bilateral market: estimated {market_pax_annual/1e6:.1f}M total annual passengers (all carriers).")
    elif market_pax_annual > 800_000:
        pros.append(f"Moderate bilateral market: ~{market_pax_annual/1e6:.1f}M total annual passengers (all carriers).")
    else:
        cons.append(f"Small bilateral market: estimated {market_pax_annual/1000:.0f}K total annual passengers — limited scale.")

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
        cons.append(f"Estimated loss at launch ({weekly_frequency}×/week): ${profit_annual/1e6:.1f}M/year. Higher frequency or fare needed.")

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

    # Distance / operations
    if in_range:
        if distance_km >= 8000:
            pros.append(f"Long-haul route ({distance_km:,.0f} km) — higher per-trip revenue; builds premium brand.")
        elif distance_km >= 4000:
            pros.append(f"Medium-haul route ({distance_km:,.0f} km) — good unit economics for the {aircraft_type}.")
    else:
        cons.append(f"Route distance ({distance_km:,.0f} km) exceeds {aircraft_type} range ({range_km:,} km). Requires fleet upgrade or stopping rights.")

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
            "monthly_capacity_seats": round(capacity_annual / 12),
        },
        "demand_estimate": {
            "annual_passengers_pacific_wings": round(passengers_annual),
            "monthly_passengers": round(passengers_monthly),
            "load_factor_estimate": round(load_factor, 3),
            "confidence_low_annual": low_pax,
            "confidence_high_annual": high_pax,
            "note": "Gravity model estimate ±40%; treat as order-of-magnitude for strategic screening.",
        },
        "financials": {
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
    weekly_frequency: int = 3,
    fuel_price_usd_per_gallon: float | None = None,
) -> dict:
    """
    Analyse and rank multiple potential new destinations side-by-side.

    Args:
        destinations: List of IATA codes or city names (2-8 destinations).
        weekly_frequency: Proposed weekly departures applied to all routes.
        fuel_price_usd_per_gallon: Optional fuel price scenario.

    Returns:
        Ranked list of routes with summary metrics for direct comparison.
    """
    results = []
    errors = []

    for dest in destinations[:8]:
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
            })

    results.sort(key=lambda r: r["composite_score"], reverse=True)

    return {
        "weekly_frequency": weekly_frequency,
        "routes_analysed": len(results),
        "ranked_routes": results,
        "errors": errors,
    }
