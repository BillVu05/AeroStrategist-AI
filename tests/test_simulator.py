"""
Regression tests for the behaviours a strategy simulator has to get right.

Every test here corresponds to a defect that shipped. The repo previously had
one 55-line test covering one route, and it passed while adding capacity
never paid, raising fares was infinitely profitable, and two endpoints gave
opposite verdicts on the same route.

Run:
    pytest tests/
"""


import pytest

from pacific_wings import paths
from pacific_wings.simulation.engine import MAX_SELLABLE_LOAD_FACTOR, SimulationEngine

ACTIVE_ROUTES = ["SIN", "HND", "MEL", "AKL"]
ALL_ROUTES = ACTIVE_ROUTES + ["DAD"]
YEAR, MONTH = 2026, 7


@pytest.fixture(scope="module")
def engine():
    return SimulationEngine()


# ── the levers must actually work ─────────────────────────────────────────────

def test_profit_vs_fare_has_an_interior_maximum(engine):
    """Profit must not rise monotonically with price.

    It used to: demand was fare-inelastic (implied elasticity -0.004), so the
    optimal strategy this tool recommended was a $4,991 economy seat on
    SYD-SIN, at which it reported $31.6M a month.
    """
    deltas = [-0.5, -0.3, -0.1, 0.0, 0.1, 0.3, 0.6, 1.0, 2.0]
    profits = [
        engine.run_scenario("SIN", YEAR, MONTH, price_delta_pct=d)["profit_usd"] for d in deltas
    ]
    best = profits.index(max(profits))
    assert 0 < best < len(profits) - 1, dict(zip(deltas, profits))


def test_demand_falls_as_fare_rises(engine):
    """Own-price elasticity must land in the range the literature reports."""
    base = engine.run_scenario("SIN", YEAR, MONTH)
    up = engine.run_scenario("SIN", YEAR, MONTH, price_delta_pct=0.01)
    q0 = base["demand"]["predicted_demand_passengers"]
    q1 = up["demand"]["predicted_demand_passengers"]
    elasticity = ((q1 - q0) / q0) / 0.01
    assert -2.5 < elasticity < -0.5, elasticity


def test_added_frequency_carries_more_passengers(engine):
    """Adding capacity to a spilling route must carry more people.

    Adding fourteen weekly flights to SYD-SIN used to move market share from
    9.4% to 13.5% and carried passengers by exactly zero, because share was
    computed and then discarded.
    """
    base = engine.run_scenario("SIN", YEAR, MONTH)
    more = engine.run_scenario("SIN", YEAR, MONTH, frequency_delta=7)
    assert more["demand"]["passengers_carried"] > base["demand"]["passengers_carried"]
    assert more["market_share"]["pacific_wings_share"] > base["market_share"]["pacific_wings_share"]


def test_profit_vs_frequency_has_an_interior_maximum(engine):
    """Growth must be able to pay, and overcapacity must be able to hurt."""
    deltas = [-4, -2, 0, 3, 7, 14, 30, 60]
    profits = [
        engine.run_scenario("SIN", YEAR, MONTH, frequency_delta=d)["profit_usd"] for d in deltas
    ]
    best = profits.index(max(profits))
    assert 0 < best < len(profits) - 1, dict(zip(deltas, profits))


def test_market_share_moves_passengers(engine):
    """Share is an allocator, not a display value: a competitor entering must
    reduce Pacific Wings' passengers on an unconstrained route."""
    base = engine.run_scenario("HND", YEAR, MONTH)
    contested = engine.run_scenario(
        "HND",
        YEAR,
        MONTH,
        extra_competitors=[
            {"name": "Test Entrant", "price": 300.0, "weekly_frequency": 21, "rating": 4.5}
        ],
    )
    assert contested["market_share"]["pacific_wings_share"] < base["market_share"]["pacific_wings_share"]
    assert contested["demand"]["passengers_carried"] < base["demand"]["passengers_carried"]


