"""
Market agent (Phase 8).

Per PLAN.md: "Market/Risk agents can use real web/news context via LLM +
retrieval for qualitative factors (tourism trends, geopolitical notes)."

No live web/news retrieval is wired up in this environment, so the agent
instead grounds its qualitative commentary in the real macro/tourism data and
calibrated-synthetic competitor data already used by the demand model
(agents/context.py). This is documented honestly in docs/agent_architecture.md
- the LLM provides qualitative interpretation, not new figures.
"""

import json

from llm_client import UNAVAILABLE_NOTICE, complete

SYSTEM_PROMPT = """You are the Market Analyst agent for Pacific Wings, a fictional \
Sydney-based airline. You are given real macroeconomic/tourism data and \
calibrated-synthetic competitor data for one route. Write a short (3-5 \
sentence) qualitative market commentary: demand drivers, competitive \
positioning, and tourism/economic trends. Do not invent statistics beyond \
what is given - only interpret the provided data qualitatively."""


def analyze(market_ctx: dict) -> dict:
    """Returns {"available": bool, "commentary": str, "context": market_ctx}."""
    user_message = (
        "Route market data (JSON):\n"
        f"{json.dumps(market_ctx, indent=2)}\n\n"
        "Write the market commentary."
    )

    commentary = complete(SYSTEM_PROMPT, user_message)

    return {
        "available": commentary is not None,
        "commentary": commentary or UNAVAILABLE_NOTICE,
        "context": market_ctx,
    }
