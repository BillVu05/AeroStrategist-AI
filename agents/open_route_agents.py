"""
Multi-agent narrative layer for new/candidate-route analysis (open_route_analyst.py).

`analyze_open_route()` is a deterministic gravity-model + cost/revenue engine -
no LLM involved. This module adds the same Demand/Finance/Market/Risk/Strategy
voice split used for existing routes (demand_agent.py, finance_agent.py,
market_agent.py, risk_agent.py, strategy_agent.py via agents/graph.py), adapted
to the open_route_analyst.py output shape so it also works for destinations
outside the Pacific Wings network.

Demand and Finance are pure label/extract functions (no LLM, matching
demand_agent.py/finance_agent.py). Market, Risk, and Strategy each make their
own Gemini call via agents/llm_client.py and degrade to UNAVAILABLE_NOTICE if
no key is configured or the call fails.
"""

import json

from llm_client import UNAVAILABLE_NOTICE, complete
from open_route_analyst import analyze_open_route

_PLAIN_TEXT_RULE = "Plain prose only - no LaTeX, no markdown math notation " \
"(write \"+/-30%\", never \"$\\pm$30%\" or similar)."

MARKET_SYSTEM_PROMPT = f"""You are the Market Analyst agent for Pacific Wings, a \
fictional Sydney-based airline, evaluating a CANDIDATE route not yet launched. \
You are given route, market-size, and competitor data (all order-of-magnitude \
estimates from a gravity model). Write a short (3-5 sentence) qualitative \
market commentary: demand drivers, tourism/economic trends, and competitive \
positioning. Do not invent statistics beyond what is given - only interpret \
the provided data qualitatively. {_PLAIN_TEXT_RULE}"""

RISK_SYSTEM_PROMPT = f"""You are the Risk Analyst agent for Pacific Wings, a \
fictional Sydney-based airline, evaluating a CANDIDATE route not yet launched. \
You are given geopolitical/currency/demand/competition/financial risk scores \
(0=low, 1=moderate, 2=elevated, 3=high) plus the underlying financial and \
operational figures. Identify the 2-4 most material risks to launching this \
route (one sentence each). Do not invent numbers - reference only the figures \
provided. {_PLAIN_TEXT_RULE}"""

STRATEGY_SYSTEM_PROMPT = f"""You are the Strategy agent for Pacific Wings, a \
fictional Sydney-based airline. You are given: (1) demand and financial \
estimates for a candidate new route, (2) market commentary, and (3) a risk \
assessment, all for the same proposed route. Write an executive summary (4-6 \
sentences) for airline leadership: state whether the route is favorable, cite \
the key profit/demand figures EXACTLY as given, weave in the market context \
and top risks, and give a clear recommendation (proceed / proceed with \
caution / do not proceed). Do not invent or alter any numbers - only use the \
figures provided. {_PLAIN_TEXT_RULE}"""


def _demand_summary(analysis: dict) -> dict:
    """Pure extract/label of demand-side facts - no LLM, mirrors demand_agent.py."""
    market = analysis["market"]
    demand = analysis["demand_estimate"]
    return {
        "bilateral_market_estimate_annual_pax": market["bilateral_market_estimate_annual_pax"],
        "pacific_wings_market_share_estimate_pct": market["pacific_wings_market_share_estimate"],
        "annual_passengers_pacific_wings": demand["annual_passengers_pacific_wings"],
        "load_factor_estimate": demand["load_factor_estimate"],
        "confidence_range_annual": [demand["confidence_low_annual"], demand["confidence_high_annual"]],
    }


def _finance_summary(analysis: dict) -> dict:
    """Pure extract/label of revenue/cost/profit facts - no LLM, mirrors finance_agent.py."""
    fin = analysis["financials"]
    return {
        "annual_revenue_usd": fin["annual_revenue_usd"],
        "annual_cost_usd": fin["annual_cost_usd"],
        "annual_profit_usd": fin["annual_profit_usd"],
        "operating_margin_pct": fin["operating_margin_pct"],
        "breakeven_load_factor": fin["breakeven_load_factor"],
    }


def market_commentary(analysis: dict) -> dict:
    """Returns {"available": bool, "commentary": str}."""
    user_message = (
        "Candidate route data (JSON):\n"
        f"{json.dumps({'route': analysis['route'], 'market': analysis['market']}, indent=2)}\n\n"
        "Write the market commentary."
    )
    commentary = complete(MARKET_SYSTEM_PROMPT, user_message)
    return {"available": commentary is not None, "commentary": commentary or UNAVAILABLE_NOTICE}


def risk_commentary(analysis: dict) -> dict:
    """Returns {"available": bool, "risks": str}."""
    user_message = (
        "Candidate route risk and financial data (JSON):\n"
        f"{json.dumps({'route': analysis['route'], 'risk': analysis['risk'], 'financials': analysis['financials'], 'operations': analysis['operations']}, indent=2)}\n\n"
        "Identify the key risks."
    )
    risks = complete(RISK_SYSTEM_PROMPT, user_message)
    return {"available": risks is not None, "risks": risks or UNAVAILABLE_NOTICE}


def strategy_summary(demand: dict, finance: dict, market: dict, risk: dict, verdict: str) -> dict:
    """Returns {"available": bool, "executive_summary": str}."""
    user_message = (
        "Demand summary (JSON):\n"
        f"{json.dumps(demand, indent=2)}\n\n"
        "Finance summary (JSON):\n"
        f"{json.dumps(finance, indent=2)}\n\n"
        "Market commentary:\n"
        f"{market.get('commentary', '')}\n\n"
        "Risk assessment:\n"
        f"{risk.get('risks', '')}\n\n"
        f"Deterministic model verdict (for reference only): {verdict}\n\n"
        "Write the executive summary and recommendation."
    )
    summary = complete(STRATEGY_SYSTEM_PROMPT, user_message, max_tokens=1024)
    return {"available": summary is not None, "executive_summary": summary or UNAVAILABLE_NOTICE}


def analyze_with_agents(
    destination: str,
    aircraft_type: str | None = None,
    weekly_frequency: int = 3,
    avg_fare_usd: float | None = None,
    fuel_price_usd_per_gallon: float | None = None,
    n_existing_carriers: int | None = None,
) -> dict:
    """
    Runs analyze_open_route() then layers the five-agent narrative on top: pure
    Demand/Finance summaries plus separate Market/Risk/Strategy Gemini calls,
    each grounded only in the deterministic analysis below them.

    Returns the same dict as analyze_open_route(), plus an "agent_evidence" key:
    {"demand": {...}, "finance": {...}, "market": {...}, "risk": {...}, "strategy": {...}}
    """
    analysis = analyze_open_route(
        destination,
        aircraft_type=aircraft_type,
        weekly_frequency=weekly_frequency,
        avg_fare_usd=avg_fare_usd,
        fuel_price_usd_per_gallon=fuel_price_usd_per_gallon,
        n_existing_carriers=n_existing_carriers,
    )
    if "error" in analysis:
        return analysis

    demand = _demand_summary(analysis)
    finance = _finance_summary(analysis)
    market = market_commentary(analysis)
    risk = risk_commentary(analysis)
    strategy = strategy_summary(demand, finance, market, risk, analysis["verdict"])

    analysis["agent_evidence"] = {
        "demand": demand,
        "finance": finance,
        "market": market,
        "risk": risk,
        "strategy": strategy,
    }
    return analysis
