"""
FastAPI app exposing the Phase 3 demand forecasting model.

Run:
    uvicorn api.main:app --reload
"""

import json
import sys
from pathlib import Path

import pandas as pd
import xgboost as xgb
from fastapi import FastAPI, HTTPException, Query
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
from copilot import run_copilot  # noqa: E402

app = FastAPI(
    title="Airline Strategy Simulator API",
    description="Pacific Wings demand forecasting and simulation API",
    version="0.1.0",
)

_model = xgb.XGBRegressor()
_model.load_model(MODELS_DIR / "demand_model.json")
_feature_columns = json.loads((MODELS_DIR / "feature_columns.json").read_text())
_ref = ReferenceData()
_cost_model = CostModel()
_revenue_model = RevenueModel()
_engine = SimulationEngine()


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
):
    """
    Phase 7 simulation engine: compares a baseline (current operations) against
    a scenario with the given deltas, covering demand, revenue, cost, profit,
    and market share.
    """
    destination = destination.upper()
    try:
        return _engine.compare(
            destination,
            year,
            month,
            price_delta_pct=price_delta_pct,
            frequency_delta=frequency_delta,
            fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
            aircraft_type=aircraft_type,
            rating_delta=rating_delta,
        )
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
):
    """
    Phase 8-9: runs the LangGraph agent pipeline (Market, Demand, Finance,
    Risk, Strategy) over the Phase 7 simulation for the given route/scenario
    and returns an executive summary. Demand/finance figures come directly
    from the simulation engine; market/risk/strategy commentary comes from
    Claude and degrades to a notice if ANTHROPIC_API_KEY is not set.
    """
    destination = destination.upper()
    try:
        return run_copilot(
            destination,
            year,
            month,
            price_delta_pct=price_delta_pct,
            frequency_delta=frequency_delta,
            fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
            aircraft_type=aircraft_type,
            rating_delta=rating_delta,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/health")
def health():
    return {"status": "ok"}
