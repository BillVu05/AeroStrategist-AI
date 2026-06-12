"""
Phase 9 LLM Copilot.

Thin orchestration wrapper around the Phase 8 LangGraph (agents/graph.py):
runs the simulation -> demand -> finance -> market -> risk -> strategy graph
for a route/scenario and returns a single response combining the
deterministic simulation numbers (Phases 3-6) with the LLM-narrated
market/risk/strategy commentary (Phase 8 agents).

The LLM only narrates - `simulation`, `demand`, and `finance` sections are
produced entirely by SimulationEngine and never touched by Claude.
"""

from graph import build_graph

_graph = build_graph()


def run_copilot(destination: str, year: int, month: int, **scenario_kwargs) -> dict:
    initial_state = {
        "destination": destination,
        "year": year,
        "month": month,
        "scenario_kwargs": scenario_kwargs,
    }

    result = _graph.invoke(initial_state)

    return {
        "origin": result["simulation"]["baseline"]["origin"],
        "destination": destination,
        "year": year,
        "month": month,
        "scenario": result["simulation"]["scenario"]["scenario"],
        "demand": result["demand_summary"],
        "finance": result["finance_summary"],
        "market_analysis": result["market_analysis"],
        "risk_analysis": result["risk_analysis"],
        "strategy": result["strategy"],
    }
