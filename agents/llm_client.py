"""
Shared Gemini client helper for the Phase 8/9 LLM-based agents (Market, Risk,
Strategy) and the Phase 9 copilot.

All numeric figures used by these agents come from `simulation/engine.py`
(Phases 3-6) - this module is only responsible for turning those numbers,
plus market context, into narrative text via Gemini.

Uses the Gemini API free tier (https://aistudio.google.com/apikey) via the
official `google-genai` SDK. The client resolves `GEMINI_API_KEY` (or
`GOOGLE_API_KEY`) from the environment automatically. If no key is set (or
the API call fails), `complete()` returns `None` so callers can degrade
gracefully instead of crashing the API.
"""

import os

from dotenv import load_dotenv
from google import genai
from google.genai import errors, types

load_dotenv()

DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

_client: genai.Client | None = None
_client_initialized = False


def get_client() -> genai.Client | None:
    """Returns a cached Gemini client, or None if no API key is configured."""
    global _client, _client_initialized
    if not _client_initialized:
        _client_initialized = True
        if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
            _client = genai.Client()
    return _client


def complete(system: str, user_message: str, max_tokens: int = 1024) -> str | None:
    """
    Sends a single-turn request to Gemini. Returns the text response, or None
    if the client is unavailable (no API key) or the request fails.
    """
    client = get_client()
    if client is None:
        return None

    try:
        response = client.models.generate_content(
            model=DEFAULT_MODEL,
            contents=user_message,
            config=types.GenerateContentConfig(
                system_instruction=system,
                max_output_tokens=max_tokens,
            ),
        )
    except (errors.ClientError, errors.ServerError, errors.APIError):
        return None

    return (response.text or "").strip() or None


UNAVAILABLE_NOTICE = (
    "LLM narration unavailable: set the GEMINI_API_KEY environment variable "
    "(free tier at https://aistudio.google.com/apikey) to enable AI-generated "
    "commentary. All figures above come directly from the simulation engine "
    "(Phases 3-6) regardless of LLM availability."
)
