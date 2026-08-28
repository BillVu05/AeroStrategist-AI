"""
Phase 5 cost model. See docs/cost_assumptions.md for full methodology.

Splits each aircraft's published CASM (cost per available-seat-km) into a
fuel component and a non-fuel component, so fuel price can be varied as a
what-if lever without touching the rest of the cost base.

Fuel is charged on BLOCK fuel - cruise burn over block time, plus reserves -
not on cruise burn over great-circle distance. The non-fuel rate stays derived
from the published CASM's cruise-only split, because that is what anchors it
to Qantas's disclosed ex-fuel CASK.
"""

import json
from collections import defaultdict

import pandas as pd

from pacific_wings import paths

ROOT = paths.ROOT

KG_PER_GALLON = 3.03
BASELINE_FUEL_PRICE_USD_PER_GALLON = 1.74  # 2019 EIA annual average
# The canonical copies: pacific_wings/ml/features.py and
# pacific_wings/analysis/open_route.py import them from here. All three used to
# define 4.345 and 3 for themselves, so a change to the schedule convention had
# to be made in three files or the capacity and the cost of the same month
# stopped agreeing.
WEEKS_PER_MONTH = 4.345
NOTIONAL_CANDIDATE_FREQUENCY = 3

# Taxi, climb and descent beyond cruise time, per sector. The canonical copy -
# pacific_wings/simulation/fleet.py and pacific_wings/analysis/open_route.py
# import it from here rather than each keeping their own.
BLOCK_TIME_OVERHEAD_H = 0.5

# Contingency, alternate and final-reserve fuel, as a multiple of block fuel.
# Reserves are carried rather than burnt, but carrying them costs burn.
#
# Fuel used to be charged as cruise burn over great-circle distance with no
# overhead and no reserves, which billed a 706 km SYD-MEL sector 2,045 kg
# against a real 3,300-3,800 kg and let short routes report 60% operating
# margins. On block time with this factor the same sector costs 3,407 kg,
# SYD-SIN 23,818 kg on the A321neo and SYD-HND 51,921 kg on the 787-9 - all
# inside the published real-world ranges for those sectors.
BLOCK_FUEL_RESERVE_FACTOR = 1.05

# Per-departure charges (landing fee + per-passenger airport/terminal/security
# charges + ground handling), USD per departure - real-world magnitude
# estimates: narrowbody ~$2-5k, widebody ~$10-15k per international turnaround.
# These are carved OUT of the published-CASM-derived non-fuel rate (see
# CostModel.non_fuel_unit_costs), not added on top, so the Qantas-anchored
# calibration total is preserved at each type's current network route mix -
# but short sectors now correctly cost more per seat-km than long ones, and
# frequency/aircraft what-ifs carry their real fixed-cost differences.
PER_DEPARTURE_COST_USD = {
    "A320-200": 3500.0,
    "A321neo": 5000.0,
    "B787-9": 12000.0,
}

# Indicative split of non-fuel CASM into display categories.
# See docs/cost_assumptions.md - illustrative only, does not affect totals.
NON_FUEL_COST_CATEGORY_SHARES = {
    "crew": 0.30,
    "maintenance": 0.15,
    "airport_and_atc": 0.15,
    "ownership_and_lease": 0.15,
    "ground_handling_and_catering": 0.10,
    "sales_and_overheads": 0.10,
    "insurance_and_other": 0.05,
}


def _fuel_price_usd_per_kg(usd_per_gallon: float) -> float:
    return usd_per_gallon / KG_PER_GALLON


def block_hours(distance_km: float, cruise_speed_kmh: float) -> float:
    """One-way block time: cruise plus the taxi/climb/descent overhead."""
    return distance_km / cruise_speed_kmh + BLOCK_TIME_OVERHEAD_H


def block_fuel_kg(aircraft: dict, distance_km: float) -> float:
    """Fuel burnt on one sector, including reserves."""
    hours = block_hours(distance_km, aircraft["cruise_speed_kmh"])
    return aircraft["cruise_fuel_burn_kg_per_hour"] * hours * BLOCK_FUEL_RESERVE_FACTOR


