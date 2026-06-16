"""
Chat agent: conversational AI executive team for Pacific Wings.

A single Gemini conversation with automatic function-calling tools that wrap
the deterministic simulation engine (Phases 3-7, `simulation/engine.py`) and
the real market/macro context (`agents/context.py`). The model decides which
tools to call based on the user's free-form question, then writes one
unified executive answer citing the returned figures - no separate
Market/Risk/Strategy LLM calls (those remain in `agents/graph.py` for the
`/copilot` endpoint, untouched by this module).
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "simulation"))
sys.path.insert(0, str(ROOT / "ml"))

from engine import SimulationEngine  # noqa: E402
from presets import list_presets, preset_kwargs  # noqa: E402
from cost import latest_fuel_price  # noqa: E402

from context import market_context  # noqa: E402
from llm_client import DEFAULT_MODEL, UNAVAILABLE_NOTICE, get_client  # noqa: E402

from google.genai import errors, types  # noqa: E402

_engine = SimulationEngine()


def list_routes() -> dict:
    """Lists Pacific Wings' routes (active and candidate), with destination IATA
    codes, cities/countries, current weekly frequency, distance, assigned
    aircraft, and market data (tourism arrivals). Use this to resolve a city
    or country name (e.g. "Da Nang") to its IATA code and to check whether a
    route is already active or only a candidate, before calling other tools.
    """
    routes = []
    for route in _engine.ref.routes_by_destination.values():
        routes.append(
            {
                "destination": route["destination"],
                "destination_name": route["destination_name"],
                "destination_city": route["destination_city"],
                "destination_country": route["destination_country"],
                "status": route["status"],
                "weekly_frequency": route["weekly_frequency"],
                "distance_km": route["distance_km"],
                "assigned_aircraft": route["assigned_aircraft"],
                "flight_duration_hours": route["flight_duration_hours"],
                "market": route["market"],
            }
        )
    return {"origin": "SYD", "routes": routes}


def list_what_if_presets() -> dict:
    """Lists the named what-if scenario presets (e.g. fuel price shock, tourism
    boom, competitor entry) that can be passed as the `preset` argument to
    `simulate_route`.
    """
    return list_presets()


def simulate_route(
    destination: str,
    year: int = 2024,
    month: int = 6,
    price_delta_pct: float = 0.0,
    frequency_delta: int = 0,
    fuel_price_usd_per_gallon: float | None = None,
    fuel_price_delta_pct: float = 0.0,
    aircraft_type: str | None = None,
    rating_delta: float = 0.0,
    preset: str | None = None,
) -> dict:
    """Runs the deterministic simulation engine for a route, comparing a
    baseline (current operations) against a scenario with the given changes.
    Returns demand (passengers, load factor), revenue, cost, profit, and
    market share for both the baseline and the scenario, plus their deltas.

    Args:
        destination: Destination airport IATA code (e.g. "DAD" for Da Nang).
        year: Year to simulate. Defaults to 2024.
        month: Month to simulate (1-12). Defaults to 6 (June).
        price_delta_pct: Fractional change to the average fare, e.g. 0.1 for
            +10%, -0.05 for -5%.
        frequency_delta: Change in weekly flight frequency, e.g. 2 for two
            more flights per week.
        fuel_price_usd_per_gallon: Absolute scenario fuel price in USD per
            gallon. Use this OR fuel_price_delta_pct, not both.
        fuel_price_delta_pct: Fractional change to the current reference fuel
            price, e.g. 0.25 for "fuel prices rise 25%".
        aircraft_type: Swap the assigned aircraft for this route (e.g.
            "A321neo", "B787-9").
        rating_delta: Change to Pacific Wings' service rating, e.g. 0.2.
        preset: Name of a named what-if preset from `list_what_if_presets`
            (e.g. "fuel_price_shock", "tourism_boom", "competitor_entry").
            Preset values override the manual deltas above where they
            overlap.
    """
    destination = destination.upper()
    scenario_kwargs = {
        "price_delta_pct": price_delta_pct,
        "frequency_delta": frequency_delta,
        "fuel_price_usd_per_gallon": fuel_price_usd_per_gallon,
        "aircraft_type": aircraft_type,
        "rating_delta": rating_delta,
    }

    if fuel_price_delta_pct and scenario_kwargs["fuel_price_usd_per_gallon"] is None:
        scenario_kwargs["fuel_price_usd_per_gallon"] = round(
            latest_fuel_price() * (1 + fuel_price_delta_pct), 3
        )

    try:
        if preset is not None:
            scenario_kwargs.update(preset_kwargs(_engine, preset, destination))
        result = _engine.compare(destination, year, month, **scenario_kwargs)
    except KeyError as exc:
        return {"error": str(exc)}

    if preset is not None:
        result["preset"] = {"name": preset, **list_presets()[preset]}
    return result


def get_market_context(destination: str, year: int = 2024) -> dict:
    """Returns real macroeconomic, tourism, and competitor data for a
    destination's market: GDP and GDP growth, population, tourism arrivals,
    distance/flight duration, and competitor pricing/frequency/ratings. Use
    this for qualitative commentary on demand drivers and competitive
    positioning.

    Args:
        destination: Destination airport IATA code (e.g. "DAD" for Da Nang).
        year: Year for macro data lookup. Defaults to 2024.
    """
    destination = destination.upper()
    try:
        return market_context(destination, year)
    except KeyError as exc:
        return {"error": str(exc)}


def forecast_demand_trend(
    destination: str,
    start_year: int = 2024,
    end_year: int = 2027,
) -> dict:
    """Forecasts annual passenger demand, load factor, revenue, and profit for a
    route across multiple years by running 12 monthly simulations per year.
    Use this whenever the user asks about future demand, growth trajectory,
    revenue outlook, or multi-year projections for a route.

    Returns year-by-year totals with year-on-year growth rates. Always cite the
    exact figures returned.

    Args:
        destination: Destination IATA code (e.g. "DAD"). Call list_routes first
            to resolve a city name.
        start_year: First year to forecast. Defaults to 2024.
        end_year: Last year to forecast (inclusive). Defaults to 2027.
    """
    destination = destination.upper()
    forecast: dict[int, dict] = {}
    prev_pax: float | None = None

    for year in range(start_year, end_year + 1):
        annual_pax = 0.0
        annual_revenue = 0.0
        annual_profit = 0.0
        load_factors: list[float] = []
        monthly: list[dict] = []

        for month in range(1, 13):
            try:
                r = _engine.compare(destination, year, month)
                b = r["baseline"]
                pax = float(b["demand"]["passengers_carried"])
                rev = float(b["revenue"]["total_revenue_usd"])
                profit = float(b["profit_usd"])
                lf = float(b["demand"]["load_factor"])
                annual_pax += pax
                annual_revenue += rev
                annual_profit += profit
                load_factors.append(lf)
                monthly.append({"month": month, "passengers": round(pax), "load_factor": round(lf, 3)})
            except Exception:
                monthly.append({"month": month, "passengers": 0, "load_factor": 0.0})

        peak = max(monthly, key=lambda m: m["passengers"])
        avg_lf = sum(load_factors) / len(load_factors) if load_factors else 0.0
        yoy = round((annual_pax / prev_pax - 1) * 100, 1) if prev_pax else None

        forecast[year] = {
            "annual_passengers": round(annual_pax),
            "annual_revenue_usd": round(annual_revenue),
            "annual_profit_usd": round(annual_profit),
            "avg_load_factor": round(avg_lf, 3),
            "peak_month": peak["month"],
            "yoy_growth_pct": yoy,
            "monthly": monthly,
        }
        prev_pax = annual_pax

    return {"destination": destination, "forecast": forecast}


def rank_future_opportunities(year: int = 2026, month: int = 6) -> dict:
    """Ranks all Pacific Wings routes — active and candidate — by projected
    demand, revenue, and profit for a future target year and month. Use this
    to answer questions like 'which routes will perform best in 2026?', 'where
    should we invest next year?', or 'what is our growth opportunity pipeline?'

    Returns a list sorted from highest to lowest projected profit.

    Args:
        year: Target future year. Defaults to 2026.
        month: Representative month to simulate (1-12). Defaults to 6 (June).
    """
    ranked = []
    for route in _engine.ref.routes_by_destination.values():
        dest = route["destination"]
        try:
            r = _engine.compare(dest, year, month)
            b = r["baseline"]
            ranked.append({
                "destination": dest,
                "destination_city": route["destination_city"],
                "status": route["status"],
                "projected_passengers": round(b["demand"]["passengers_carried"]),
                "projected_revenue_usd": round(b["revenue"]["total_revenue_usd"]),
                "projected_profit_usd": round(b["profit_usd"]),
                "projected_load_factor": round(b["demand"]["load_factor"], 3),
                "projected_market_share_pct": round(b["market_share"]["pacific_wings_share"] * 100, 1),
            })
        except Exception:
            pass

    ranked.sort(key=lambda r: r["projected_profit_usd"], reverse=True)
    return {"year": year, "month": month, "routes": ranked}


CHAT_TOOLS = [
    list_routes,
    list_what_if_presets,
    simulate_route,
    get_market_context,
    forecast_demand_trend,
    rank_future_opportunities,
]


SYSTEM_PROMPT = """You are the AI executive leadership team for Pacific Wings, a \
fictional Sydney-based airline - combining the perspectives of the Demand, \
Finance, Market, Risk, and Strategy functions into one conversational voice.

