"""
What-if scenarios: single runs, presets, Monte Carlo, and the LLM
copilot and chat that narrate them.
"""

from fastapi import APIRouter, HTTPException, Query

from pacific_wings.agents.chat_agent import chat as run_chat
from pacific_wings.agents.copilot import run_copilot
from pacific_wings.api.config import (
    FREQUENCY_DELTA_MAX,
    FREQUENCY_DELTA_MIN,
    FUEL_PRICE_MAX,
    FUEL_PRICE_MIN,
    LLM_GUARDS,
    PRICE_DELTA_MAX,
    PRICE_DELTA_MIN,
    RATING_DELTA_MAX,
    RATING_DELTA_MIN,
    YEAR_MAX,
    YEAR_MIN,
)
from pacific_wings.api.deps import engine
from pacific_wings.api.schemas import ChatRequest
from pacific_wings.simulation.monte_carlo import MAX_SIMULATIONS, run_monte_carlo
from pacific_wings.simulation.presets import list_presets, preset_kwargs

router = APIRouter()


@router.get("/what_if_presets")
def what_if_presets():
    """Phase 10: lists the named what-if presets available to /what_if."""
    return list_presets()

@router.get("/what_if")
def what_if(
    destination: str,
    year: int = Query(..., ge=YEAR_MIN, le=YEAR_MAX),
    month: int = Query(..., ge=1, le=12),
    price_delta_pct: float = Query(0.0, ge=PRICE_DELTA_MIN, le=PRICE_DELTA_MAX),
    frequency_delta: int = Query(0, ge=FREQUENCY_DELTA_MIN, le=FREQUENCY_DELTA_MAX),
    fuel_price_usd_per_gallon: float | None = Query(None, ge=FUEL_PRICE_MIN, le=FUEL_PRICE_MAX),
    aircraft_type: str | None = None,
    rating_delta: float = Query(0.0, ge=RATING_DELTA_MIN, le=RATING_DELTA_MAX),
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
            scenario_kwargs.update(preset_kwargs(engine, preset, destination))
        result = engine.compare(destination, year, month, **scenario_kwargs)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if preset is not None:
        result["preset"] = {"name": preset, **list_presets()[preset]}
    return result

@router.get("/monte_carlo")
def monte_carlo(
    destination: str,
    year: int = Query(..., ge=YEAR_MIN, le=YEAR_MAX),
    month: int = Query(..., ge=1, le=12),
    n_simulations: int = Query(500, ge=100, le=MAX_SIMULATIONS),
    price_delta_pct: float = Query(0.0, ge=PRICE_DELTA_MIN, le=PRICE_DELTA_MAX),
    frequency_delta: int = Query(0, ge=FREQUENCY_DELTA_MIN, le=FREQUENCY_DELTA_MAX),
    aircraft_type: str | None = None,
    rating_delta: float = Query(0.0, ge=RATING_DELTA_MIN, le=RATING_DELTA_MAX),
    fuel_price_center: float | None = Query(None, ge=FUEL_PRICE_MIN, le=FUEL_PRICE_MAX),
):
    """
    Phase 5 (real-data rebuild): Monte Carlo scenario simulator. Samples fuel
    price, GDP growth, and competitor-entry uncertainty (see
    pacific_wings/simulation/monte_carlo.py for distributions and real-data sourcing) and
    runs n_simulations SimulationEngine passes, returning an outcome
    distribution (profit, passengers, load factor, market share) - including
    percentiles, a profit histogram, and the probability of an overall loss
    - instead of a single point estimate. price_delta_pct/frequency_delta/
    aircraft_type/rating_delta are held fixed across all trials.

    fuel_price_center optionally shifts the real fuel-price distribution's
    center away from the latest reference price (e.g. for a stress-test
    scenario), keeping the same real volatility around the new center.
    """
    destination = destination.upper()
    scenario_kwargs = {
        "price_delta_pct": price_delta_pct,
        "frequency_delta": frequency_delta,
        "aircraft_type": aircraft_type,
        "rating_delta": rating_delta,
    }
    try:
        return run_monte_carlo(
            engine,
            destination,
            year,
            month,
            n_simulations=n_simulations,
            fuel_price_center=fuel_price_center,
            **scenario_kwargs,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

@router.get("/copilot", dependencies=LLM_GUARDS)
def copilot(
    destination: str,
    year: int = Query(..., ge=YEAR_MIN, le=YEAR_MAX),
    month: int = Query(..., ge=1, le=12),
    price_delta_pct: float = Query(0.0, ge=PRICE_DELTA_MIN, le=PRICE_DELTA_MAX),
    frequency_delta: int = Query(0, ge=FREQUENCY_DELTA_MIN, le=FREQUENCY_DELTA_MAX),
    fuel_price_usd_per_gallon: float | None = Query(None, ge=FUEL_PRICE_MIN, le=FUEL_PRICE_MAX),
    aircraft_type: str | None = None,
    rating_delta: float = Query(0.0, ge=RATING_DELTA_MIN, le=RATING_DELTA_MAX),
    preset: str | None = None,
):
    """
    Phase 8-9: runs the LangGraph agent pipeline (Market, Demand, Finance,
    Risk, Strategy) over the Phase 7 simulation for the given route/scenario
    and returns an executive summary. Demand/finance figures come directly
    from the simulation engine; market/risk/strategy commentary comes from
    Gemini and degrades to a notice if GEMINI_API_KEY is not set.

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
            scenario_kwargs.update(preset_kwargs(engine, preset, destination))
        return run_copilot(destination, year, month, **scenario_kwargs)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

@router.post("/chat", dependencies=LLM_GUARDS)
def chat(req: ChatRequest):
    """
    Conversational AI executive team: a single Gemini conversation with
    function-calling tools (pacific_wings/agents/chat_agent.py) over the simulation engine
    and market context. Degrades to a notice if GEMINI_API_KEY is not set.
    """
    return run_chat([m.model_dump() for m in req.messages])