# ── physical plausibility ─────────────────────────────────────────────────────

@pytest.mark.parametrize("destination", ALL_ROUTES)
def test_load_factor_is_physically_plausible(engine, destination):
    """No route may report selling every seat. SIN used to sit at 0.984 and
    Monte Carlo piled p90 and max onto exactly 1.000."""
    lf = engine.run_scenario(destination, YEAR, MONTH)["demand"]["load_factor"]
    assert 0.0 <= lf <= MAX_SELLABLE_LOAD_FACTOR + 1e-9, lf


@pytest.mark.parametrize("destination", ALL_ROUTES)
def test_spill_is_conserved(engine, destination):
    """carried + spilled must equal the demand the model actually produced."""
    d = engine.run_scenario(destination, YEAR, MONTH)["demand"]
    assert d["passengers_carried"] + d["spilled_passengers"] == pytest.approx(
        d["predicted_demand_passengers"], rel=0.01, abs=2
    )


def test_a_grounded_carrier_has_no_share(engine):
    """log1p(0) left a carrier with zero flights holding 4.3% of the market."""
    grounded = engine.run_scenario("SIN", YEAR, MONTH, frequency_delta=-7)
    assert grounded["market_share"]["pacific_wings_share"] == 0.0
    assert grounded["demand"]["passengers_carried"] == 0


# ── forecasts must degrade honestly ───────────────────────────────────────────

def test_confidence_falls_with_distance_from_the_data(engine):
    """Confidence for 2100 used to be 84.6% - and so did 1900, because the
    extrapolation term saturated after five years and capped at 25 points."""
    anchor = engine._growth_anchor_year
    near = engine.run_scenario("SIN", anchor + 1, MONTH)["demand"]["confidence_pct"]
    mid = engine.run_scenario("SIN", anchor + 4, MONTH)["demand"]["confidence_pct"]
    far = engine.run_scenario("SIN", anchor + 20, MONTH)["demand"]["confidence_pct"]
    assert near > mid > far, (near, mid, far)
    assert far < 15.0, far


@pytest.mark.parametrize("destination", ALL_ROUTES)
def test_projections_are_not_silently_flat(destination):
    """A decade of projection must either grow or say why it cannot.

    /future_analysis returned 72,996 passengers for nine consecutive years on
    SIN with nothing in the response to explain it. The single test guarding
    this checked only HND - the one route with load-factor headroom - so it
    passed while three of four routes were flat.
    """
    from pacific_wings.simulation.future_analysis import multi_year_route_projection

    proj = multi_year_route_projection(destination, YEAR, YEAR + 6)
    grew = proj["passenger_cagr_pct"] > 0.5
    explained = proj["growth_blocked_by_capacity"]
    assert grew or explained, {
        "carried_cagr": proj["passenger_cagr_pct"],
        "market_cagr": proj["market_cagr_pct"],
        "constrained_years": proj["capacity_constrained_years"],
    }
    if explained:
        # If capacity is the reason, the growing market must be visible.
        assert proj["market_cagr_pct"] > proj["passenger_cagr_pct"]


def test_the_model_is_benchmarked_against_naive_baselines():
    """The deployed model must be scored against naive forecasters every run.

    The previous pipeline reported R2=0.965 while losing to a groupby mean,
    and nothing in metrics.json would have revealed it.
    """
    import json

    metrics = json.loads(paths.METRICS.read_text())
    assert metrics["baselines"], "no baselines recorded"
    verdict = metrics["verdict_vs_baselines"]
    assert verdict["status"] in {"beats_baseline", "ties_baseline"}, verdict


# ── the two engines must not contradict each other ────────────────────────────

