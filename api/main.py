"""
FastAPI app exposing the Phase 3 demand forecasting model.

Run:
    uvicorn api.main:app --reload
"""

import csv
import json
import sys
from pathlib import Path

import pandas as pd
import xgboost as xgb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = ROOT / "models"

sys.path.insert(0, str(ROOT / "ml"))
sys.path.insert(0, str(ROOT / "simulation"))
sys.path.insert(0, str(ROOT / "agents"))
from features import ReferenceData  # noqa: E402
from cost import CostModel  # noqa: E402
from revenue import RevenueModel  # noqa: E402
from engine import SimulationEngine  # noqa: E402
from presets import list_presets, preset_kwargs  # noqa: E402
from monte_carlo import MAX_SIMULATIONS, run_monte_carlo  # noqa: E402
from copilot import run_copilot  # noqa: E402
from context import market_context  # noqa: E402
from llm_client import get_client  # noqa: E402
from chat_agent import chat as run_chat  # noqa: E402
from future_analysis import (  # noqa: E402
    project_route_fundamentals,
    multi_year_route_projection,
    network_future_analysis,
)
from open_route_analyst import analyze_open_route, compare_route_alternatives  # noqa: E402
from open_route_agents import analyze_with_agents  # noqa: E402
from world_airports import search_airports  # noqa: E402

