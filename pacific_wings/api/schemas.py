"""
Request and response shapes.

`DemandForecastResponse` is deliberately explicit about which passenger count
is which: the model forecasts the whole route market, and Pacific Wings' own
figure is derived from it. A single unqualified `passengers` field is how the
two came to be confused in the first place.
"""

from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


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