def _cruise_fuel_casm(aircraft: dict, usd_per_gallon: float) -> float:
    """Cruise-only fuel per ASK.

    Used ONLY to split the published CASM into its fuel and non-fuel halves.
    That split is what anchors the non-fuel rate to Qantas's disclosed ex-fuel
    CASK (docs/cost_assumptions.md), and it was derived on this cruise-only
    definition - recomputing it on block fuel would move the non-fuel rate off
    the one real cost anchor in the project. Fuel that is actually CHARGED
    comes from block_fuel_kg, so total cost now exceeds the published CASM by
    the overhead and reserves the published figure never carried.
    """
    fuel_cost_per_hour = aircraft["cruise_fuel_burn_kg_per_hour"] * _fuel_price_usd_per_kg(usd_per_gallon)
    ask_per_hour = aircraft["seats"]["total"] * aircraft["cruise_speed_kmh"]
    return fuel_cost_per_hour / ask_per_hour


def _non_fuel_casm(aircraft: dict) -> float:
    return aircraft["casm_usd"] - _cruise_fuel_casm(aircraft, BASELINE_FUEL_PRICE_USD_PER_GALLON)


def latest_fuel_price(year: int | None = None) -> float:
    """USD/gallon for `year`.

    Inside the observed series it is the recorded price. Beyond it, the
    mean-reversion projection in simulation/macro_projections.py - the same
    curve /macro_projection and /future_analysis publish. Without this every
    scenario, in every year, was costed at the last observed price while the
    macro panel on the same screen showed a different one.
    """
    df = pd.read_csv(ROOT / "data" / "reference" / "fuel_prices.csv")
    df["year"] = pd.to_datetime(df["price_date"]).dt.year
    if year is not None:
        row = df[df["year"] == year]
        if not row.empty:
            return float(row.iloc[0]["usd_per_gallon"])
        latest_year = int(df["year"].max())
        if year > latest_year:
            from pacific_wings.simulation.macro_projections import project_fuel_price

            return float(project_fuel_price(latest_year, year)[year])
    return float(df.sort_values("year").iloc[-1]["usd_per_gallon"])


