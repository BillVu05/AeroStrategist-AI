"""
API contract tests: every endpoint answers, and every scenario parameter
rejects nonsense.

The validation half exists because the API used to accept, and answer
confidently with 200 OK: a -200% price delta (a fare of -$453.75, which gave
Pacific Wings 88% market share), a negative fuel price (fuel as a revenue
line), rating_delta=+99 (100% share), frequency_delta=-999, and year=1900 at
84.6% confidence. weekly_frequency=0 was an unhandled division by zero.

Run:
    pytest tests/
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pacific_wings.api.main import app

ROOT = Path(__file__).resolve().parents[1]



@pytest.fixture(scope="module")
def client():
    return TestClient(app)


# ── every endpoint answers ────────────────────────────────────────────────────

SMOKE = [
    ("/health", {}),
    ("/routes", {}),
    ("/demand_forecast", {"destination": "SIN", "year": 2026, "month": 7}),
    ("/route_economics", {"destination": "SIN", "year": 2026, "month": 7}),
    ("/what_if", {"destination": "SIN", "year": 2026, "month": 7}),
    ("/what_if", {"destination": "SIN", "year": 2026, "month": 7, "preset": "fuel_price_shock"}),
    ("/what_if_presets", {}),
    ("/monte_carlo", {"destination": "SIN", "year": 2026, "month": 7, "n_simulations": 100}),
    ("/market_context", {"destination": "SIN"}),
    ("/macro_projection", {"destination": "SIN", "from_year": 2026, "to_year": 2028}),
    ("/future_analysis", {"destination": "SIN", "from_year": 2026, "to_year": 2028}),
    ("/network_future_analysis", {"from_year": 2026, "to_year": 2027}),
    ("/analyze_route", {"destination": "NRT"}),
    ("/compare_routes", {"destinations": "NRT,ICN"}),
    ("/search_airports", {"query": "tokyo"}),
    ("/reports", {}),
]


@pytest.mark.parametrize("path,params", SMOKE, ids=[f"{p}{'?' + list(q)[0] if q else ''}" for p, q in SMOKE])
def test_endpoint_answers(client, path, params):
    response = client.get(path, params=params)
    assert response.status_code == 200, response.text
    assert response.json() is not None


def test_unknown_destination_is_404(client):
    assert client.get("/what_if", params={"destination": "ZZZ", "year": 2026, "month": 7}).status_code == 404


def test_unknown_airport_is_reported_not_crashed(client):
    body = client.get("/analyze_route", params={"destination": "zzzqqq"}).json()
    assert "error" in body and "suggestions" in body


# ── nonsense is rejected ──────────────────────────────────────────────────────

REJECTED = [
    ("negative fare", "/what_if", {"destination": "SIN", "year": 2026, "month": 7, "price_delta_pct": -2.0}),
    ("free fuel", "/what_if", {"destination": "SIN", "year": 2026, "month": 7, "fuel_price_usd_per_gallon": 0}),
    ("negative fuel", "/what_if", {"destination": "SIN", "year": 2026, "month": 7, "fuel_price_usd_per_gallon": -5}),
    ("impossible rating", "/what_if", {"destination": "SIN", "year": 2026, "month": 7, "rating_delta": 99}),
    ("absurd frequency cut", "/what_if", {"destination": "SIN", "year": 2026, "month": 7, "frequency_delta": -999}),
    ("year 1900", "/what_if", {"destination": "SIN", "year": 1900, "month": 7}),
    ("year 2100", "/what_if", {"destination": "SIN", "year": 2100, "month": 7}),
    ("month 13", "/what_if", {"destination": "SIN", "year": 2026, "month": 13}),
    ("month 0", "/what_if", {"destination": "SIN", "year": 2026, "month": 0}),
    ("zero frequency", "/analyze_route", {"destination": "NRT", "weekly_frequency": 0}),
    ("negative frequency", "/analyze_route", {"destination": "NRT", "weekly_frequency": -5}),
    ("negative fare", "/analyze_route", {"destination": "NRT", "avg_fare_usd": -100}),
    ("negative carriers", "/analyze_route", {"destination": "NRT", "n_existing_carriers": -3}),
    ("too many sims", "/monte_carlo", {"destination": "SIN", "year": 2026, "month": 7, "n_simulations": 10**6}),
]


@pytest.mark.parametrize("label,path,params", REJECTED, ids=[c[0] for c in REJECTED])
def test_invalid_input_is_rejected(client, label, path, params):
    assert client.get(path, params=params).status_code == 422


# ── the forecast contract ─────────────────────────────────────────────────────

def test_demand_forecast_separates_market_from_own_passengers(client):
    """The model forecasts the whole route market; Pacific Wings' slice is
    derived. Both must be visible, or a reader cannot tell which is which."""
    body = client.get("/demand_forecast", params={"destination": "SIN", "year": 2026, "month": 7}).json()

    assert body["market_passengers"] > body["predicted_passengers"]
    assert 0 < body["pacific_wings_share"] < 1
    assert body["market_passengers_low"] <= body["market_passengers"] <= body["market_passengers_high"]
    assert body["passengers_carried"] <= body["sellable_seats"] <= body["capacity_monthly"]
    assert body["predicted_load_factor"] <= 0.88 + 1e-9


def test_monte_carlo_reports_real_downside(client):
    """probability_of_loss was 0.0 with fuel sampled from $0.40 to $6.00 a
    gallon, because passengers were pinned at the capacity wall and revenue
    could not move."""
    body = client.get(
        "/monte_carlo", params={"destination": "SIN", "year": 2026, "month": 7, "n_simulations": 300}
    ).json()

    assert body["profit_usd"]["p10"] < body["profit_usd"]["p90"]
    assert body["load_factor"]["max"] <= 0.88 + 1e-9
    assert body["profit_usd"]["min"] < body["profit_usd"]["p50"]


def test_scenario_and_baseline_are_both_returned(client):
    body = client.get(
        "/what_if",
        params={"destination": "SIN", "year": 2026, "month": 7, "frequency_delta": 7},
    ).json()
    assert body["baseline"]["demand"]["passengers_carried"] < body["scenario"]["demand"]["passengers_carried"]
    assert body["delta"]["passengers_carried"] > 0


# ── access control ────────────────────────────────────────────────────────────

def test_health_states_the_security_posture(client):
    """Whether auth is on should be visible, not discovered."""
    body = client.get("/health").json()
    assert "auth_required" in body
    assert "llm_rate_limit_per_minute" in body


def test_protected_endpoints_require_a_token_when_one_is_set(monkeypatch):
    """DELETE /reports/{id} was reachable by anyone who could reach the port."""
    from pacific_wings.api import config

    # Auth is read from config at call time, so patching it there is what the
    # dependency actually sees.
    monkeypatch.setattr(config, "API_TOKEN", "test-secret")
    guarded = TestClient(config.app)

    assert guarded.delete("/reports/does-not-exist").status_code == 401
    assert guarded.post("/reports", json={}).status_code == 401

    good = guarded.delete(
        "/reports/does-not-exist", headers={"Authorization": "Bearer test-secret"}
    )
    assert good.status_code == 404  # authenticated, and the report genuinely is not there
    assert guarded.delete(
        "/reports/x", headers={"Authorization": "Bearer wrong"}
    ).status_code == 401


def test_open_by_default(client):
    """Unset API_TOKEN keeps the local demo usable without a token."""
    assert client.get("/reports").status_code == 200
