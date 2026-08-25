"""
Future market analysis: multi-year projections that feed projected macro
indicators (GDP, population, tourism, fuel) into the deterministic simulation
engine, so demand/revenue/profit trajectories reflect how the total addressable
market itself evolves — not just static macro snapshots.

Three levels of analysis:
  - project_route_fundamentals: raw macro projections for a single route
  - multi_year_route_projection: full P&L trajectory for a single route
  - network_future_analysis: portfolio ranking across all routes
"""


from pacific_wings.ml.features import (
    COUNTRY_ALPHA2_TO_ALPHA3,
    NOTIONAL_CANDIDATE_FREQUENCY,
    ReferenceData,
)
from pacific_wings.simulation.engine import SimulationEngine
from pacific_wings.simulation.macro_projections import (
    project_fuel_price,
    project_market_size,
    project_tourism,
    tourism_weight_for,
)

_ref = ReferenceData()
_engine = SimulationEngine()


def project_route_fundamentals(
    destination: str,
    from_year: int,
    to_year: int,
) -> dict:
    """
    Project macro demand drivers for a route across [from_year, to_year].

    Returns per-year GDP, population, tourism arrivals, fuel price, and the
    composite demand_multiplier that shows how the total addressable market
    grows relative to from_year.

    Args:
        destination: Destination IATA code.
        from_year: First projection year.
        to_year: Last projection year (inclusive).
    """
    route = _ref.route(destination)
    alpha3 = COUNTRY_ALPHA2_TO_ALPHA3[route["destination_country"]]
    snapshot_tourism = float(route["market"]["tourism_arrivals"])
    snapshot_year = int(route["market"]["snapshot_year"])

    market = project_market_size(alpha3, snapshot_tourism, snapshot_year, from_year, to_year)
    fuel = project_fuel_price(from_year, to_year)

    return {
        "destination": destination,
        "destination_city": route["destination_city"],
        "destination_country": route["destination_country"],
        "from_year": from_year,
        "to_year": to_year,
        "yearly": {
            str(year): {
                "gdp_usd": market[year]["gdp_usd"],
                "gdp_growth_pct": market[year]["gdp_growth_pct"],
                "gdp_index": market[year]["gdp_index"],
                "population": market[year]["population"],
                "tourism_arrivals": market[year]["tourism_arrivals"],
                "tourism_index": market[year]["tourism_index"],
                "fuel_price_usd_per_gallon": fuel[year],
                "demand_multiplier": market[year]["demand_multiplier"],
                "data_source": market[year]["data_source"],
            }
            for year in range(from_year, to_year + 1)
        },
    }


