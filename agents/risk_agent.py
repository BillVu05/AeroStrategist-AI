"""
Risk agent (Phase 8).

Per PLAN.md: "Market/Risk agents can use real web/news context via LLM +
retrieval for qualitative factors (tourism trends, geopolitical notes)."

As with the Market agent, no live web/news retrieval is wired up here - the
agent reasons qualitatively over the route's market context plus the
scenario deltas already computed by the simulation engine (Phases 3-6). It
flags risks (fuel sensitivity, competitive response, demand concentration,
capacity constraints) without inventing new figures.
"""

import json

from llm_client import UNAVAILABLE_NOTICE, complete

SYSTEM_PROMPT = """You are the Risk Analyst agent for Pacific Wings, a fictional \
Sydney-based airline. You are given real macroeconomic/competitor data for a \
route and the output of a deterministic simulation comparing a baseline to a \
proposed scenario. Identify the 2-4 most material risks to the scenario \
(e.g. fuel price volatility, competitor response, demand/capacity mismatch, \
economic/tourism sensitivity). Be concise (one sentence per risk). Do not \
invent numbers - reference only the figures provided."""


def analyze(market_ctx: dict, simulation: dict) -> dict:
    """Returns {"available": bool, "risks": str}."""
    user_message = (
        "Route market data (JSON):\n"
        f"{json.dumps(market_ctx, indent=2)}\n\n"
        "Simulation comparison (baseline vs scenario, JSON):\n"
        f"{json.dumps(simulation, indent=2)}\n\n"
        "Identify the key risks."
    )

    risks = complete(SYSTEM_PROMPT, user_message)

    return {
        "available": risks is not None,
        "risks": risks or UNAVAILABLE_NOTICE,
    }