@pytest.mark.parametrize(
    "destination,weekly_frequency", [("SIN", 7), ("HND", 5), ("MEL", 14), ("DAD", 3)]
)
def test_screener_and_simulator_agree(destination, weekly_frequency):
    """The open-route screener and the network simulator must reach the same
    conclusion about the same route.

    They used to disagree by $14.8M a year on SYD-DAD, with opposite verdicts:
    +$4.9M/yr PROCEED from one and -$9.9M/yr from the other. Both were shown
    in the same UI.
    """
    from pacific_wings.analysis.open_route import analyze_open_route
    from pacific_wings.simulation.future_analysis import multi_year_route_projection

    screened = analyze_open_route(destination, weekly_frequency=weekly_frequency)
    simulated = multi_year_route_projection(destination, YEAR, YEAR)["yearly"][str(YEAR)]

    screened_pax = screened["demand_estimate"]["annual_passengers_pacific_wings"]
    simulated_pax = simulated["annual_passengers"]
    assert screened_pax == pytest.approx(simulated_pax, rel=0.30), (screened_pax, simulated_pax)

    # The non-negotiable one: they must never disagree about whether the route
    # makes money.
    screened_profit = screened["financials"]["annual_profit_usd"]
    simulated_profit = simulated["annual_profit_usd"]
    assert (screened_profit > 0) == (simulated_profit > 0), (screened_profit, simulated_profit)


def test_infeasible_routes_report_no_financials():
    """SYD-LHR came back NOT FEASIBLE with a composite score of 67/100 and
    eight pros, including 'Estimated profitable at launch: $6.8M annual
    profit' for a flight no aircraft in the fleet can operate."""
    from pacific_wings.analysis.open_route import analyze_open_route

    result = analyze_open_route("LHR")
    assert result["verdict"] == "NOT FEASIBLE"
    assert "financials" not in result
    assert "scoring" not in result
    assert result["pros"] == []
    assert result["operations"]["range_shortfall_km"] > 0


def test_candidate_routes_are_not_handed_a_monopoly(engine):
    """SYD-DAD reported 100% market share because no carrier flies it nonstop,
    so the choice set was empty. The traffic exists and connects via hubs."""
    share = engine.run_scenario("DAD", YEAR, MONTH)["market_share"]
    assert share["pacific_wings_share"] < 0.6, share
    assert len(share["shares_by_carrier"]) > 1, share


# ── the aeroplanes have to exist ──────────────────────────────────────────────

def test_the_current_network_fits_the_current_fleet(engine):
    """If the baseline schedule were infeasible, every scenario would be
    compared against something the airline cannot fly."""
    check = engine.run_scenario("SIN", YEAR, MONTH)["fleet"]
    assert check["feasible"], check["shortfalls"]


def test_unflyable_growth_is_flagged(engine):
    """frequency_delta=+50 on SYD-SIN is roughly eleven A321neos of flying.
    It used to be priced as though the aircraft were free and already parked
    at the gate - there was no fleet in the model at all, only aircraft types."""
    check = engine.run_scenario("SIN", YEAR, MONTH, frequency_delta=50)["fleet"]
    assert not check["feasible"]
    assert check["shortfalls"]
    a321 = check["by_aircraft_type"]["A321neo"]
    assert a321["tails_required"] > a321["tails_available"]


def test_fleet_verdict_appears_in_comparisons(engine):
    delta = engine.compare("SIN", YEAR, MONTH, frequency_delta=50)["delta"]
    assert delta["fleet_feasible"] is False


def test_the_metrics_doc_matches_the_model_artifact():
    """docs/model_metrics.md is generated by the training run.

    The hand-written version drifted: the docs advertised R2=0.952 / MAPE
    15.3% with CV 0.966 +/- 0.014 while metrics.json held 0.965 / 11.0% with
    CV 0.992 +/- 0.003, and the README pointed readers at the stale one as
    "the full math". This fails if someone edits the doc by hand or forgets
    to regenerate it.
    """
    import json

    doc = (paths.DOCS_DIR / "model_metrics.md").read_text(encoding="utf-8")
    metrics = json.loads(paths.METRICS.read_text())

    assert "GENERATED by pacific_wings/ml/train.py" in doc
    assert metrics["selected_model"] in doc
    assert f"{metrics['mape']:.2%}" in doc
    assert metrics["verdict_vs_baselines"]["status"] in doc
    for name in metrics["baselines"]:
        assert name in doc


