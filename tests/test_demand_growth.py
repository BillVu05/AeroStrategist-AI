"""
Market-growth regression tests.

The original defect: gradient-boosted trees saturate outside their training
range, so raw predictions for future years came back flat. Growth is applied
instead as an explicit macro multiplier (IMF WEO long-run GDP x IATA income
elasticity, blended with pre-COVID tourism CAGR - see
pacific_wings/simulation/macro_projections.py).

This file used to be the repo's entire test suite: a 55-line script asserting
growth on HND alone. HND was the one route with load-factor headroom, so it
passed while SIN, MEL and AKL all projected a dead-flat decade. The
route-by-route version of that check now lives in test_simulator.py's
test_projections_are_not_silently_flat; what remains here is the multiplier
itself and the API path that applies it.

Run:
    pytest tests/
"""


import pytest

from pacific_wings.simulation.engine import SimulationEngine


@pytest.fixture(scope="module")
def engine():
    return SimulationEngine()


def test_multiplier_is_flat_inside_the_observed_window(engine):
    assert engine.market_growth_multiplier("HND", engine._growth_anchor_year) == 1.0
    assert engine.market_growth_multiplier("HND", engine._growth_anchor_year - 1) == 1.0


def test_multiplier_grows_strictly_after_the_observed_window(engine):
    anchor = engine._growth_anchor_year
    series = [1.0] + [engine.market_growth_multiplier("HND", anchor + n) for n in range(1, 6)]
    assert all(b > a for a, b in zip(series, series[1:])), series


def test_faster_growing_economies_grow_faster(engine):
    """Vietnam's GDP grows ~6%/yr against Japan's ~0.9%, and the multiplier
    has to reflect that without producing something absurd."""
    anchor = engine._growth_anchor_year
    vietnam = engine.market_growth_multiplier("DAD", anchor + 4)
    japan = engine.market_growth_multiplier("HND", anchor + 4)
    assert vietnam > japan, (vietnam, japan)
    assert 1.0 < vietnam < 2.0, vietnam


@pytest.mark.parametrize("destination", ["SIN", "HND", "MEL", "AKL", "DAD"])
def test_the_addressable_market_grows_on_every_route(engine, destination):
    """The market must grow even where capacity stops Pacific Wings carrying
    it - that gap is the whole argument for buying an aircraft."""
    anchor = engine._growth_anchor_year
    now = engine.run_scenario(destination, anchor + 1, 7)["demand"]["market_passengers"]
    later = engine.run_scenario(destination, anchor + 5, 7)["demand"]["market_passengers"]
    assert later > now * 1.02, (destination, now, later)


def test_the_api_forecast_path_applies_the_same_growth():
    """/demand_forecast predicts through the engine now, but it did not
    always - it re-implemented the growth multiplier separately, which is
    exactly how two endpoints drift apart. The shared helper now lives in
    api.deps, where every router reads it from."""
    from pacific_wings.api.deps import forecast_demand

    engine = SimulationEngine()
    anchor = engine._growth_anchor_year
    now = forecast_demand("HND", anchor + 1, 6, None)["market_passengers"]
    later = forecast_demand("HND", anchor + 4, 6, None)["market_passengers"]
    assert later > now * 1.01, (now, later)
