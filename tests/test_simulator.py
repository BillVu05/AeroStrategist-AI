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
    assert verdict["status"] in {
        "beats_baseline",
        "ties_baseline",
        # One training year makes the seasonal index and same_month_last_year
        # the same estimator, so the comparison is an identity rather than a
        # result. Reporting that as "ties_baseline, improvement 1.3e-16" read
        # like a close race a better model might win.
        "identical_by_construction",
    }, verdict
    if verdict["status"] == "identical_by_construction":
        assert verdict["degenerate"] is True, verdict
        assert verdict["note"], verdict


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


def test_extra_demand_moves_profit_on_a_busy_route(engine):
    """More demand must reach the P&L even when the route is already busy.

    This test used to assert the OPPOSITE - that the profit delta was exactly
    zero - because passengers were clipped at `min(demand, capacity x 0.88)`,
    so above the ceiling nothing a lever did could change what was carried.
    Three of five routes sat there at baseline, which made "raise the fare" a
    free win and "add a flight" a linear one. Demand now meets a spill curve
    instead of a wall: carried rises with demand, more slowly as the aircraft
    fills, and both the profit and the spill move.
    """
    comparison = engine.compare("SIN", YEAR, MONTH, tourism_arrivals_multiplier=1.2)
    assert comparison["delta"]["profit_usd"] > 0, comparison["delta"]
    assert comparison["delta"]["passengers_carried"] > 0, comparison["delta"]
    assert comparison["delta"]["spilled_passengers"] > 0, comparison["delta"]


def test_carried_passengers_respond_to_fare_on_a_busy_route(engine):
    """No flat region: every fare step must move passengers on a full route."""
    carried = [
        engine.run_scenario("MEL", YEAR, MONTH, price_delta_pct=d)["demand"]["passengers_carried"]
        for d in (-0.1, 0.0, 0.1, 0.2)
    ]
    assert all(b < a for a, b in zip(carried, carried[1:])), carried


def test_frequency_growth_has_diminishing_returns(engine):
    """Each added flight must be worth less than the one before it.

    A hard capacity clip made every added frequency worth exactly the same
    $103,300, from three a week to twenty-one, so the model could never say
    when growth stopped paying.
    """
    profits = [
        engine.run_scenario("SIN", YEAR, MONTH, frequency_delta=d)["profit_usd"]
        for d in (0, 2, 4, 6)
    ]
    gains = [b - a for a, b in zip(profits, profits[1:])]
    assert all(g > 0 for g in gains), profits
    assert all(b < a for a, b in zip(gains, gains[1:])), gains


# ── the audit fixes, each with the pathology it replaced ─────────────────────

def test_fuel_is_charged_on_block_time_not_cruise_time():
    """Cruise burn over great-circle distance billed a 706 km SYD-MEL sector
    2,045 kg against a real 3,300-3,800 kg, which is how a domestic trunk route
    came to report a 60% operating margin."""
    from pacific_wings.simulation.cost import CostModel, block_fuel_kg

    model = CostModel()
    mel = model.routes_by_destination["MEL"]
    kg = block_fuel_kg(model.fleet_by_type["A320-200"], mel["distance_km"])
    assert 3_000 <= kg <= 4_000, kg


def test_scenario_year_sets_the_fuel_price():
    """Every scenario, in every year, used to be costed at the last observed
    price while the macro panel on the same screen showed a different one."""
    from pacific_wings.simulation.cost import CostModel

    model = CostModel()
    near = model.monthly_cost("SIN", year=2024)["fuel_price_usd_per_gallon"]
    far = model.monthly_cost("SIN", year=2031)["fuel_price_usd_per_gallon"]
    assert near != far, (near, far)


def test_tourism_is_anchored_on_observed_arrivals():
    """Compounding the 2015-19 CAGR from a 2019 snapshot ran the boom straight
    through the pandemic: Japan came out at 73.8M arrivals for 2026 against a
    real 36.9M in 2024."""
    from pacific_wings.simulation.macro_projections import project_tourism

    japan = project_tourism("JPN", 31_881_000, 2019, 2024, 2026)
    assert japan[2024] == 36_870_000, japan[2024]
    assert japan[2026] < 55_000_000, japan[2026]


def test_a_domestic_route_is_not_grown_by_inbound_tourism():
    from pacific_wings.simulation.macro_projections import tourism_weight_for

    assert tourism_weight_for("AUS") == 0.0
    assert tourism_weight_for("JPN") > 0.0


def test_confidence_is_reported_as_a_band():
    """A one-decimal "66.5%" claimed a precision the weights cannot support."""
    from pacific_wings.ml.confidence import ConfidenceModel

    model = ConfidenceModel()
    scored = model.score("SIN", model.train_year_max, 7, {"avg_fare_usd": 454.0}, 70_000)
    assert scored["confidence_band"] in {"High", "Moderate", "Low", "Very low"}
    assert scored["confidence_pct"] % 5 == 0, scored["confidence_pct"]
    assert scored["confidence_basis"]


