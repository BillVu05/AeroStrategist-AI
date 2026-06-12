"""
Phase 8 LangGraph orchestration.

Wires the five agents into a StateGraph:

  simulation -> demand -> finance -> market -> risk -> strategy

`simulation` is not one of the five named agents - it's a thin node that
calls SimulationEngine.compare() once so the Demand and Finance agents (and
the Market/Risk/Strategy agents, for grounding) all work from the same
numbers. Demand and Finance agents are pure functions over those numbers;
Market, Risk, and Strategy call Claude (agents/llm_client.py) and degrade
gracefully if ANTHROPIC_API_KEY is not set.
"""

import sys
from pathlib import Path
from typing import TypedDict

from langgraph.graph import END, StateGraph

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "simulation"))
from engine import SimulationEngine  # noqa: E402

import demand_agent  # noqa: E402
import finance_agent  # noqa: E402
import market_agent  # noqa: E402
import risk_agent  # noqa: E402
import strategy_agent  # noqa: E402
from context import market_context  # noqa: E402

_engine = SimulationEngine()


class CopilotState(TypedDict):
    destination: str
    year: int
    month: int
    scenario_kwargs: dict
    market_ctx: dict
    simulation: dict
    demand_summary: dict
    finance_summary: dict
    market_analysis: dict
    risk_analysis: dict
    strategy: dict


def _simulation_node(state: CopilotState) -> dict:
    simulation = _engine.compare(
        state["destination"], state["year"], state["month"], **state["scenario_kwargs"]
    )
    return {
        "simulation": simulation,
        "market_ctx": market_context(state["destination"], state["year"]),
    }


def _demand_node(state: CopilotState) -> dict:
    return {"demand_summary": demand_agent.summarize(state["simulation"])}


def _finance_node(state: CopilotState) -> dict:
    return {"finance_summary": finance_agent.summarize(state["simulation"])}


def _market_node(state: CopilotState) -> dict:
    return {"market_analysis": market_agent.analyze(state["market_ctx"])}


def _risk_node(state: CopilotState) -> dict:
    return {"risk_analysis": risk_agent.analyze(state["market_ctx"], state["simulation"])}


def _strategy_node(state: CopilotState) -> dict:
    strategy = strategy_agent.recommend(
        state["demand_summary"],
        state["finance_summary"],
        state["market_analysis"],
        state["risk_analysis"],
    )
    return {"strategy": strategy}


def build_graph():
    graph = StateGraph(CopilotState)

    graph.add_node("simulation", _simulation_node)
    graph.add_node("demand", _demand_node)
    graph.add_node("finance", _finance_node)
    graph.add_node("market", _market_node)
    graph.add_node("risk", _risk_node)
    graph.add_node("strategy", _strategy_node)

    graph.set_entry_point("simulation")
    graph.add_edge("simulation", "demand")
    graph.add_edge("demand", "finance")
    graph.add_edge("finance", "market")
    graph.add_edge("market", "risk")
    graph.add_edge("risk", "strategy")
    graph.add_edge("strategy", END)

    return graph.compile()
