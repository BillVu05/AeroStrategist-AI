"""
Demand and route economics for routes already in the network.

Both endpoints go through `SimulationEngine` rather than predicting
here, so they cannot drift from /what_if.
"""

from fastapi import APIRouter, Query

from pacific_wings.api.config import (
    FARE_MAX,
    FARE_MIN,
    FUEL_PRICE_MAX,
    FUEL_PRICE_MIN,
    YEAR_MAX,
    YEAR_MIN,
)
from pacific_wings.api.deps import cost_model, forecast_demand, revenue_model
from pacific_wings.api.schemas import DemandForecastResponse

router = APIRouter()


@router.get("/demand_forecast", response_model=DemandForecastResponse)
def demand_forecast(
    destination: str,
    year: int = Query(..., ge=YEAR_MIN, le=YEAR_MAX),
    month: int = Query(..., ge=1, le=12),
    avg_fare_usd: float | None = Query(None, ge=FARE_MIN, le=FARE_MAX),
    origin: str = "SYD",
):
    destination = destination.upper()
    forecast = forecast_demand(destination, year, month, avg_fare_usd)

    return DemandForecastResponse(
        origin=forecast["route"]["origin"],
        destination=destination,
        year=year,
        month=month,
        avg_fare_usd=forecast["avg_fare_usd"],
        market_passengers=round(forecast["market_passengers"]),
        market_passengers_low=round(forecast["market_passengers_low"]),
        market_passengers_high=round(forecast["market_passengers_high"]),
        pacific_wings_share=round(forecast["pacific_wings_share"], 4),
        predicted_passengers=round(forecast["predicted_passengers"]),
        predicted_passengers_low=round(forecast["predicted_passengers_low"]),
        predicted_passengers_high=round(forecast["predicted_passengers_high"]),
        capacity_monthly=round(forecast["capacity_monthly"]),
        sellable_seats=round(forecast["sellable_seats"]),
        passengers_carried=round(forecast["passengers_carried"]),
        spilled_passengers=round(forecast["spilled_passengers"]),
        predicted_load_factor=round(forecast["predicted_load_factor"], 4),
        predicted_load_factor_low=round(forecast["predicted_load_factor_low"], 4),
        predicted_load_factor_high=round(forecast["predicted_load_factor_high"], 4),
        confidence_pct=forecast["confidence"]["confidence_pct"],
        confidence_breakdown=forecast["confidence"]["confidence_breakdown"],
        confidence_notes=forecast["confidence"]["confidence_notes"],
    )

@router.get("/route_economics")
def route_economics(
    destination: str,
    year: int = Query(..., ge=YEAR_MIN, le=YEAR_MAX),
    month: int = Query(..., ge=1, le=12),
    avg_fare_usd: float | None = Query(None, ge=FARE_MIN, le=FARE_MAX),
    fuel_price_usd_per_gallon: float | None = Query(None, ge=FUEL_PRICE_MIN, le=FUEL_PRICE_MAX),
    origin: str = "SYD",
):
    """Combines Phase 3-5: demand forecast -> revenue breakdown -> cost breakdown -> profit."""
    destination = destination.upper()
    forecast = forecast_demand(destination, year, month, avg_fare_usd)

    # Revenue is earned on passengers CARRIED, not on unconstrained demand -
    # the spilled remainder never boards and never pays.
    revenue = revenue_model.monthly_revenue(
        destination, forecast["passengers_carried"], forecast["avg_fare_usd"]
    )
    cost = cost_model.monthly_cost(destination, fuel_price_usd_per_gallon)

    return {
        "origin": forecast["route"]["origin"],
        "destination": destination,
        "year": year,
        "month": month,
        "demand": {
            "market_passengers": round(forecast["market_passengers"]),
            "pacific_wings_share": round(forecast["pacific_wings_share"], 4),
            "predicted_passengers": round(forecast["predicted_passengers"]),
            "passengers_carried": round(forecast["passengers_carried"]),
            "spilled_passengers": round(forecast["spilled_passengers"]),
            "capacity_monthly": round(forecast["capacity_monthly"]),
            "predicted_load_factor": round(forecast["predicted_load_factor"], 4),
            "confidence_pct": forecast["confidence"]["confidence_pct"],
        },
        "revenue": revenue,
        "cost": cost,
        "profit_usd": round(revenue["total_revenue_usd"] - cost["total_cost_usd"], 2),
    }
