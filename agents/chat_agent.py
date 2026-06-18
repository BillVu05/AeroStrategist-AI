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
from monte_carlo import run_monte_carlo  # noqa: E402

from context import market_context  # noqa: E402
from llm_client import DEFAULT_MODEL, UNAVAILABLE_NOTICE, get_client  # noqa: E402

sys.path.insert(0, str(ROOT / "simulation"))
from future_analysis import (  # noqa: E402
    project_route_fundamentals,
    multi_year_route_projection,
    network_future_analysis,
)
sys.path.insert(0, str(ROOT / "agents"))
from open_route_analyst import compare_route_alternatives  # noqa: E402
from open_route_agents import analyze_with_agents  # noqa: E402

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


def run_route_monte_carlo(
    destination: str,
    year: int = 2024,
    month: int = 6,
    n_simulations: int = 500,
    price_delta_pct: float = 0.0,
    frequency_delta: int = 0,
    aircraft_type: str | None = None,
    rating_delta: float = 0.0,
) -> dict:
    """Runs a Monte Carlo simulation for a route: instead of one deterministic
    number, it randomizes fuel price, GDP growth, and whether a new competitor
    enters (hundreds of times) and returns the resulting DISTRIBUTION of
    outcomes - mean/percentiles for profit, passengers, load factor, and
    market share, plus the probability of an overall loss.

    Use this whenever the user asks about risk, uncertainty, confidence,
    best/worst case, "how likely is X", or wants a probabilistic answer
    rather than a single point estimate. For a single deterministic
    scenario, use `simulate_route` instead.

    Always cite the probability_of_loss and the p10/p50/p90 of profit_usd
    when answering - these are the headline figures.

    Args:
        destination: Destination airport IATA code.
        year: Year to simulate. Defaults to 2024.
        month: Month to simulate (1-12). Defaults to 6 (June).
        n_simulations: Number of Monte Carlo trials (100-1000). Defaults to
            500 - higher gives smoother percentiles but is slower.
        price_delta_pct: Fractional fare change, held fixed across all
            trials (e.g. 0.1 for +10%).
        frequency_delta: Change in weekly flight frequency, held fixed.
        aircraft_type: Swap the assigned aircraft, held fixed.
        rating_delta: Change to Pacific Wings' service rating, held fixed.
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
        return {"error": str(exc)}


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


def project_macro_indicators(
    destination: str,
    from_year: int = 2024,
    to_year: int = 2032,
) -> dict:
    """Projects GDP, population, tourism arrivals, fuel price, and composite
    demand multiplier for a destination's market across a multi-year horizon.
    Use this when the user asks about economic outlook, demographic trends,
    tourism growth forecasts, or how the addressable market will evolve.

    The demand_multiplier shows how much bigger the total market will be
    relative to from_year (e.g. 1.25 = 25% larger market).

    GDP is projected via EWMA trend + IMF long-run mean reversion; tourism
    compounds pre-COVID structural CAGR from the 2019 baseline; fuel uses a
    mean-reverting equilibrium model.

    Args:
        destination: Destination IATA code (call list_routes first to resolve
            a city name).
        from_year: Start of projection horizon. Defaults to 2024.
        to_year: End of projection horizon (inclusive). Defaults to 2032.
    """
    destination = destination.upper()
    try:
        return project_route_fundamentals(destination, from_year, to_year)
    except KeyError as exc:
        return {"error": str(exc)}


def analyze_long_term_market(
    destination: str,
    from_year: int = 2024,
    to_year: int = 2032,
    price_delta_pct: float = 0.0,
    frequency_delta: int = 0,
    aircraft_type: str | None = None,
) -> dict:
    """Runs a full multi-year demand, revenue, cost, and profit projection for
    a route using projected macro indicators (GDP, tourism, fuel prices) as
    model inputs for each year — not a static snapshot.

    Use this when the user asks about long-term route viability, multi-year
    P&L trajectories, or how a route will perform over a 5+ year horizon.
    Also use when comparing future performance under different operating
    assumptions (fare, frequency, aircraft swap).

    Returns annual totals (passengers, revenue, profit, load factor), year-on-
    year growth rates, passenger CAGR, and the macro context driving each year.

    Args:
        destination: Destination IATA code.
        from_year: Start year. Defaults to 2024.
        to_year: End year (inclusive). Defaults to 2032.
        price_delta_pct: Fractional fare change applied every year (e.g. 0.05
            for +5%). Use 0 for baseline operations.
        frequency_delta: Change in weekly frequency applied every year.
        aircraft_type: Aircraft to use every year (e.g. "B787-9").
    """
    destination = destination.upper()
    scenario_kwargs: dict = {}
    if price_delta_pct:
        scenario_kwargs["price_delta_pct"] = price_delta_pct
    if frequency_delta:
        scenario_kwargs["frequency_delta"] = frequency_delta
    if aircraft_type:
        scenario_kwargs["aircraft_type"] = aircraft_type

    try:
        return multi_year_route_projection(destination, from_year, to_year, scenario_kwargs=scenario_kwargs)
    except KeyError as exc:
        return {"error": str(exc)}


def rank_network_long_term(
    from_year: int = 2025,
    to_year: int = 2032,
) -> dict:
    """Ranks every Pacific Wings route (active and candidate) by total
    cumulative projected profit over a multi-year horizon, using projected
    macro indicators so market growth is reflected.

    Use this for portfolio planning, capital allocation, or questions like
    "which routes will be our best long-term earners?" or "where should we
    invest for maximum 5-year return?"

    Returns routes sorted by total projected profit with demand multipliers,
    CAGR, and start/end year comparisons.

    Args:
        from_year: Start of analysis horizon. Defaults to 2025.
        to_year: End of analysis horizon (inclusive). Defaults to 2032.
    """
    return network_future_analysis(from_year, to_year)


def analyze_new_route(
    destination: str,
    weekly_frequency: int = 3,
    aircraft_type: str | None = None,
    avg_fare_usd: float | None = None,
    fuel_price_usd_per_gallon: float | None = None,
    n_existing_carriers: int | None = None,
) -> dict:
    """Performs a full strategic feasibility analysis for ANY proposed new route
    from Sydney (SYD) to the given destination — including cities not currently
    served by Pacific Wings. Works for any airport worldwide.

    Use this whenever the user asks about opening a new route, evaluating a new
    destination, or whether it makes sense to fly to a specific city. Do NOT
    limit yourself to the five existing Pacific Wings routes — call this for any
    city or airport worldwide.

    Returns: airport info, total bilateral market estimate, Pacific Wings demand
    estimate, financial projections (revenue, cost, profit, margin, breakeven LF),
    risk scores (geopolitical, currency, demand, competition, financial), a
    composite score (0-100), a strategic verdict (PROCEED / PROCEED WITH CAUTION
    / DO NOT PROCEED / NOT FEASIBLE), a pros/cons list, AND an "agent_evidence"
    block with five independently-generated perspectives: "demand" and
    "finance" (computed facts, no LLM), plus "market", "risk", and "strategy" -
    each its own separate Gemini call (real distinct AI agents, not one voice)
    with its own "commentary"/"risks"/"executive_summary" text grounded only in
    the deterministic figures above it.

    All figures are order-of-magnitude estimates (±30-40%) suitable for strategic
    screening; use simulate_route for precise analysis of routes already in the
    Pacific Wings network.

    Args:
        destination: IATA code (e.g. "LHR", "JFK") or city name (e.g. "London",
            "Dubai", "Tokyo"). Works for any major airport worldwide.
        weekly_frequency: Proposed weekly departures. Defaults to 3 (typical
            launch frequency for a new long-haul route).
        aircraft_type: Force a specific aircraft ("A320-200", "A321neo",
            "B787-9"). Auto-selected from distance if omitted.
        avg_fare_usd: Assumed one-way average fare. Auto-estimated if omitted.
        fuel_price_usd_per_gallon: Scenario fuel price (defaults to $2.40/gal).
        n_existing_carriers: Number of carriers already on this route. Auto-
            estimated from market size and popularity if omitted.
    """
    return analyze_with_agents(
        destination,
        aircraft_type=aircraft_type,
        weekly_frequency=weekly_frequency,
        avg_fare_usd=avg_fare_usd,
        fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
        n_existing_carriers=n_existing_carriers,
    )


def compare_new_routes(
    destinations: list[str],
    weekly_frequency: int = 3,
    fuel_price_usd_per_gallon: float | None = None,
) -> dict:
    """Compares multiple potential new destinations side-by-side and ranks them
    by composite strategic score. Use this when the user wants to shortlist
    route candidates, compare two or more new destinations, or asks which of
    several cities is the best opportunity for Pacific Wings.

    Works for any airports worldwide — not limited to existing routes.

    Args:
        destinations: List of 2-8 IATA codes or city names to compare (e.g.
            ["DXB", "DEL", "JFK"] or ["Dubai", "Delhi", "New York"]).
        weekly_frequency: Proposed weekly departures applied to all routes.
            Defaults to 3.
        fuel_price_usd_per_gallon: Optional fuel price scenario (defaults to
            current reference price).
    """
    return compare_route_alternatives(
        destinations,
        weekly_frequency=weekly_frequency,
        fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
    )


CHAT_TOOLS = [
    list_routes,
    list_what_if_presets,
    simulate_route,
    run_route_monte_carlo,
    get_market_context,
    forecast_demand_trend,
    rank_future_opportunities,
    project_macro_indicators,
    analyze_long_term_market,
    rank_network_long_term,
    analyze_new_route,
    compare_new_routes,
]


SYSTEM_PROMPT = """You are the AI executive leadership team for Pacific Wings, a \
fictional Sydney-based airline - combining the perspectives of the Demand, \
Finance, Market, Risk, and Strategy functions into one conversational voice.