# ── gaps found on the second audit pass ───────────────────────────────────────

def test_no_inert_scenario_parameters(engine):
    """Every parameter run_scenario accepts must be able to change an answer.

    `gdp_usd_override` and `population_override` survived the model rebuild as
    accepted-but-ignored arguments: they fed a feature frame that only the
    losing XGBoost candidate read, so callers could pass them and see nothing
    happen. They are gone; this fails if a dead lever comes back.
    """
    import inspect

    levers = {
        "price_delta_pct": 0.2,
        "frequency_delta": 5,
        "rating_delta": -1.0,
        "tourism_arrivals_multiplier": 1.5,
        "gdp_growth_pct_override": -8.0,
        "demand_noise_multiplier": 1.4,
        "fuel_price_usd_per_gallon": 5.0,
        # HND already flies the B787-9, so swapping to it is a no-op; the
        # lever has to be tested with an aircraft that is actually different.
        "aircraft_type": "A321neo",
        "extra_competitors": [
            {"name": "T", "price": 200.0, "weekly_frequency": 21, "rating": 4.5}
        ],
    }
    accepted = set(inspect.signature(engine.run_scenario).parameters) - {
        "destination", "year", "month",
    }
    assert accepted == set(levers), f"untested or undeclared levers: {accepted ^ set(levers)}"

    # HND has load-factor headroom, so a demand-side lever reaches the P&L.
    base = engine.run_scenario("HND", YEAR, MONTH)
    for name, value in levers.items():
        moved = engine.run_scenario("HND", YEAR, MONTH, **{name: value})
        assert moved["profit_usd"] != base["profit_usd"], f"{name} changed nothing"


def test_whole_schedule_fleet_check_catches_what_per_route_misses(engine):
    """Two routes sharing an aircraft type can each fit alone and not together.

    The per-route check varies one route against today's network, so it says
    yes to both independently - which is the wrong answer for a plan that does
    both.
    """
    fleet = engine.fleet_model
    assert fleet.check("MEL", "A320-200", 56)["feasible"]
    assert fleet.check("AKL", "A320-200", 28)["feasible"]

    together = fleet.current_schedule()
    together["MEL"] = ("A320-200", 56)
    together["AKL"] = ("A320-200", 28)
    assert not fleet.check_schedule(together)["feasible"]


def test_spill_is_reported_when_profit_cannot_move(engine):
    """On a capacity-bound route most scenarios show a zero profit delta.

    That is correct - the aeroplanes are full either way - but it reads as a
    broken lever unless the thing that DID move is in the response.
    """
    comparison = engine.compare("SIN", YEAR, MONTH, tourism_arrivals_multiplier=1.2)
    assert comparison["delta"]["profit_usd"] == 0
    assert comparison["delta"]["spilled_passengers"] > 0, comparison["delta"]


def test_the_readme_test_count_is_true(request):
    """The README advertises a test count. Advertised numbers drift.

    This is the same rule the metrics doc follows: a claim in prose that
    nothing checks eventually stops being true, and the docs already told that
    story once with R2=0.952.
    """
    import re

    readme = (paths.ROOT / "README.md").read_text(encoding="utf-8")
    claimed = {int(n) for n in re.findall(r"(\d+) regression tests", readme)}
    assert claimed, "README no longer states a test count"

    actual = request.session.testscollected
    assert len(claimed) == 1, f"README states several different counts: {claimed}"
    assert abs(claimed.pop() - actual) <= 2, f"README says {claimed}, suite has {actual}"
