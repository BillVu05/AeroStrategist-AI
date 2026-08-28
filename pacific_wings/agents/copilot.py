"""
The copilot report pipeline (`/copilot`).

    simulation -> demand -> finance -> market -> risk -> strategy

`simulation` is not one of the five named agents - it's one
SimulationEngine.compare() call, so every agent below works from the same
numbers. Demand and Finance are pure extractions from that result (no LLM,
no invented figures). Market, Risk and Strategy call Gemini
(pacific_wings/agents/llm_client.py) and degrade to a notice when
GEMINI_API_KEY is not set.

This used to be a LangGraph StateGraph in a separate module: six nodes wired
in one straight line, no branch, no retry, no persistence, one caller. The
sequence below is that graph, and the dependency it needed is gone.
"""

from pacific_wings.agents import market_agent, risk_agent, strategy_agent
from pacific_wings.agents.context import market_context
from pacific_wings.simulation.engine import SimulationEngine

_engine = SimulationEngine()


def summarize_demand(simulation: dict) -> dict:
    """Demand agent: labels the demand-side facts engine.compare() computed."""
    baseline = simulation["baseline"]["demand"]
    scenario = simulation["scenario"]["demand"]

    return {
        "baseline": baseline,
        "scenario": scenario,
        "delta": {
            "passengers_carried": simulation["delta"]["passengers_carried"],
            # Spill is what moves when a capacity-bound route is handed more
            # demand: the market grows, the aeroplanes do not, and profit can
            # sit perfectly still while the answer is "buy an aircraft".
            "spilled_passengers": simulation["delta"]["spilled_passengers"],
            "load_factor": round(scenario["load_factor"] - baseline["load_factor"], 4),
        },
        "demand_constrained_by_capacity": scenario["demand_constrained_by_capacity"],
        "market_passengers": scenario["market_passengers"],
        "fleet": simulation["scenario"]["fleet"],
    }


def summarize_finance(simulation: dict) -> dict:
    """Finance agent: labels the revenue/cost/profit facts engine.compare() computed."""
    baseline = simulation["baseline"]
    scenario = simulation["scenario"]

    return {
        "baseline": {
            "revenue_usd": baseline["revenue"]["total_revenue_usd"],
            "cost_usd": baseline["cost"]["total_cost_usd"],
            "profit_usd": baseline["profit_usd"],
        },
        "scenario": {
            "revenue_usd": scenario["revenue"]["total_revenue_usd"],
            "cost_usd": scenario["cost"]["total_cost_usd"],
            "profit_usd": scenario["profit_usd"],
        },
        "delta": {
            "profit_usd": simulation["delta"]["profit_usd"],
            "revenue_usd": round(
                scenario["revenue"]["total_revenue_usd"] - baseline["revenue"]["total_revenue_usd"], 2
            ),
            "cost_usd": round(scenario["cost"]["total_cost_usd"] - baseline["cost"]["total_cost_usd"], 2),
        },
    }


def brief(question: str | None, evidence: str | None = None) -> str | None:
    """
    The one steering string the Market, Risk and Strategy agents receive.

    `question` is the executive's own wording; `evidence` is the chat answer
    already on screen. Bundling them here rather than adding a second agent
    parameter keeps the three prompts unchanged, and telling the agents what
    has already been said is what turns the report from a restatement of the
    chat into a deeper pass over the same question.
    """
    if not question:
        return None
    if not evidence:
        return question
    return (
        f"{question}\n\n"
        "The executive has already seen this high-level answer in chat:\n"
        f"{evidence.strip()}\n\n"
        "Go deeper than it: add the detail, mechanism and caveats it skipped, "
        "and do not simply restate it."
    )


def run_copilot(
    destination: str,
    year: int,
    month: int,
    question: str | None = None,
    evidence: str | None = None,
    **scenario_kwargs,
) -> dict:
    """
    `question` is the executive's own question from the Copilot chat and
    `evidence` the chat reply it already produced. The numbers are unaffected
    by either - they only steer what the Market, Risk and Strategy agents talk
    about, so a "Generate full report" click deepens the answer to what was
    actually asked instead of producing a generic route write-up.
    """
    steer = brief(question, evidence)

    simulation = _engine.compare(destination, year, month, **scenario_kwargs)
    ctx = market_context(destination, year)

    demand_summary = summarize_demand(simulation)
    finance_summary = summarize_finance(simulation)
    market_analysis = market_agent.analyze(ctx, steer)
    risk_analysis = risk_agent.analyze(ctx, simulation, steer)
    strategy = strategy_agent.recommend(
        demand_summary, finance_summary, market_analysis, risk_analysis, steer
    )

    return {
        "origin": simulation["baseline"]["origin"],
        "destination": destination,
        "year": year,
        "month": month,
        "question": question,
        "scenario": simulation["scenario"]["scenario"],
        "demand": demand_summary,
        "finance": finance_summary,
        "market_analysis": market_analysis,
        "risk_analysis": risk_analysis,
        "strategy": strategy,
    }
