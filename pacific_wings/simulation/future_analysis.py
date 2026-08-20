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


from pacific_wings.ml.features import COUNTRY_ALPHA2_TO_ALPHA3, ReferenceData
from pacific_wings.simulation.engine import SimulationEngine
from pacific_wings.simulation.macro_projections import (
    project_fuel_price,
    project_market_size,
    project_tourism,
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

    Returns:
        {destination, from_year, to_year, passenger_cagr_pct, yearly: {...}}
    """
    scenario_kwargs = scenario_kwargs or {}
    route = _ref.route(destination)
    alpha3 = COUNTRY_ALPHA2_TO_ALPHA3[route["destination_country"]]
    snapshot_tourism = float(route["market"]["tourism_arrivals"])
    snapshot_year = int(route["market"]["snapshot_year"])

    tourism_proj = project_tourism(alpha3, snapshot_tourism, snapshot_year, from_year, to_year)
    fuel_proj = project_fuel_price(from_year, to_year)
    market_proj = project_market_size(alpha3, snapshot_tourism, snapshot_year, from_year, to_year)

    yearly: dict[str, dict] = {}
    prev_pax: float | None = None

    for year in range(from_year, to_year + 1):
        fuel_price = fuel_proj[year]

        annual_pax = 0.0
        annual_market = 0.0
        annual_spilled = 0.0
        annual_revenue = 0.0
        annual_profit = 0.0
        load_factors: list[float] = []
        monthly: list[dict] = []

        for month in range(1, 13):
            try:
                r = _engine.run_scenario(
                    destination,
                    year,
                    month,
                    fuel_price_usd_per_gallon=fuel_price,
                    **scenario_kwargs,
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
            except Exception:
                monthly.append({
                    "month": month,
                    "passengers": 0,
                    "spilled_passengers": 0,
                    "load_factor": 0.0,
                    "revenue_usd": 0,
                    "profit_usd": 0,
                })

        avg_lf = sum(load_factors) / len(load_factors) if load_factors else 0.0
        peak = max(monthly, key=lambda m: m["passengers"])
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
            "annual_revenue_usd": round(annual_revenue),
            "annual_profit_usd": round(annual_profit),
            "avg_load_factor": round(avg_lf, 3),
            "peak_month": peak["month"],
            "yoy_growth_pct": yoy,
            "projected_fuel_price_usd_per_gallon": fuel_price,
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


def network_future_analysis(
    from_year: int,
    to_year: int,
) -> dict:
    """
    Projects every Pacific Wings route (active and candidate) across
    [from_year, to_year] and ranks by total cumulative projected profit.

    Use this for portfolio planning, capital allocation, and identifying which
    markets will be the strongest over a multi-year horizon.

    Returns:
        {from_year, to_year, network_totals, routes: [...sorted by profit...]}
    """
    routes_out = []

    for route in _ref.routes_by_destination.values():
        dest = route["destination"]
        try:
            proj = multi_year_route_projection(dest, from_year, to_year)
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
            })
        except Exception:
            pass

    routes_out.sort(key=lambda r: r["total_projected_profit_usd"], reverse=True)

    return {
        "from_year": from_year,
        "to_year": to_year,
        "network_total_projected_profit_usd": round(sum(r["total_projected_profit_usd"] for r in routes_out)),
        "network_total_projected_revenue_usd": round(sum(r["total_projected_revenue_usd"] for r in routes_out)),
        "network_total_projected_passengers": sum(r["total_projected_passengers"] for r in routes_out),
        "routes": routes_out,
    }
