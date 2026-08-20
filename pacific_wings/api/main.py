"""
The FastAPI surface for the Pacific Wings simulator.

This module does one thing: assemble the app from its routers. Every demand
figure served comes from one place, `simulation.engine.SimulationEngine` - the
API used to load the model and re-implement the growth multiplier, the
confidence call and the prediction band itself, in parallel with the engine
doing the same thing slightly differently, so /demand_forecast and /what_if
could disagree about the same route.

Run:
    uvicorn pacific_wings.pacific_wings.api.main:app --reload
"""

from pacific_wings.agents.llm_client import get_client
from pacific_wings.api.config import API_TOKEN, LLM_RATE_LIMIT_PER_MINUTE, app
from pacific_wings.api.routes import forecasting, network, reports, scenarios, screening

app.include_router(forecasting.router, tags=["forecasting"])
app.include_router(scenarios.router, tags=["scenarios"])
app.include_router(network.router, tags=["network"])
app.include_router(screening.router, tags=["screening"])
app.include_router(reports.router, tags=["reports"])


@app.get("/health", tags=["meta"])
def health():
    return {
        "status": "ok",
        "llm_available": get_client() is not None,
        # Stated rather than left to be discovered.
        "auth_required": API_TOKEN is not None,
        "llm_rate_limit_per_minute": LLM_RATE_LIMIT_PER_MINUTE,
    }
