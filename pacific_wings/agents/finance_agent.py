"""
Finance agent (Phase 8).

Same principle as the demand agent: no LLM dependency, just extracts and
labels the revenue/cost/profit facts already computed by
SimulationEngine.compare() (Phases 4-5).
"""


def summarize(simulation: dict) -> dict:
    """Extracts revenue/cost/profit facts (baseline vs. scenario) from an engine.compare() result."""
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
