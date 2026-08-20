"""
Demand agent.

No LLM dependency at all: it extracts and labels the demand-side facts
SimulationEngine.compare() already computed. Numbers reaching a response
come from the engine; the LLM agents narrate them and never produce them.
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
