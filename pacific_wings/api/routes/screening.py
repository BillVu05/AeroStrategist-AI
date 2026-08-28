"""
Screening destinations Pacific Wings does not fly yet.

These run the same simulation core as the network endpoints - the
gravity model only supplies a market size where no observed history
exists.
"""

from fastapi import APIRouter, HTTPException, Query

from pacific_wings.agents.open_route_agents import analyze_with_agents
from pacific_wings.analysis.open_route import analyze_open_route, compare_route_alternatives
from pacific_wings.analysis.world_airports import search_airports
from pacific_wings.api.config import (
    CARRIERS_MAX,
    CARRIERS_MIN,
    FARE_MAX,
    FARE_MIN,
    FUEL_PRICE_MAX,
    FUEL_PRICE_MIN,
    LLM_GUARDS,
    WEEKLY_FREQUENCY_MAX,
    WEEKLY_FREQUENCY_MIN,
)

router = APIRouter()


@router.get("/analyze_route")
def analyze_route_endpoint(
    destination: str = Query(..., description="IATA code or city name, e.g. 'LHR' or 'London'"),
    weekly_frequency: int | None = Query(
        None,
        ge=WEEKLY_FREQUENCY_MIN,
        le=WEEKLY_FREQUENCY_MAX,
        description="Proposed weekly departures. Omit to have the schedule sized to the market.",
    ),
    aircraft_type: str | None = Query(None, description="Force aircraft type (A320-200, A321neo, B787-9)"),
    avg_fare_usd: float | None = Query(None, ge=FARE_MIN, le=FARE_MAX, description="Assumed one-way economy fare (USD)"),
    fuel_price_usd_per_gallon: float | None = Query(None, ge=FUEL_PRICE_MIN, le=FUEL_PRICE_MAX, description="Scenario fuel price"),
    n_existing_carriers: int | None = Query(None, ge=CARRIERS_MIN, le=CARRIERS_MAX, description="Number of carriers already on route"),
):
    """
    Full strategic feasibility analysis for any proposed new route SYD → destination.

    Works for any airport worldwide — not limited to existing Pacific Wings routes.
    Returns market estimate, financial projections, risk scores, composite score,
    verdict, and pros/cons list.
    """
    return analyze_open_route(
        destination,
        aircraft_type=aircraft_type,
        weekly_frequency=weekly_frequency,
        avg_fare_usd=avg_fare_usd,
        fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
        n_existing_carriers=n_existing_carriers,
    )

@router.get("/analyze_route_agents", dependencies=LLM_GUARDS)
def analyze_route_agents_endpoint(
    destination: str = Query(..., description="IATA code or city name, e.g. 'LHR' or 'London'"),
    weekly_frequency: int | None = Query(
        None,
        ge=WEEKLY_FREQUENCY_MIN,
        le=WEEKLY_FREQUENCY_MAX,
        description="Proposed weekly departures. Omit to have the schedule sized to the market.",
    ),
    aircraft_type: str | None = Query(None, description="Force aircraft type (A320-200, A321neo, B787-9)"),
    avg_fare_usd: float | None = Query(None, ge=FARE_MIN, le=FARE_MAX, description="Assumed one-way economy fare (USD)"),
    fuel_price_usd_per_gallon: float | None = Query(None, ge=FUEL_PRICE_MIN, le=FUEL_PRICE_MAX, description="Scenario fuel price"),
    n_existing_carriers: int | None = Query(None, ge=CARRIERS_MIN, le=CARRIERS_MAX, description="Number of carriers already on route"),
):
    """
    Same as /analyze_route, but also runs the five-agent narrative layer
    (pacific_wings/agents/open_route_agents.py): separate Gemini calls for Market, Risk,
    and Strategy commentary, grounded in the deterministic figures - plus
    pure Demand/Finance summaries. Slower than /analyze_route (3 LLM calls),
    so the frontend fetches this on-demand rather than by default. Degrades
    to {"available": false} per section if no GEMINI_API_KEY is set.
    """
    return analyze_with_agents(
        destination,
        aircraft_type=aircraft_type,
        weekly_frequency=weekly_frequency,
        avg_fare_usd=avg_fare_usd,
        fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
        n_existing_carriers=n_existing_carriers,
    )

@router.get("/compare_routes")
def compare_routes_endpoint(
    destinations: str = Query(..., description="Comma-separated IATA codes or city names, e.g. 'LHR,DXB,JFK'"),
    weekly_frequency: int | None = Query(
        None,
        ge=WEEKLY_FREQUENCY_MIN,
        le=WEEKLY_FREQUENCY_MAX,
        description="Proposed weekly departures (applied to all). Omit to size each route.",
    ),
    fuel_price_usd_per_gallon: float | None = Query(None, ge=FUEL_PRICE_MIN, le=FUEL_PRICE_MAX, description="Scenario fuel price"),
):
    """
    Side-by-side comparison of multiple potential new destinations, ranked by composite score.

    Accepts 2-8 destinations as a comma-separated string.
    """
    dest_list = [d.strip() for d in destinations.split(",") if d.strip()]
    try:
        return compare_route_alternatives(
            dest_list,
            weekly_frequency=weekly_frequency,
            fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.get("/search_airports")
def search_airports_endpoint(
    query: str = Query(..., description="Airport name, IATA code, or city name"),
    limit: int = Query(8, ge=1, le=50, description="Maximum number of results"),
):
    """
    Search the worldwide airport database by IATA code or city/airport name.

    Useful for autocomplete or resolving ambiguous city names before calling
    /analyze_route.
    """
    results = search_airports(query, limit=limit)
    return {"query": query, "results": results}