You can analyse ANY airline decision — not just existing Pacific Wings routes. \
You have tools to evaluate new routes to any city in the world, compare \
destination shortlists, and assess the pros/cons of any strategic move.

Ground rules:
- Never invent numbers. For any question involving revenue, cost, profit, \
passengers, load factor, market share, or the effect of a price/frequency/\
fuel/aircraft/rating change ON AN EXISTING ROUTE, call `simulate_route` and \
cite the returned figures exactly.
- For questions about risk, uncertainty, confidence, best/worst case, "how \
likely is X", or anything asking for a probability rather than a single \
number, call `run_route_monte_carlo` instead of `simulate_route` and cite \
`probability_of_loss` plus the p10/p50/p90 of `profit_usd`.
- For new route analysis to ANY worldwide destination (a city not already in \
the Pacific Wings network), ALWAYS call `analyze_new_route`. Do not refuse or \
say a destination is out of scope — you can analyse London, Dubai, New York, \
Tokyo, Mumbai, or any major airport. If the user asks about a single new \
destination, call `analyze_new_route`. If they want to compare several, call \
`compare_new_routes` instead (no per-agent report for comparisons - summarise \
the ranking table).
- `analyze_new_route`'s response includes an `agent_evidence` block written by \
five separate AI agents, each grounded only in the figures above it. For these \
single-destination "should we open a route" questions, write your reply as a \
report using EXACTLY these five markdown headers, in this order: \
`## Demand Agent`, `## Finance Agent`, `## Market Agent`, `## Risk Agent`, \
`## Strategy Agent`. Under Demand and Finance, state the key figures from \
`agent_evidence.demand` / `agent_evidence.finance` in 1-2 sentences. Under \
Market, Risk, and Strategy, reproduce the `commentary` / `risks` / \
`executive_summary` text from `agent_evidence` close to verbatim - these are \
genuine separate AI analyst outputs, not yours to rewrite. End with a final \
line: **Verdict: <verdict>**.
- For multi-year trend, growth, or forecast questions up to 3 years, call \
`forecast_demand_trend` and cite the exact annual figures returned. For \
5+ year horizons or questions that depend on evolving macro (GDP growth, \
tourism recovery, fuel price trajectory), call `analyze_long_term_market` \
instead — it feeds projected macro into each simulation year.
- For questions about future route opportunities, portfolio performance, or \
ranking routes by future potential over a short horizon, call \
`rank_future_opportunities`. For multi-year portfolio planning (5+ years, \
capital allocation, long-run ranking), call `rank_network_long_term`.
- For questions about economic outlook, GDP forecasts, tourism growth, \
demographic trends, or fuel price trajectories for an EXISTING route, call \
`project_macro_indicators` and cite the returned figures.
- For qualitative questions about demand drivers, tourism, the economy, or \
competitors on an EXISTING route, call `get_market_context` and interpret \
that data - do not invent statistics beyond what is given.
- If the user names a city or route, first check `list_routes` to see if it \
is already in the Pacific Wings network. If it is, use the simulation tools \
(`simulate_route`, `forecast_demand_trend`, etc.). If it is NOT in the \
network, use `analyze_new_route` instead.
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
                max_output_tokens=4096,
                # Thinking tokens count against max_output_tokens and can
                # silently truncate the final reply (e.g. mid-report); tool
                # selection here doesn't need extended reasoning.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
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
