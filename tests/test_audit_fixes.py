"""
Regressions for the audit pass: each test names a defect that was real.
"""

import pytest
from fastapi.testclient import TestClient

from pacific_wings.analysis.open_route import MAX_COMPARISON_DESTINATIONS, compare_route_alternatives
from pacific_wings.api.main import app

client = TestClient(app)

ROUTES = ["SIN", "MEL", "HND", "AKL", "DAD"]


@pytest.mark.parametrize("destination", ROUTES)
def test_forecast_band_contains_its_own_point_estimate(destination):
    """The band used to be clipped at sellable seats while the point estimate
    was not, so SIN 2026-07 returned low=5353, point=6560, high=5353 - a
    zero-width interval excluding its own forecast, on every capacity-bound
    route."""
    r = client.get(
        "/demand_forecast", params={"destination": destination, "year": 2026, "month": 7}
    ).json()
    assert r["predicted_passengers_low"] <= r["predicted_passengers"] <= r["predicted_passengers_high"]
    assert r["predicted_passengers_low"] < r["predicted_passengers_high"], "zero-width band"


@pytest.mark.parametrize("destination", ROUTES)
def test_load_factor_band_is_consistent_with_the_point_estimate(destination):
    """The load-factor bounds carry each end of the demand band through the
    same spill curve the point estimate uses."""
    r = client.get(
        "/demand_forecast", params={"destination": destination, "year": 2026, "month": 7}
    ).json()
    assert (
        r["predicted_load_factor_low"]
        <= r["predicted_load_factor"]
        <= r["predicted_load_factor_high"]
    )


def test_comparing_too_many_destinations_is_refused_not_truncated():
    """`destinations[:8]` used to silently drop the rest: ask for ten
    candidates, get eight ranked as though that were the shortlist."""
    too_many = ["LHR", "DXB", "JFK", "SIN", "HND", "MEL", "AKL", "DAD", "BKK", "KUL"]
    assert len(too_many) > MAX_COMPARISON_DESTINATIONS
    with pytest.raises(ValueError):
        compare_route_alternatives(too_many)
    assert client.get("/compare_routes", params={"destinations": ",".join(too_many)}).status_code == 400
    assert client.get("/compare_routes", params={"destinations": "LHR"}).status_code == 400


def test_monte_carlo_demand_shock_moves_demand():
    """The stress test's pandemic/recession scenarios had no demand lever and
    had to be faked as fare cuts."""
    params = {"destination": "SIN", "year": 2026, "month": 7, "n_simulations": 100}
    base = client.get("/monte_carlo", params=params).json()
    shocked = client.get(
        "/monte_carlo", params={**params, "tourism_arrivals_multiplier": 0.5}
    ).json()
    assert shocked["passengers_carried"]["p50"] < base["passengers_carried"]["p50"]
    assert shocked["profit_usd"]["p50"] < base["profit_usd"]["p50"]