app = FastAPI(
    title="Airline Strategy Simulator API",
    description="Pacific Wings demand forecasting and simulation API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_model = xgb.XGBRegressor()
_model.load_model(MODELS_DIR / "demand_model.json")
_feature_columns = json.loads((MODELS_DIR / "feature_columns.json").read_text())
_metrics = json.loads((MODELS_DIR / "metrics.json").read_text())
# 80% empirical prediction interval: point forecast + the 10th/90th
# percentile residual (actual - predicted) observed on the real time-based
# 2024 holdout (ml/train_demand_model.py) - a residual-bootstrap-style band,
# not a model-based one. See docs/data_methodology.md.
_residual_p10 = _metrics["residual_quantiles"]["p10"]
_residual_p90 = _metrics["residual_quantiles"]["p90"]
_ref = ReferenceData()
_cost_model = CostModel()
_revenue_model = RevenueModel()
_engine = SimulationEngine()

_airline_profile = json.loads((ROOT / "data" / "airline_profile.json").read_text())
with open(ROOT / "data" / "reference" / "airports.csv", newline="") as f:
    _airports = {row["iata"]: row for row in csv.DictReader(f)}


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class DemandForecastResponse(BaseModel):
    origin: str
    destination: str
    year: int
    month: int
    avg_fare_usd: float
    predicted_passengers: int
    predicted_passengers_low: int
    predicted_passengers_high: int
    capacity_monthly: int
    predicted_load_factor: float
    predicted_load_factor_low: float
    predicted_load_factor_high: float


def _forecast_demand(destination: str, year: int, month: int, avg_fare_usd: float | None) -> dict:
    try:
        route = _ref.route(destination)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown destination: {destination}")

    features = _ref.build_features(destination, year, month, avg_fare_usd)
    X = pd.DataFrame([features])[_feature_columns]
    predicted_passengers = float(_model.predict(X)[0])

    capacity_monthly = _ref.capacity_monthly(destination)
    predicted_load_factor = predicted_passengers / capacity_monthly

    # 80% empirical prediction interval - point forecast +/- the real
    # holdout's residual quantiles, clamped to [0, capacity] since
    # passengers can't be negative or exceed the route's own seats.
    passengers_low = max(0.0, min(predicted_passengers + _residual_p10, capacity_monthly))
    passengers_high = max(0.0, min(predicted_passengers + _residual_p90, capacity_monthly))

    return {
        "route": route,
        "avg_fare_usd": features["avg_fare_usd"],
        "predicted_passengers": predicted_passengers,
        "predicted_passengers_low": passengers_low,
        "predicted_passengers_high": passengers_high,
        "capacity_monthly": capacity_monthly,
        "predicted_load_factor": predicted_load_factor,
        "predicted_load_factor_low": passengers_low / capacity_monthly,
        "predicted_load_factor_high": passengers_high / capacity_monthly,
    }


@app.get("/demand_forecast", response_model=DemandForecastResponse)
def demand_forecast(
    destination: str,
    year: int,
    month: int = Query(ge=1, le=12),
    avg_fare_usd: float | None = None,
    origin: str = "SYD",
):
    destination = destination.upper()
    forecast = _forecast_demand(destination, year, month, avg_fare_usd)

    return DemandForecastResponse(
        origin=forecast["route"]["origin"],
        destination=destination,
        year=year,
        month=month,
        avg_fare_usd=forecast["avg_fare_usd"],
        predicted_passengers=round(forecast["predicted_passengers"]),
        predicted_passengers_low=round(forecast["predicted_passengers_low"]),
        predicted_passengers_high=round(forecast["predicted_passengers_high"]),
        capacity_monthly=round(forecast["capacity_monthly"]),
        predicted_load_factor=round(forecast["predicted_load_factor"], 4),
        predicted_load_factor_low=round(forecast["predicted_load_factor_low"], 4),
        predicted_load_factor_high=round(forecast["predicted_load_factor_high"], 4),
    )


@app.get("/route_economics")
def route_economics(
    destination: str,
    year: int,
    month: int = Query(ge=1, le=12),
    avg_fare_usd: float | None = None,
    fuel_price_usd_per_gallon: float | None = None,
    origin: str = "SYD",
):
    """Combines Phase 3-5: demand forecast -> revenue breakdown -> cost breakdown -> profit."""
    destination = destination.upper()
    forecast = _forecast_demand(destination, year, month, avg_fare_usd)

    revenue = _revenue_model.monthly_revenue(
        destination, forecast["predicted_passengers"], forecast["avg_fare_usd"]
    )
    cost = _cost_model.monthly_cost(destination, fuel_price_usd_per_gallon)

    return {
        "origin": forecast["route"]["origin"],
        "destination": destination,
        "year": year,
        "month": month,
        "demand": {
            "predicted_passengers": round(forecast["predicted_passengers"]),
            "capacity_monthly": round(forecast["capacity_monthly"]),
            "predicted_load_factor": round(forecast["predicted_load_factor"], 4),
        },
        "revenue": revenue,
        "cost": cost,
        "profit_usd": round(revenue["total_revenue_usd"] - cost["total_cost_usd"], 2),
    }


@app.get("/what_if_presets")
def what_if_presets():
    """Phase 10: lists the named what-if presets available to /what_if."""
    return list_presets()


@app.get("/what_if")
def what_if(
    destination: str,
    year: int,
    month: int = Query(ge=1, le=12),
    price_delta_pct: float = 0.0,
    frequency_delta: int = 0,
    fuel_price_usd_per_gallon: float | None = None,
    aircraft_type: str | None = None,
    rating_delta: float = 0.0,
    preset: str | None = None,
):
    """
    Phase 7 simulation engine: compares a baseline (current operations) against
    a scenario with the given deltas, covering demand, revenue, cost, profit,
    and market share.

    Phase 10: pass `preset` (see /what_if_presets) to apply a named scenario
    (e.g. "fuel_price_shock", "tourism_boom", "competitor_entry") instead of,
    or alongside, the manual deltas above. Preset values take precedence over
    manual deltas for any overlapping parameter.
    """
    destination = destination.upper()
    scenario_kwargs = {
        "price_delta_pct": price_delta_pct,
        "frequency_delta": frequency_delta,
        "fuel_price_usd_per_gallon": fuel_price_usd_per_gallon,
        "aircraft_type": aircraft_type,
        "rating_delta": rating_delta,
    }

    try:
        if preset is not None:
            scenario_kwargs.update(preset_kwargs(_engine, preset, destination))
        result = _engine.compare(destination, year, month, **scenario_kwargs)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    if preset is not None:
        result["preset"] = {"name": preset, **list_presets()[preset]}
    return result


@app.get("/monte_carlo")
def monte_carlo(
    destination: str,
    year: int,
    month: int = Query(ge=1, le=12),
    n_simulations: int = Query(500, ge=100, le=MAX_SIMULATIONS),
    price_delta_pct: float = 0.0,
    frequency_delta: int = 0,
    aircraft_type: str | None = None,
    rating_delta: float = 0.0,
):
    """
    Phase 5 (real-data rebuild): Monte Carlo scenario simulator. Samples fuel
    price, GDP growth, and competitor-entry uncertainty (see
    simulation/monte_carlo.py for distributions and real-data sourcing) and
    runs n_simulations SimulationEngine passes, returning an outcome
    distribution (profit, passengers, load factor, market share) - including
    percentiles, a profit histogram, and the probability of an overall loss
    - instead of a single point estimate. price_delta_pct/frequency_delta/
    aircraft_type/rating_delta are held fixed across all trials.
    """
    destination = destination.upper()
    scenario_kwargs = {
        "price_delta_pct": price_delta_pct,
        "frequency_delta": frequency_delta,
        "aircraft_type": aircraft_type,
        "rating_delta": rating_delta,
    }
    try:
        return run_monte_carlo(_engine, destination, year, month, n_simulations=n_simulations, **scenario_kwargs)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/copilot")
def copilot(
    destination: str,
    year: int,
    month: int = Query(ge=1, le=12),
    price_delta_pct: float = 0.0,
    frequency_delta: int = 0,
    fuel_price_usd_per_gallon: float | None = None,
    aircraft_type: str | None = None,
    rating_delta: float = 0.0,
    preset: str | None = None,
):
    """
    Phase 8-9: runs the LangGraph agent pipeline (Market, Demand, Finance,
    Risk, Strategy) over the Phase 7 simulation for the given route/scenario
    and returns an executive summary. Demand/finance figures come directly
    from the simulation engine; market/risk/strategy commentary comes from
    Claude and degrades to a notice if ANTHROPIC_API_KEY is not set.

    Phase 10: pass `preset` (see /what_if_presets) to run the agents over a
    named what-if scenario instead of, or alongside, the manual deltas above.
    """
    destination = destination.upper()
    scenario_kwargs = {
        "price_delta_pct": price_delta_pct,
        "frequency_delta": frequency_delta,
        "fuel_price_usd_per_gallon": fuel_price_usd_per_gallon,
        "aircraft_type": aircraft_type,
        "rating_delta": rating_delta,
    }
    try:
        if preset is not None:
            scenario_kwargs.update(preset_kwargs(_engine, preset, destination))
        return run_copilot(destination, year, month, **scenario_kwargs)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/chat")
def chat(req: ChatRequest):
    """
    Conversational AI executive team: a single Gemini conversation with
    function-calling tools (agents/chat_agent.py) over the simulation engine
    and market context. Degrades to a notice if GEMINI_API_KEY is not set.
    """
    return run_chat([m.model_dump() for m in req.messages])


@app.get("/routes")
def routes():
    """Phase 11: merges airline_profile.json routes with airport coordinates for the Route Explorer map."""
    origin_iata = _airline_profile["airline"]["base"]
    origin_airport = _airports[origin_iata]

    route_list = []
    for route in _airline_profile["routes"]:
        airport = _airports[route["destination"]]
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


@app.get("/market_context")
def market_context_endpoint(destination: str, year: int = 2024):
    """Real macro (GDP, population, tourism) and calibrated-synthetic
    competitor data for a destination's market - the same data the chat
    agent's `get_market_context` tool uses, exposed for the frontend."""
    destination = destination.upper()
    try:
        return market_context(destination, year)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/macro_projection")
def macro_projection(
    destination: str,
    from_year: int = 2024,
    to_year: int = 2030,
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
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/future_analysis")
def future_analysis(
    destination: str,
    from_year: int = 2024,
    to_year: int = 2030,
    price_delta_pct: float = 0.0,
    frequency_delta: int = 0,
    aircraft_type: str | None = None,
    rating_delta: float = 0.0,
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
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/network_future_analysis")
def network_future_analysis_endpoint(
    from_year: int = 2024,
    to_year: int = 2030,
):
    """
    Projects every Pacific Wings route (active and candidate) across
    [from_year, to_year] and ranks by total cumulative projected profit.

    Feeds projected macro into each route's simulation so market evolution
    is reflected. Use this for portfolio planning and capital allocation.
    """
    return network_future_analysis(from_year, to_year)


@app.get("/analyze_route")
def analyze_route_endpoint(
    destination: str = Query(..., description="IATA code or city name, e.g. 'LHR' or 'London'"),
    weekly_frequency: int = Query(3, description="Proposed weekly departures"),
    aircraft_type: str | None = Query(None, description="Force aircraft type (A320-200, A321neo, B787-9)"),
    avg_fare_usd: float | None = Query(None, description="Assumed one-way average fare (USD)"),
    fuel_price_usd_per_gallon: float | None = Query(None, description="Scenario fuel price"),
    n_existing_carriers: int | None = Query(None, description="Number of carriers already on route"),
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


@app.get("/analyze_route_agents")
def analyze_route_agents_endpoint(
    destination: str = Query(..., description="IATA code or city name, e.g. 'LHR' or 'London'"),
    weekly_frequency: int = Query(3, description="Proposed weekly departures"),
    aircraft_type: str | None = Query(None, description="Force aircraft type (A320-200, A321neo, B787-9)"),
    avg_fare_usd: float | None = Query(None, description="Assumed one-way average fare (USD)"),
    fuel_price_usd_per_gallon: float | None = Query(None, description="Scenario fuel price"),
    n_existing_carriers: int | None = Query(None, description="Number of carriers already on route"),
):
    """
    Same as /analyze_route, but also runs the five-agent narrative layer
    (agents/open_route_agents.py): separate Gemini calls for Market, Risk,
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


@app.get("/compare_routes")
def compare_routes_endpoint(
    destinations: str = Query(..., description="Comma-separated IATA codes or city names, e.g. 'LHR,DXB,JFK'"),
    weekly_frequency: int = Query(3, description="Proposed weekly departures (applied to all)"),
    fuel_price_usd_per_gallon: float | None = Query(None, description="Scenario fuel price"),
):
    """
    Side-by-side comparison of multiple potential new destinations, ranked by composite score.

    Accepts 2-8 destinations as a comma-separated string.
    """
    dest_list = [d.strip() for d in destinations.split(",") if d.strip()]
    if len(dest_list) < 2:
        raise HTTPException(status_code=400, detail="Provide at least 2 destinations separated by commas.")
    return compare_route_alternatives(
        dest_list,
        weekly_frequency=weekly_frequency,
        fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
    )


@app.get("/search_airports")
def search_airports_endpoint(
    query: str = Query(..., description="Airport name, IATA code, or city name"),
    limit: int = Query(8, description="Maximum number of results"),
):
    """
    Search the worldwide airport database by IATA code or city/airport name.

    Useful for autocomplete or resolving ambiguous city names before calling
    /analyze_route.
    """
    results = search_airports(query, limit=limit)
    return {"query": query, "results": results}


@app.get("/health")
def health():
    return {"status": "ok", "llm_available": get_client() is not None}