Ground rules:
- Never invent numbers. For any question involving revenue, cost, profit, \
passengers, load factor, market share, or the effect of a price/frequency/\
fuel/aircraft/rating change, call `simulate_route` and cite the returned \
figures exactly.
- For multi-year trend, growth, or forecast questions, call \
`forecast_demand_trend` and cite the exact annual figures returned.
- For questions about future route opportunities, portfolio performance, or \
ranking routes by future potential, call `rank_future_opportunities`.
- For qualitative questions about demand drivers, tourism, the economy, or \
competitors, call `get_market_context` and interpret that data - do not \
invent statistics beyond what is given.
- If the user names a city, country, or route rather than an IATA code, call \
`list_routes` first to resolve it and to check whether the route is already \
active or only a candidate.
- If the user doesn't specify a time period, use year=2024, month=6 for \
point-in-time questions. For forecasts, default to start_year=2024, \
end_year=2027.
- For decision-style questions ("should we...?"), end with a clear \
recommendation: Proceed / Proceed with caution / Do not proceed, with 1-2 \
sentences of reasoning grounded in the figures and context above.
- Keep responses conversational but scannable: short paragraphs and bullet \
points, citing concrete numbers from the tools."""


def chat(messages: list[dict]) -> dict:
    """Runs one turn of the chat agent.

    Args:
        messages: Conversation history as a list of
            {"role": "user" | "model", "content": str} dicts.

    Returns:
        {"available": bool, "reply": str, "tool_calls": [{"name", "args", "result"}, ...]}
    """
    client = get_client()
    if client is None:
        return {"available": False, "reply": UNAVAILABLE_NOTICE, "tool_calls": []}

    contents = [
        types.Content(role=m["role"], parts=[types.Part(text=m["content"])]) for m in messages
    ]

    try:
        response = client.models.generate_content(
            model=DEFAULT_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                tools=CHAT_TOOLS,
                max_output_tokens=2048,
            ),
        )
    except (errors.ClientError, errors.ServerError, errors.APIError):
        return {"available": False, "reply": UNAVAILABLE_NOTICE, "tool_calls": []}

    tool_calls = []
    history = response.automatic_function_calling_history or []
    pending_call = None
    for content in history:
        for part in content.parts or []:
            if part.function_call is not None:
                pending_call = part.function_call
            elif part.function_response is not None and pending_call is not None:
                tool_calls.append(
                    {
                        "name": pending_call.name,
                        "args": dict(pending_call.args or {}),
                        "result": dict(part.function_response.response or {}),
                    }
                )
                pending_call = None

    return {
        "available": True,
        "reply": (response.text or "").strip(),
        "tool_calls": tool_calls,
    }
