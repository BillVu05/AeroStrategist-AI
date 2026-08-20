"""
Application setup: the app object, cross-origin policy, access control and the
bounds every scenario parameter is validated against.

Kept apart from the endpoints so that reading "what is this API allowed to do"
does not mean scrolling past nine hundred lines of route handlers.
"""

import os
import secrets
import time
from collections import defaultdict

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Pacific Wings Strategy Simulator API",
    description=(
        "Route economics, scenario simulation and network planning for Pacific "
        "Wings, grounded in real BITRE traffic data and World Bank macro data."
    ),
    version="1.0.0",
)

# CORS origins come from the environment. Pinning localhost:3000 in source
# while docker-compose.yml ships this as a container meant the first non-local
# deploy either broke the frontend or got "fixed" by widening it to "*".
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Two kinds of endpoint need protecting, and neither was:
#   - DELETE /reports/{id} was open to anyone who could reach the port
#   - /chat, /copilot and /analyze_route_agents spend LLM quota per call
#
# Set API_TOKEN to require `Authorization: Bearer <token>` on those routes.
# Unset (the default) leaves the app open, which is right for a local demo and
# is stated in /health rather than left for someone to discover.
API_TOKEN = os.environ.get("API_TOKEN") or None

# Requests per minute per client IP for the LLM-backed endpoints. A single
# /copilot call is three LLM round trips; unmetered, one caller can drain the
# key. In-process and per-worker - fine for one uvicorn process, and the point
# at which that stops being true is the point at which this belongs in a proxy.
LLM_RATE_LIMIT_PER_MINUTE = int(os.environ.get("LLM_RATE_LIMIT_PER_MINUTE", "20"))
_llm_calls: dict[str, list[float]] = defaultdict(list)


def require_token(authorization: str | None = Header(default=None)) -> None:
    """Bearer-token check. A no-op when API_TOKEN is unset."""
    if API_TOKEN is None:
        return
    expected = f"Bearer {API_TOKEN}"
    # Constant-time compare so the token cannot be recovered a byte at a time.
    if authorization is None or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Missing or invalid bearer token.")


def rate_limit_llm(request: Request) -> None:
    """Per-IP sliding window over the LLM-backed endpoints."""
    client = request.client.host if request.client else "unknown"
    now = time.monotonic()
    recent = [t for t in _llm_calls[client] if now - t < 60]
    if len(recent) >= LLM_RATE_LIMIT_PER_MINUTE:
        recent_enough = 60 - (now - recent[0])
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit is {LLM_RATE_LIMIT_PER_MINUTE} LLM-backed requests per minute. "
                   f"Try again in {recent_enough:.0f}s.",
        )
    recent.append(now)
    _llm_calls[client] = recent


PROTECTED = [Depends(require_token)]
LLM_GUARDS = [Depends(require_token), Depends(rate_limit_llm)]


# Every scenario parameter is bounded. Without these the API accepted, and
# answered confidently: a -200% price delta (a fare of -$453.75, which handed
# Pacific Wings 88% market share by paying people to fly), a negative fuel
# price (which turned fuel into a revenue line), rating_delta=+99 (100% share),
# frequency_delta=-999, and year=1900 at 84.6% confidence. weekly_frequency=0
# produced an unhandled division by zero and a 500.
#
# FastAPI turns these into a 422 with a usable message for free, which is the
# whole reason they belong on the parameter rather than in a hand-rolled check.
YEAR_MIN, YEAR_MAX = 2015, 2050
PRICE_DELTA_MIN, PRICE_DELTA_MAX = -0.9, 5.0     # a fare cannot go negative
FREQUENCY_DELTA_MIN, FREQUENCY_DELTA_MAX = -100, 100
FUEL_PRICE_MIN, FUEL_PRICE_MAX = 0.1, 20.0       # USD/gallon, generous but finite
RATING_DELTA_MIN, RATING_DELTA_MAX = -4.0, 0.9   # Skytrax runs 1-5
WEEKLY_FREQUENCY_MIN, WEEKLY_FREQUENCY_MAX = 1, 140
FARE_MIN, FARE_MAX = 10.0, 20_000.0
CARRIERS_MIN, CARRIERS_MAX = 0, 20