def multi_year_route_projection(
    destination: str,
    from_year: int,
    to_year: int,
    representative_month: int = 6,
    scenario_kwargs: dict | None = None,
    frequency_by_year: dict[int, int] | None = None,
) -> dict:
    """
    Project annual demand, revenue, cost, and profit for a route across
    [from_year, to_year].

    Demand growth beyond the model's training window is applied inside
    SimulationEngine.run_scenario via its market_growth_multiplier (the
    XGBoost model is tree-based and cannot extrapolate, so feeding grown
    macro features into it produced flat forecasts). This module feeds
    projected fuel prices into each year's costs and reports the macro
    projections alongside the results.

    Args:
        destination: IATA destination code.
        from_year: First year to project.
        to_year: Last year to project (inclusive).
        representative_month: Only used for metadata; all 12 months are run.
        scenario_kwargs: Optional scenario overrides (price_delta_pct,
            frequency_delta, aircraft_type, rating_delta) applied uniformly.
        frequency_by_year: Absolute weekly frequency to fly in each year,
            overriding `frequency_delta`. This is how a schedule that grows
            with the market gets projected - see `plan_network_schedule`.

    Returns:
        {destination, from_year, to_year, passenger_cagr_pct, yearly: {...}}
    """
    scenario_kwargs = scenario_kwargs or {}
    frequency_by_year = frequency_by_year or {}
    route = _ref.route(destination)
    base_frequency = route["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY
    alpha3 = COUNTRY_ALPHA2_TO_ALPHA3[route["destination_country"]]
    snapshot_tourism = float(route["market"]["tourism_arrivals"])
    snapshot_year = int(route["market"]["snapshot_year"])

    tourism_proj = project_tourism(alpha3, snapshot_tourism, snapshot_year, from_year, to_year)
    fuel_proj = project_fuel_price(from_year, to_year)
    market_proj = project_market_size(
        alpha3, snapshot_tourism, snapshot_year, from_year, to_year,
        tourism_weight=tourism_weight_for(alpha3),
    )

    yearly: dict[str, dict] = {}
    prev_pax: float | None = None

    for year in range(from_year, to_year + 1):
        fuel_price = fuel_proj[year]
        year_kwargs = dict(scenario_kwargs)
        if year in frequency_by_year:
            year_kwargs["frequency_delta"] = int(frequency_by_year[year]) - base_frequency

        annual_pax = 0.0
        annual_market = 0.0
        annual_spilled = 0.0
        annual_revenue = 0.0
        annual_profit = 0.0
        load_factors: list[float] = []
        monthly: list[dict] = []
        failed_months: list[dict] = []

        for month in range(1, 13):
            try:
                r = _engine.run_scenario(
                    destination,
                    year,
                    month,
                    fuel_price_usd_per_gallon=fuel_price,
                    **year_kwargs,
                )
                pax = float(r["demand"]["passengers_carried"])
                rev = float(r["revenue"]["total_revenue_usd"])
                profit = float(r["profit_usd"])
                lf = float(r["demand"]["load_factor"])
                spilled = float(r["demand"]["spilled_passengers"])

                annual_pax += pax
                annual_market += float(r["demand"]["market_passengers"])
                annual_spilled += spilled
                annual_revenue += rev
                annual_profit += profit
                load_factors.append(lf)
                monthly.append({
                    "month": month,
                    "passengers": round(pax),
                    "spilled_passengers": round(spilled),
                    "load_factor": round(lf, 3),
                    "revenue_usd": round(rev),
                    "profit_usd": round(profit),
                })
            except Exception as exc:
                # A month that fails used to be written as zero passengers,
                # zero revenue AND zero cost, so a route whose months half
                # failed reported a plausible-looking half-size year with
                # nothing on screen to say so - and avg_load_factor quietly
                # averaged in the zeros. Record it as failed and let the annual
                # figure carry the fact that it is incomplete.
                failed_months.append({"month": month, "error": f"{type(exc).__name__}: {exc}"})
                monthly.append({
                    "month": month,
                    "failed": True,
                    "error": f"{type(exc).__name__}: {exc}",
                })

        avg_lf = sum(load_factors) / len(load_factors) if load_factors else 0.0
        priced = [m for m in monthly if not m.get("failed")]
        peak = max(priced, key=lambda m: m["passengers"]) if priced else {"month": None}
        yoy = round((annual_pax / prev_pax - 1) * 100, 2) if prev_pax else None

        yearly[str(year)] = {
            "annual_passengers": round(annual_pax),
            # Carried passengers can sit flat while the market grows: the
            # route is spilling. Without these two lines a capacity-bound
            # route reports an identical figure every year for a decade with
            # nothing on the page to explain why.
            "annual_market_passengers": round(annual_market),
            "annual_spilled_passengers": round(annual_spilled),
            "capacity_constrained": annual_spilled > 0,
            "months_priced": len(priced),
            "incomplete": bool(failed_months),
            "failed_months": failed_months,
            "annual_revenue_usd": round(annual_revenue),
            "annual_profit_usd": round(annual_profit),
            "avg_load_factor": round(avg_lf, 3),
            "peak_month": peak["month"],
            "yoy_growth_pct": yoy,
            "projected_fuel_price_usd_per_gallon": fuel_price,
            "weekly_frequency": base_frequency + int(year_kwargs.get("frequency_delta", 0)),
            "market_growth_multiplier": _engine.market_growth_multiplier(destination, year),
            "tourism_arrivals": tourism_proj[year],
            "gdp_usd": market_proj[year]["gdp_usd"],
            "gdp_growth_pct": market_proj[year]["gdp_growth_pct"],
            "demand_multiplier": market_proj[year]["demand_multiplier"],
            "monthly": monthly,
        }
        prev_pax = annual_pax

    first_pax = yearly[str(from_year)]["annual_passengers"]
    last_pax = yearly[str(to_year)]["annual_passengers"]
    n = to_year - from_year

    def _cagr(first: float, last: float) -> float | None:
        return ((last / first) ** (1 / n) - 1) * 100 if n > 0 and first > 0 else None

    cagr = _cagr(first_pax, last_pax)
    # Market CAGR is reported alongside carried CAGR because on a
    # capacity-bound route they diverge, and the gap between them IS the
    # finding: the market is growing and Pacific Wings cannot take any of it.
    market_cagr = _cagr(
        yearly[str(from_year)]["annual_market_passengers"],
        yearly[str(to_year)]["annual_market_passengers"],
    )
    constrained_years = [y for y, v in yearly.items() if v["capacity_constrained"]]

    return {
        "destination": destination,
        "destination_city": route["destination_city"],
        "destination_country": route["destination_country"],
        "from_year": from_year,
        "to_year": to_year,
        "passenger_cagr_pct": round(cagr, 2) if cagr is not None else None,
        "market_cagr_pct": round(market_cagr, 2) if market_cagr is not None else None,
        "capacity_constrained_years": constrained_years,
        "growth_blocked_by_capacity": bool(
            constrained_years and market_cagr is not None and cagr is not None
            and market_cagr - cagr > 0.5
        ),
        "yearly": yearly,
    }


# How many single-frequency additions the greedy planner will consider in one
# year. Ten is already a doubling of the largest route; the cap exists so a
# runaway route cannot spend the whole loop.
MAX_ANNUAL_FREQUENCY_ADDS = 20


def plan_network_schedule(
    from_year: int, to_year: int, representative_month: int = 7
) -> dict[int, dict[str, int]]:
    """Weekly frequency per active route per year, grown to meet demand.

    Projections used to fly today's timetable unchanged for the whole horizon,
    which is why three of five routes reported a passenger CAGR of exactly
    0.00% over a decade while their addressable markets grew 46-55%: the
    schedule could not respond, so the answer to ten years of demand growth was
    that the airline never adds a flight.

    Greedy, one weekly frequency at a time, to whichever route gains the most
    profit from it, for as long as the WHOLE schedule still fits the fleet -
    `check_schedule`, not the per-route check, because two routes sharing an
    aircraft type can each pass alone and not together. Ranking uses a single
    representative month; the full twelve-month projection is then run on the
    chosen schedule.

    Candidate routes are left at their notional frequency: launching one is a
    decision for the screener, not for a capacity planner.
    """
    fleet = _engine.fleet_model
    schedule = {
        dest: route["weekly_frequency"]
        for dest, route in _ref.routes_by_destination.items()
        if route["weekly_frequency"]
    }
    aircraft = {
        dest: route["assigned_aircraft"] for dest, route in _ref.routes_by_destination.items()
    }

    def profit(dest: str, year: int, frequency: int) -> float:
        base = _ref.routes_by_destination[dest]["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY
        return float(
            _engine.run_scenario(
                dest, year, representative_month, frequency_delta=frequency - base
            )["profit_usd"]
        )

    plan: dict[int, dict[str, int]] = {}
    for year in range(from_year, to_year + 1):
        current = {d: profit(d, year, f) for d, f in schedule.items()}
        for _ in range(MAX_ANNUAL_FREQUENCY_ADDS):
            best_dest, best_gain = None, 0.0
            for dest, frequency in schedule.items():
                trial = {d: (aircraft[d], f) for d, f in schedule.items()}
                trial[dest] = (aircraft[dest], frequency + 1)
                if not fleet.check_schedule(trial)["feasible"]:
                    continue
                gain = profit(dest, year, frequency + 1) - current[dest]
                if gain > best_gain:
                    best_dest, best_gain = dest, gain
            if best_dest is None:
                break
            schedule[best_dest] += 1
            current[best_dest] = profit(best_dest, year, schedule[best_dest])
        plan[year] = dict(schedule)

    return plan


def network_future_analysis(
    from_year: int,
    to_year: int,
    optimise_schedule: bool = True,
) -> dict:
    """
    Projects every Pacific Wings route (active and candidate) across
    [from_year, to_year] and ranks by total cumulative projected profit.

    Use this for portfolio planning, capital allocation, and identifying which
    markets will be the strongest over a multi-year horizon.

    Totals are reported for the ACTIVE network and for candidates separately.
    A single headline used to sum both, so a decade of Da Nang losses - a route
    the screener rates DO NOT PROCEED and the airline has never flown - was
    netted off the network's projected profit without appearing anywhere.

    `optimise_schedule` grows each active route's weekly frequency year by year
    under the fleet constraint (see `plan_network_schedule`). Set it False to
    project today's timetable held fixed for the whole horizon.

    Returns:
        {from_year, to_year, active_network_totals, candidate_totals,
         routes: [...sorted by profit...]}
    """
    routes_out = []
    plan = plan_network_schedule(from_year, to_year) if optimise_schedule else {}

    for route in _ref.routes_by_destination.values():
        dest = route["destination"]
        try:
            frequency_by_year = {y: sched[dest] for y, sched in plan.items() if dest in sched}
            proj = multi_year_route_projection(
                dest, from_year, to_year, frequency_by_year=frequency_by_year or None
            )
            first = proj["yearly"][str(from_year)]
            last = proj["yearly"][str(to_year)]

            total_profit = sum(
                proj["yearly"][str(y)]["annual_profit_usd"]
                for y in range(from_year, to_year + 1)
            )
            total_revenue = sum(
                proj["yearly"][str(y)]["annual_revenue_usd"]
                for y in range(from_year, to_year + 1)
            )
            total_pax = sum(
                proj["yearly"][str(y)]["annual_passengers"]
                for y in range(from_year, to_year + 1)
            )

            routes_out.append({
                "destination": dest,
                "destination_city": route["destination_city"],
                "destination_country": route["destination_country"],
                "status": route["status"],
                "passenger_cagr_pct": proj["passenger_cagr_pct"],
                "demand_multiplier_end_year": last["demand_multiplier"],
                "total_projected_passengers": total_pax,
                "total_projected_revenue_usd": round(total_revenue),
                "total_projected_profit_usd": round(total_profit),
                "start_year_passengers": first["annual_passengers"],
                "end_year_passengers": last["annual_passengers"],
                "start_year_profit_usd": first["annual_profit_usd"],
                "end_year_profit_usd": last["annual_profit_usd"],
                "start_year_load_factor": first["avg_load_factor"],
                "end_year_load_factor": last["avg_load_factor"],
                "start_year_weekly_frequency": first["weekly_frequency"],
                "end_year_weekly_frequency": last["weekly_frequency"],
            })
        except Exception:
            pass

    routes_out.sort(key=lambda r: r["total_projected_profit_usd"], reverse=True)

    def _totals(rows: list[dict]) -> dict:
        return {
            "projected_profit_usd": round(sum(r["total_projected_profit_usd"] for r in rows)),
            "projected_revenue_usd": round(sum(r["total_projected_revenue_usd"] for r in rows)),
            "projected_passengers": sum(r["total_projected_passengers"] for r in rows),
            "routes": [r["destination"] for r in rows],
        }

    active = [r for r in routes_out if r["status"] == "active"]
    candidates = [r for r in routes_out if r["status"] != "active"]

    return {
        "from_year": from_year,
        "to_year": to_year,
        "schedule_optimised": optimise_schedule,
        "active_network_totals": _totals(active),
        "candidate_totals": _totals(candidates),
        "totals_note": (
            "Active and candidate routes are totalled separately. A candidate has not been "
            "launched and may never be - screen it with /analyze_route before reading its "
            "figures as a commitment."
        ),
        "routes": routes_out,
    }
