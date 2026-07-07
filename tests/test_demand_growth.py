"""Fails if future-year demand forecasts go flat again (the XGBoost
extrapolation bug: tree models saturate outside their training range, so
market growth must be applied via engine.market_growth_multiplier).

Run: python tests/test_demand_growth.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "simulation"))

from engine import SimulationEngine  # noqa: E402
from future_analysis import multi_year_route_projection  # noqa: E402


def main() -> None:
    engine = SimulationEngine()
    anchor = engine._growth_anchor_year

    # Multiplier: 1.0 inside training window, strictly growing after it.
    assert engine.market_growth_multiplier("HND", anchor) == 1.0
    m = [engine.market_growth_multiplier("HND", anchor + n) for n in range(1, 5)]
    assert all(b > a for a, b in zip([1.0] + m, m)), f"multiplier not increasing: {m}"

    # Demand: HND has load-factor headroom, so carried pax must grow.
    proj = multi_year_route_projection("HND", anchor, anchor + 4)
    first = proj["yearly"][str(anchor)]["annual_passengers"]
    last = proj["yearly"][str(anchor + 4)]["annual_passengers"]
    assert last > first * 1.02, f"HND pax flat: {first} -> {last}"
    assert proj["passenger_cagr_pct"] > 0.5, f"CAGR still flat: {proj['passenger_cagr_pct']}"

    # Vietnam grows faster than Japan (GDP 6% vs 0.9%) but nothing absurd.
    dad_m = engine.market_growth_multiplier("DAD", anchor + 4)
    hnd_m = engine.market_growth_multiplier("HND", anchor + 4)
    assert dad_m > hnd_m, f"DAD {dad_m} should outgrow HND {hnd_m}"
    assert dad_m < 2.0, f"DAD 4-year multiplier implausible: {dad_m}"

    # The /demand_forecast API path must apply the same growth (it predicts
    # with the raw model, separately from engine.run_scenario).
    from api.main import _forecast_demand  # noqa: E402  (slow import)

    now = _forecast_demand("HND", anchor, 6, None)["predicted_passengers"]
    future = _forecast_demand("HND", anchor + 3, 6, None)["predicted_passengers"]
    assert future > now * 1.01, f"API demand forecast flat: {now} -> {future}"

    print(f"OK  HND pax {first} -> {last} (CAGR {proj['passenger_cagr_pct']}%)")
    print(f"OK  4yr market multipliers: HND {hnd_m:.3f}, DAD {dad_m:.3f}")
    print(f"OK  API forecast grows: {now:.0f} -> {future:.0f} (+3yr)")


if __name__ == "__main__":
    main()
