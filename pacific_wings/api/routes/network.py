"""
The existing network: its routes, their markets, and how both are
projected forward.
"""

from fastapi import APIRouter, HTTPException, Query

from pacific_wings.agents.context import market_context
from pacific_wings.api.config import (
    FREQUENCY_DELTA_MAX,
    FREQUENCY_DELTA_MIN,
    PRICE_DELTA_MAX,
    PRICE_DELTA_MIN,
    RATING_DELTA_MAX,
    RATING_DELTA_MIN,
    YEAR_MAX,
    YEAR_MIN,
)
from pacific_wings.api.deps import airline_profile, airports
from pacific_wings.simulation.future_analysis import (
    multi_year_route_projection,
    network_future_analysis,
    project_route_fundamentals,
)

router = APIRouter()


@router.get("/routes")
def routes():
    """Phase 11: merges airline_profile.json routes with airport coordinates for the Route Explorer map."""
    origin_iata = airline_profile["airline"]["base"]
    origin_airport = airports[origin_iata]

    route_list = []
    for route in airline_profile["routes"]:
        airport = airports[route["destination"]]
        route_list.append(
            {
                "destination": route["destination"],
                "destination_name": route["destination_name"],
                "destination_city": route["destination_city"],
                "destination_country": route["destination_country"],
                "lat": float(airport["lat"]),
                "lon": float(airport["lon"]),
                "distance_km": route["distance_km"],
                "status": route["status"],
                "weekly_frequency": route["weekly_frequency"],
                "assigned_aircraft": route["assigned_aircraft"],
                "flight_duration_hours": route["flight_duration_hours"],
                "market": route["market"],
            }
        )

    return {
        "origin": {
            "iata": origin_iata,
            "name": origin_airport["name"],
            "city": origin_airport["city"],
            "country": origin_airport["country"],
            "lat": float(origin_airport["lat"]),
            "lon": float(origin_airport["lon"]),
        },
        "routes": route_list,
    }

@router.get("/market_context")
def market_context_endpoint(destination: str, year: int = Query(2024, ge=YEAR_MIN, le=YEAR_MAX)):
    """Real macro (GDP, population, tourism) and calibrated-synthetic
    competitor data for a destination's market - the same data the chat
    agent's `get_market_context` tool uses, exposed for the frontend."""
    destination = destination.upper()
    try:
        return market_context(destination, year)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

@router.get("/macro_projection")
def macro_projection(
    destination: str,
    from_year: int = Query(2024, ge=YEAR_MIN, le=YEAR_MAX),
    to_year: int = Query(2030, ge=YEAR_MIN, le=YEAR_MAX),
):
    """
    Projects GDP, population, tourism arrivals, fuel price, and composite
    demand multiplier for a destination's market from from_year to to_year.

    Uses historical macro data (data/reference/macro_indicators.csv) as the
    anchor and applies country-specific growth models forward:
      - GDP: EWMA trend + mean reversion to IMF long-run rate
      - Population: OLS linear extrapolation
      - Tourism: pre-COVID structural CAGR compounded from 2019 baseline
      - Fuel: discrete Ornstein-Uhlenbeck mean-reversion
    """
    destination = destination.upper()
    try:
        return project_route_fundamentals(destination, from_year, to_year)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

@router.get("/future_analysis")
def future_analysis(
    destination: str,
    from_year: int = Query(2024, ge=YEAR_MIN, le=YEAR_MAX),
    to_year: int = Query(2030, ge=YEAR_MIN, le=YEAR_MAX),
    price_delta_pct: float = Query(0.0, ge=PRICE_DELTA_MIN, le=PRICE_DELTA_MAX),
    frequency_delta: int = Query(0, ge=FREQUENCY_DELTA_MIN, le=FREQUENCY_DELTA_MAX),
    aircraft_type: str | None = None,
    rating_delta: float = Query(0.0, ge=RATING_DELTA_MIN, le=RATING_DELTA_MAX),
):
    """
    Multi-year demand, revenue, cost, and profit projection for a single route
    using projected macro indicators (GDP, tourism, fuel) as model inputs.

    Unlike /what_if (which uses a static macro snapshot), this endpoint feeds
    year-by-year projected macro into each simulation, capturing how the total
    addressable market evolves over the horizon.

    Optional scenario overrides are applied uniformly across all projected years.
    """
    destination = destination.upper()
    scenario_kwargs: dict = {}
    if price_delta_pct:
        scenario_kwargs["price_delta_pct"] = price_delta_pct
    if frequency_delta:
        scenario_kwargs["frequency_delta"] = frequency_delta
    if aircraft_type:
        scenario_kwargs["aircraft_type"] = aircraft_type
    if rating_delta:
        scenario_kwargs["rating_delta"] = rating_delta

    try:
        return multi_year_route_projection(destination, from_year, to_year, scenario_kwargs=scenario_kwargs)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

@router.get("/network_future_analysis")
def network_future_analysis_endpoint(
    from_year: int = Query(2024, ge=YEAR_MIN, le=YEAR_MAX),
    to_year: int = Query(2030, ge=YEAR_MIN, le=YEAR_MAX),
):
    """
    Projects every Pacific Wings route (active and candidate) across
    [from_year, to_year] and ranks by total cumulative projected profit.

    Feeds projected macro into each route's simulation so market evolution
    is reflected. Use this for portfolio planning and capital allocation.
    """
    return network_future_analysis(from_year, to_year)
