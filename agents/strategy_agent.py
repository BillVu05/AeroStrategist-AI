"""
Strategy agent (Phase 8) / executive summary writer (Phase 9).

Synthesizes the Demand, Finance, Market, and Risk agent outputs into a
recommendation and executive summary. Per PLAN.md Phase 9: "LLM *explains*
simulation output, never invents figures" - this agent is given the exact
demand/finance numbers and is instructed to reference only those.
"""

import json

from llm_client import UNAVAILABLE_NOTICE, complete

SYSTEM_PROMPT = """You are the Strategy agent for Pacific Wings, a fictional \
Sydney-based airline. You are given: (1) demand and financial deltas from a \
deterministic simulation comparing a baseline to a proposed scenario, \
(2) market commentary, and (3) identified risks. Write an executive summary \
(4-6 sentences) for airline leadership: state whether the scenario is \
favorable, cite the key profit/demand figures EXACTLY as given, weave in the \
market context and top risks, and give a clear recommendation (proceed / \
proceed with caution / do not proceed). Do not invent or alter any numbers -\
only use the figures provided."""


def recommend(demand_summary: dict, finance_summary: dict, market_analysis: dict, risk_analysis: dict) -> dict:
    """Returns {"available": bool, "executive_summary": str}."""
    user_message = (
        "Demand summary (JSON):\n"
        f"{json.dumps(demand_summary, indent=2)}\n\n"
        "Finance summary (JSON):\n"
        f"{json.dumps(finance_summary, indent=2)}\n\n"
        "Market commentary:\n"
        f"{market_analysis.get('commentary', '')}\n\n"
        "Risk assessment:\n"
        f"{risk_analysis.get('risks', '')}\n\n"
        "Write the executive summary and recommendation."
    )

    summary = complete(SYSTEM_PROMPT, user_message, max_tokens=1024)

    return {
        "available": summary is not None,
        "executive_summary": summary or UNAVAILABLE_NOTICE,
    }
