"""
Request and response shapes.

`DemandForecastResponse` is deliberately explicit about which passenger count
is which: the model forecasts the whole route market, and Pacific Wings' own
figure is derived from it. A single unqualified `passengers` field is how the
two came to be confused in the first place.
"""

from pydantic import BaseModel, Field

from pacific_wings.api.config import (
    FREQUENCY_DELTA_MAX,
    FREQUENCY_DELTA_MIN,
    FUEL_PRICE_MAX,
    FUEL_PRICE_MIN,
    PRICE_DELTA_MAX,
    PRICE_DELTA_MIN,
    RATING_DELTA_MAX,
    RATING_DELTA_MIN,
    YEAR_MAX,
    YEAR_MIN,
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class CopilotRequest(BaseModel):
    """
    A /copilot run. POST rather than GET because `evidence` carries the chat
    answer the report is meant to go deeper than, which is too big for a URL.
    """

    destination: str
    year: int = Field(ge=YEAR_MIN, le=YEAR_MAX)
    month: int = Field(ge=1, le=12)
    price_delta_pct: float = Field(0.0, ge=PRICE_DELTA_MIN, le=PRICE_DELTA_MAX)
    frequency_delta: int = Field(0, ge=FREQUENCY_DELTA_MIN, le=FREQUENCY_DELTA_MAX)
    fuel_price_usd_per_gallon: float | None = Field(None, ge=FUEL_PRICE_MIN, le=FUEL_PRICE_MAX)
    aircraft_type: str | None = None
    rating_delta: float = Field(0.0, ge=RATING_DELTA_MIN, le=RATING_DELTA_MAX)
    preset: str | None = None
    question: str | None = Field(None, max_length=500)
    # The chat answer already on screen. Capped: it is prompt input, and an
    # uncapped body field is an easy way to burn someone's LLM quota.
    evidence: str | None = Field(None, max_length=8000)


class ConfidenceBreakdown(BaseModel):
    resampling_spread_deduction: float
    historical_reliability_deduction: float
    extrapolation_deduction: float


class DemandForecastResponse(BaseModel):
    origin: str
    destination: str
    year: int
    month: int
    avg_fare_usd: float
    # The total route market, all carriers - what the model actually forecasts.
    market_passengers: int
    market_passengers_low: int
    market_passengers_high: int
    pacific_wings_share: float
    # Pacific Wings' slice of it, and what can be flown of that slice.
    predicted_passengers: int
    predicted_passengers_low: int
    predicted_passengers_high: int
    capacity_monthly: int
    sellable_seats: int
    passengers_carried: int
    spilled_passengers: int
    predicted_load_factor: float
    predicted_load_factor_low: float
    predicted_load_factor_high: float
    confidence_pct: float
    confidence_breakdown: ConfidenceBreakdown
    confidence_notes: list[str]


class SaveReportRequest(BaseModel):
    kind: str
    destination: str
    destination_city: str
    title: str
    description: str
    agents: list[str]
    payload: dict
    id: str | None = None
