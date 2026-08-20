"""
Fleet feasibility: can Pacific Wings actually fly the schedule it is being
asked to price?

Until this existed there was no fleet - `airline_profile.json` listed three
aircraft TYPES with no tail counts, no utilisation and no assignment. So
`frequency_delta=+50` on SYD-SIN priced 57 weekly departures, roughly six
A321neos of dedicated flying, as though the aircraft were free and already
parked at the gate. Nothing in the model could say a scenario was physically
impossible, or that growing Singapore would have to come out of Melbourne.

The constraint is block hours, not departures: a tail can fly only so many
hours a day, and a long sector consumes more of them per departure.

    hours_required(type) = sum over routes of
        weekly_frequency x 2 x (distance / cruise_speed + BLOCK_TIME_OVERHEAD)
    hours_available(type) = tails x max_daily_block_hours x 7

The round trip is what matters - the aeroplane has to come back - even though
revenue and cost are both accounted one-directionally throughout this project
(see pacific_wings/simulation/cost.py).

This reports rather than raises. "You need 4 A321neos and you have 3" is the
useful answer to a growth scenario; refusing to price it is not.
"""

import json

from pacific_wings import paths

ROOT = paths.ROOT

# Taxi, climb and descent beyond cruise time, per sector. Matches
# pacific_wings/analysis/open_route.py's BLOCK_TIME_OVERHEAD_H.
BLOCK_TIME_OVERHEAD_H = 0.5
DAYS_PER_WEEK = 7


def round_trip_block_hours(distance_km: float, cruise_speed_kmh: float) -> float:
    return 2 * (distance_km / cruise_speed_kmh + BLOCK_TIME_OVERHEAD_H)


class FleetModel:
    def __init__(self) -> None:
        profile = json.loads((ROOT / "data" / "airline_profile.json").read_text(encoding="utf-8"))
        self.fleet_by_type = {ac["type"]: ac for ac in profile["airline"]["fleet"]}
        self.routes = profile["routes"]

    def weekly_hours_available(self, aircraft_type: str) -> float:
        aircraft = self.fleet_by_type[aircraft_type]
        return aircraft.get("count", 0) * aircraft.get("max_daily_block_hours", 0.0) * DAYS_PER_WEEK

    def weekly_hours_required(self, schedule: dict[str, tuple[str, int]]) -> dict[str, float]:
        """schedule: {destination: (aircraft_type, weekly_frequency)}."""
        hours: dict[str, float] = {}
        distances = {r["destination"]: r["distance_km"] for r in self.routes}
        for destination, (aircraft_type, frequency) in schedule.items():
            if not frequency:
                continue
            aircraft = self.fleet_by_type[aircraft_type]
            trip = round_trip_block_hours(distances[destination], aircraft["cruise_speed_kmh"])
            hours[aircraft_type] = hours.get(aircraft_type, 0.0) + trip * frequency
        return hours

    def current_schedule(self) -> dict[str, tuple[str, int]]:
        return {
            r["destination"]: (r["assigned_aircraft"], r["weekly_frequency"])
            for r in self.routes
            if r["weekly_frequency"]
        }

    def check(self, destination: str, aircraft_type: str, weekly_frequency: int) -> dict:
        """Feasibility of running `destination` at `weekly_frequency`, with
        the rest of the network flying its current schedule."""
        schedule = self.current_schedule()
        schedule[destination] = (aircraft_type, weekly_frequency)
        return self.check_schedule(schedule)

    def check_schedule(self, schedule: dict[str, tuple[str, int]]) -> dict:
        """Feasibility of a WHOLE schedule.

        `check` varies one route against today's network, which is the right
        question for a single what-if. It is the wrong question for a plan:
        doubling every route at once put the B787-9 fleet over its available
        block hours while every individual route check still passed, because
        each one assumed the others stayed put.
        """
        required = self.weekly_hours_required(schedule)

        by_type = {}
        feasible = True
        for a_type, hours in required.items():
            available = self.weekly_hours_available(a_type)
            aircraft = self.fleet_by_type[a_type]
            daily = aircraft.get("max_daily_block_hours", 0.0) or 1.0
            tails_needed = hours / (daily * DAYS_PER_WEEK)
            type_feasible = hours <= available + 1e-9
            feasible &= type_feasible
            by_type[a_type] = {
                "weekly_block_hours_required": round(hours, 1),
                "weekly_block_hours_available": round(available, 1),
                "utilisation_pct": round(100 * hours / available, 1) if available else None,
                "tails_available": aircraft.get("count", 0),
                "tails_required": round(tails_needed, 2),
                "feasible": type_feasible,
            }

        shortfalls = [
            f"{t}: needs {v['tails_required']:.1f} aircraft, {v['tails_available']} available"
            for t, v in by_type.items()
            if not v["feasible"]
        ]
        return {
            "feasible": feasible,
            "by_aircraft_type": by_type,
            "shortfalls": shortfalls,
            "note": (
                "Schedule fits the current fleet."
                if feasible
                else "Schedule exceeds available block hours - this scenario needs more aircraft."
            ),
        }

    def network_headroom(self) -> dict:
        """Spare block hours per type on the schedule as flown today - the
        answer to "how much can we grow before buying an aircraft?"."""
        check = self.check_schedule(self.current_schedule())
        return {
            a_type: {
                "spare_weekly_block_hours": round(
                    v["weekly_block_hours_available"] - v["weekly_block_hours_required"], 1
                ),
                "utilisation_pct": v["utilisation_pct"],
            }
            for a_type, v in check["by_aircraft_type"].items()
        }


if __name__ == "__main__":
    f = FleetModel()

    # The network as flown today must fit the fleet, or the baseline every
    # scenario is compared against is itself impossible.
    base = f.check("SIN", "A321neo", 7)
    assert base["feasible"], base
    for a_type, v in base["by_aircraft_type"].items():
        assert 0 < v["utilisation_pct"] <= 100, (a_type, v)

    # Growth is possible up to a point, and then it is not.
    assert f.check("SIN", "A321neo", 14)["feasible"]
    stretched = f.check("SIN", "A321neo", 57)
    assert not stretched["feasible"], stretched
    assert stretched["shortfalls"], stretched

    # The case the per-route check cannot see. MEL and AKL share the A320-200
    # fleet. Growing either one alone fits; growing both does not - and every
    # single-route check still says yes, because each assumes the other stayed
    # where it was.
    assert f.check("MEL", "A320-200", 56)["feasible"]
    assert f.check("AKL", "A320-200", 28)["feasible"]

    both = f.current_schedule()
    both["MEL"] = ("A320-200", 56)
    both["AKL"] = ("A320-200", 28)
    network = f.check_schedule(both)
    assert not network["feasible"], network
    assert network["shortfalls"], network

    print("fleet self-check OK")
    for a_type, v in base["by_aircraft_type"].items():
        print(f"  {a_type:<10} {v['weekly_block_hours_required']:>6.1f}h / "
              f"{v['weekly_block_hours_available']:>6.1f}h  ({v['utilisation_pct']:.0f}% of "
              f"{v['tails_available']} tails)")
    print(f"  SIN at 57x/week: {stretched['shortfalls'][0]}")
    print(f"  MEL 56x + AKL 28x together: {network['shortfalls'][0]} (each passes alone)")
    print(f"  headroom today: {f.network_headroom()}")