def test_the_api_refuses_years_it_cannot_forecast():
    """2050 used to be answerable, at an identical floored score for eighteen
    straight years."""
    from pacific_wings.api.config import YEAR_MAX
    from pacific_wings.ml.confidence import ConfidenceModel

    assert ConfidenceModel().max_useful_forecast_year() == YEAR_MAX


def test_monte_carlo_agrees_with_the_deterministic_run(engine):
    """A lognormal centred on the median put the sampled mean 12% below the
    point estimate, and a $6.00 clamp piled 8% of trials into one bin."""
    from pacific_wings.simulation.monte_carlo import run_monte_carlo

    result = run_monte_carlo(engine, "SIN", YEAR, MONTH, n_simulations=400)
    point = result["deterministic_profit_usd"]
    spread = result["profit_usd"]["p90"] - result["profit_usd"]["p10"]
    assert abs(result["profit_usd"]["mean"] - point) < 0.1 * spread, result["profit_usd"]


def test_the_screener_sizes_frequency_to_the_market():
    """Screening every candidate at a fixed 3x/week made market size cancel out
    of `market x share`: Tokyo, Seoul and Honolulu all returned ~27,000
    passengers and annual profit within 5% of each other."""
    from pacific_wings.analysis.open_route import analyze_open_route

    results = [analyze_open_route(d) for d in ("NRT", "ICN", "HNL", "DPS")]
    profits = [r["financials"]["annual_profit_usd"] for r in results]
    assert max(profits) - min(profits) > 0.25 * abs(max(profits, key=abs)), profits
    for r in results:
        assert r["operations"]["frequency_options"], r["operations"]
        assert r["operations"]["frequency_basis"].startswith("sized")


def test_the_screener_checks_the_fleet_not_just_the_range():
    """Three candidates each fitted the spare 787 hours alone and needed 171 of
    the 90 available between them; the comparison had no fleet column."""
    from pacific_wings.analysis.open_route import compare_route_alternatives

    compared = compare_route_alternatives(["HKG", "BKK", "POM", "NAN"])
    joint = compared["combined_fleet_check"]
    assert joint["shortlist"], compared
    assert joint["feasible"] is False, joint
    assert joint["shortfalls"], joint


def test_candidate_share_is_published_with_its_sensitivity(engine):
    """Share on an unserved route is set by one assumed connecting frequency,
    and moved 41.5% -> 6.6% across the plausible range of it."""
    share = engine.market_share_model.compute("DAD", own_price=562, own_frequency=3)
    low, high = share["pacific_wings_share_range"]
    assert low < share["pacific_wings_share"] < high, share
    assert share["share_range_note"]


def test_candidate_routes_are_totalled_separately():
    """A decade of Da Nang losses used to be netted off the network headline
    for a route the screener rates DO NOT PROCEED."""
    from pacific_wings.simulation.future_analysis import network_future_analysis

    result = network_future_analysis(2026, 2028)
    assert result["active_network_totals"]["routes"], result
    assert "DAD" in result["candidate_totals"]["routes"], result
    assert "DAD" not in result["active_network_totals"]["routes"], result


def test_the_projection_can_add_a_flight():
    """Three routes reported a passenger CAGR of exactly 0.00% over a decade
    while their markets grew 46-55%, because the schedule never changed."""
    from pacific_wings.simulation.future_analysis import network_future_analysis

    result = network_future_analysis(2026, 2031)
    grew = [
        r for r in result["routes"]
        if r["status"] == "active"
        and r["end_year_weekly_frequency"] > r["start_year_weekly_frequency"]
    ]
    assert grew, [
        (r["destination"], r["start_year_weekly_frequency"], r["end_year_weekly_frequency"])
        for r in result["routes"]
    ]
    for r in result["routes"]:
        if r["status"] == "active":
            assert r["passenger_cagr_pct"] != 0.0, r


def test_a_failed_month_is_not_a_free_month():
    """A month that raised used to be written as zero passengers, zero revenue
    AND zero cost, deflating the year with nothing on screen to say so."""
    from pacific_wings.simulation.future_analysis import multi_year_route_projection

    year = multi_year_route_projection("SIN", 2026, 2026)["yearly"]["2026"]
    assert year["months_priced"] == 12, year
    assert year["incomplete"] is False, year
    for month in year["monthly"]:
        assert not month.get("failed"), month


def test_no_lead_in_fare_is_recorded_as_an_average():
    """Jetstar's SYD-MEL average fare was $27.10 - a spot-checked lead-in fare,
    not a year's average."""
    import csv

    with open(paths.ROOT / "data" / "processed" / "competitors.csv", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            assert float(row["avg_fare_usd"]) >= 50.0, row


def test_the_cost_breakdown_says_it_is_indicative():
    from pacific_wings.simulation.cost import CostModel

    breakdown = CostModel().monthly_cost("SIN")["non_fuel_cost_breakdown_usd"]
    assert "_note" in breakdown and "Indicative" in breakdown["_note"]


def test_the_etl_can_be_installed_from_requirements():
    """etl/fetch_real_aviation_stats.py imports openpyxl, which appeared in no
    requirements file, so the pipeline behind every real figure in the product
    could not be run from a clean checkout."""
    requirements = (paths.ROOT / "requirements.txt").read_text(encoding="utf-8")
    assert "openpyxl" in requirements


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