class CostModel:
    def __init__(self) -> None:
        fleet = json.loads((ROOT / "data" / "aircraft_specs.json").read_text())["aircraft"]
        self.fleet_by_type = {ac["type"]: ac for ac in fleet}

        profile = json.loads((ROOT / "data" / "airline_profile.json").read_text())
        self.routes_by_destination = {r["destination"]: r for r in profile["routes"]}

        # Departures-per-ASK at each type's current ACTIVE network mix -
        # the rebate rate that keeps non_fuel_unit_costs anchor-neutral.
        deps: dict[str, float] = defaultdict(float)
        ask: dict[str, float] = defaultdict(float)
        for route in self.routes_by_destination.values():
            frequency = route["weekly_frequency"]
            if not frequency:
                continue  # candidate routes don't shape the calibration mix
            aircraft = self.fleet_by_type[route["assigned_aircraft"]]
            deps[aircraft["type"]] += frequency
            ask[aircraft["type"]] += aircraft["seats"]["total"] * route["distance_km"] * frequency
        self.departures_per_ask = {t: deps[t] / ask[t] for t in deps}

    def non_fuel_unit_costs(self, aircraft_type: str) -> tuple[float, float]:
        """(per-ASK non-fuel CASM, per-departure USD) for an aircraft type.

        The per-departure charge is subtracted from the published-CASM-derived
        non-fuel rate at the type's current network route mix, so each type's
        network non-fuel total is unchanged (the calibration anchor holds)
        while cost now scales correctly with departures vs. distance.
        """
        aircraft = self.fleet_by_type[aircraft_type]
        per_departure = PER_DEPARTURE_COST_USD.get(aircraft_type, 0.0)
        # Type not in the active network -> no rebate (slightly conservative).
        rebate_rate = self.departures_per_ask.get(aircraft_type, 0.0)
        return _non_fuel_casm(aircraft) - per_departure * rebate_rate, per_departure

    def monthly_cost(
        self,
        destination: str,
        fuel_price_usd_per_gallon: float | None = None,
        weekly_frequency: int | None = None,
        aircraft_type: str | None = None,
        route_override: dict | None = None,
        year: int | None = None,
    ) -> dict:
        """`route_override` lets a caller cost a route that is not in the
        airline profile - a proposed new destination - on exactly this cost
        model rather than a parallel reimplementation of it. It needs only
        `distance_km`, `assigned_aircraft` and `weekly_frequency`.

        `year` selects the fuel price when the caller does not name one."""
        route = route_override or self.routes_by_destination.get(destination)
        if route is None:
            raise KeyError(f"Unknown destination: {destination}")
        aircraft = self.fleet_by_type[aircraft_type or route["assigned_aircraft"]]

        if fuel_price_usd_per_gallon is None:
            fuel_price_usd_per_gallon = latest_fuel_price(year)

        if weekly_frequency is None:
            weekly_frequency = route["weekly_frequency"] or NOTIONAL_CANDIDATE_FREQUENCY

        ask_month = aircraft["seats"]["total"] * route["distance_km"] * weekly_frequency * WEEKS_PER_MONTH
        departures_month = weekly_frequency * WEEKS_PER_MONTH

        non_fuel_ask_casm, per_departure_usd = self.non_fuel_unit_costs(aircraft["type"])

        fuel_kg_per_departure = block_fuel_kg(aircraft, route["distance_km"])
        fuel_cost = (
            fuel_kg_per_departure * _fuel_price_usd_per_kg(fuel_price_usd_per_gallon) * departures_month
        )
        non_fuel_cost = non_fuel_ask_casm * ask_month + per_departure_usd * departures_month
        total_casm = (fuel_cost + non_fuel_cost) / ask_month if ask_month > 0 else 0.0

        non_fuel_breakdown = {
            category: round(non_fuel_cost * share, 2)
            for category, share in NON_FUEL_COST_CATEGORY_SHARES.items()
        }
        # Stated on the wire, not just in the source: these are fixed display
        # shares of the non-fuel total, identical on every route and aircraft.
        non_fuel_breakdown["_note"] = (
            "Indicative split of the non-fuel total on fixed industry shares - "
            "it does not vary by route or aircraft and does not affect any total."
        )

        return {
            "destination": destination,
            "aircraft_type": aircraft["type"],
            "weekly_frequency": weekly_frequency,
            "fuel_price_usd_per_gallon": fuel_price_usd_per_gallon,
            "ask_month": round(ask_month),
            "departures_month": round(departures_month, 1),
            "block_hours_per_departure": round(
                block_hours(route["distance_km"], aircraft["cruise_speed_kmh"]), 2
            ),
            "fuel_kg_per_departure": round(fuel_kg_per_departure),
            "per_departure_cost_usd": per_departure_usd,
            "fuel_cost_usd": round(fuel_cost, 2),
            "non_fuel_cost_usd": round(non_fuel_cost, 2),
            "non_fuel_cost_breakdown_usd": non_fuel_breakdown,
            "total_cost_usd": round(fuel_cost + non_fuel_cost, 2),
            "total_casm_usd": round(total_casm, 5),
        }


if __name__ == "__main__":
    # Self-check: block fuel must land inside the published real-world burn
    # range for each sector, and a short sector must cost more per seat-km
    # than a long one on the same airframe.
    m = CostModel()

    expected_kg = {  # (route, aircraft) -> plausible burn range, real-world published figures
        ("MEL", "A320-200"): (3_000, 4_000),
        ("SIN", "A321neo"): (21_000, 26_000),
        ("HND", "B787-9"): (46_000, 58_000),
    }
    for (dest, ac_type), (lo, hi) in expected_kg.items():
        kg = block_fuel_kg(m.fleet_by_type[ac_type], m.routes_by_destination[dest]["distance_km"])
        assert lo <= kg <= hi, (dest, ac_type, kg, lo, hi)

    short = m.monthly_cost("MEL", fuel_price_usd_per_gallon=2.30)
    long_ = m.monthly_cost("SIN", fuel_price_usd_per_gallon=2.30)
    assert short["total_casm_usd"] > long_["total_casm_usd"], (short, long_)

    # The fuel price must follow the scenario year past the end of the
    # observed series instead of freezing at the last recorded one.
    observed = latest_fuel_price(2024)
    projected = latest_fuel_price(2030)
    assert projected != observed, (observed, projected)

    print(
        f"cost self-check OK (MEL {short['fuel_kg_per_departure']:,}kg/dep CASM "
        f"{short['total_casm_usd']}, SIN {long_['fuel_kg_per_departure']:,}kg/dep CASM "
        f"{long_['total_casm_usd']}, fuel 2024 ${observed} -> 2030 ${projected})"
    )
