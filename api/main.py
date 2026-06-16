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
from copilot import run_copilot  # noqa: E402
from context import market_context  # noqa: E402
from llm_client import get_client  # noqa: E402
from chat_agent import chat as run_chat  # noqa: E402

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
    capacity_monthly: int
    predicted_load_factor: float


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

    return {
        "route": route,
        "avg_fare_usd": features["avg_fare_usd"],
        "predicted_passengers": predicted_passengers,
        "capacity_monthly": capacity_monthly,
        "predicted_load_factor": predicted_load_factor,
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
        capacity_monthly=round(forecast["capacity_monthly"]),
        predicted_load_factor=round(forecast["predicted_load_factor"], 4),
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


@app.get("/health")
def health():
    return {"status": "ok", "llm_available": get_client() is not None}
