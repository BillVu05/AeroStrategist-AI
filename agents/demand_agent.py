"""
Demand agent (Phase 8).

Per PLAN.md: "Demand/Finance agents call the simulation engine directly (no
hallucinated numbers - numbers come from Phases 3-6, LLM only narrates
them)." This agent has no LLM dependency at all - it just extracts and
labels the demand-side facts already computed by SimulationEngine.compare().
"""


def summarize(simulation: dict) -> dict:
    """Extracts demand-side facts (baseline vs. scenario) from an engine.compare() result."""
    baseline = simulation["baseline"]["demand"]
    scenario = simulation["scenario"]["demand"]

    return {
        "baseline": baseline,
        "scenario": scenario,
        "delta": {
            "passengers_carried": simulation["delta"]["passengers_carried"],
            "load_factor": round(scenario["load_factor"] - baseline["load_factor"], 4),
        },
        "demand_constrained_by_capacity": scenario["demand_constrained_by_capacity"],
    }
