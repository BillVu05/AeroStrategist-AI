# Cost & Revenue Model Assumptions

This documents the calibration constants used by `pacific_wings/simulation/cost.py` and
`pacific_wings/simulation/revenue.py`. As with the demand model, the goal is to be
explicit about what is real vs. calibrated-synthetic so results can be
interpreted honestly.

## Cost model

### Real anchor for non-fuel CASM

`data/aircraft_specs.json` provides `casm_usd` (cost per available-seat-km,
USD) per aircraft type - the *total* unit cost at the $1.74/gal baseline
(see below). Its non-fuel component is anchored to Qantas Group's FY25
disclosed ex-fuel unit cost (6.22 AUD cents/ASK; FY24 was 5.97) - the only
clean public CASK figure found for any carrier relevant to this network
(Air New Zealand and Singapore Airlines didn't yield one). This is
explicitly a **group blend** across Qantas mainline + Jetstar and all
stage lengths, not a per-aircraft or per-route figure.

Converted to USD at the same ~0.65 USD/AUD rate used for the
competitor fare conversions: `6.22 AUD cents x 0.65 / 100 = $0.0404/ASK`.
Each aircraft's prior non-fuel CASM was then scaled by a single factor
(`0.0404 / network ASK-weighted average of the prior values = 0.7884`) so
the Pacific Wings network average lands exactly on that real anchor, while
preserving the prior relative shape across aircraft types (smaller/
shorter-stage aircraft cost more per seat-km - consistent with the real-
world economics of stage length, even though the absolute level was
previously an unanchored industry-typical guess).

### Fuel vs. non-fuel split of CASM

To make fuel a controllable "what-if" variable (e.g. "fuel +30%"), CASM is
split into:

- **`non_fuel_casm`** - held constant; covers crew, airport/ATC fees,
  ground handling, lease/ownership, maintenance, catering, insurance, etc.
- **`fuel_casm`** - recomputed for any scenario fuel price from real
  aircraft fuel-burn figures.

The split point is calibrated so that `casm_usd` is reproduced exactly at a
**baseline fuel price of $1.74/gallon (2019 EIA annual average)** - the same
year used for the macro snapshot in `airline_profile.json`:

```
fuel_price_usd_per_kg = usd_per_gallon / KG_PER_GALLON   (KG_PER_GALLON = 3.03)
block_hours           = distance_km / cruise_speed_kmh + BLOCK_TIME_OVERHEAD_H
block_fuel_kg         = cruise_fuel_burn_kg_per_hour * block_hours * BLOCK_FUEL_RESERVE_FACTOR
fuel_cost_per_departure = block_fuel_kg * fuel_price_usd_per_kg
baseline_fuel_casm    = fuel_cost_per_hour / ask_per_hour
non_fuel_casm         = casm_usd - baseline_fuel_casm
```

For a given scenario, `fuel_casm` is recomputed at the scenario's fuel price
and `total_casm = non_fuel_casm + fuel_casm`.

At the $1.74/gal baseline this gives a fuel share of CASM of roughly:

| Aircraft | baseline_fuel_casm | casm_usd | fuel share |
|---|---|---|---|
| A320-200 | ~0.0111 | 0.0615 | ~18% |
| A321neo | ~0.0097 | 0.0533 | ~18% |
| B787-9 | ~0.0146 | 0.0464 | ~31% |

These are broadly consistent with published industry breakdowns where fuel
is typically 15-30% of operating cost depending on aircraft type and fuel
price environment.

### Non-fuel cost breakdown (for display only)

`non_fuel_casm` is shown split into indicative categories using typical
proportions from IATA/ICAO airline economic reports. These percentages are
**illustrative, not separately calibrated** - they only affect how the
single `non_fuel_casm` number is presented, not the total:

| Category | Share of non-fuel cost |
|---|---|
| Crew | 30% |
| Maintenance | 15% |
| Airport & ATC charges | 15% |
| Ownership / lease | 15% |
| Ground handling & catering | 10% |
| Sales, distribution, overheads | 10% |
| Insurance & other | 5% |

### Per-departure vs. per-ASK non-fuel costs

Some non-fuel costs scale with departures, not distance flown: landing
fees, per-passenger airport/terminal/security charges, and ground handling.
A fixed per-departure charge is used per aircraft type (real-world
magnitude estimates - narrowbody ~$2-5k, widebody ~$10-15k per
international turnaround):

| Aircraft | Per-departure charge |
|---|---|
| A320-200 | $3,500 |
| A321neo | $5,000 |
| B787-9 | $12,000 |

These are **carved out of** the published-CASM-derived non-fuel rate, not
added on top: the per-ASK rate is reduced by `per_departure x
departures/ASK` at each type's current network route mix, so the
Qantas-anchored network non-fuel total is unchanged - but short sectors now
correctly cost more per seat-km than long ones, and aircraft swaps carry
their real fixed-cost differences.

### Monthly route cost

```
ASK_month        = seats_total * distance_km * (weekly_frequency * 4.345)
departures_month = weekly_frequency * 4.345
non_fuel_cost    = non_fuel_ask_casm * ASK_month + per_departure_usd * departures_month
total_cost       = fuel_casm * ASK_month + non_fuel_cost
```

`weekly_frequency = 0` (candidate routes) uses a notional reference
frequency of 3/week, matching `pacific_wings/ml/features.py`.

### Fuel price data

`data/reference/fuel_prices.csv` is a curated set of annual average jet
fuel spot prices (USD/gallon), based on EIA's published US Gulf Coast
Kerosene-Type Jet Fuel Spot Price historical trend (2019 pre-pandemic, 2020
COVID crash, 2022 spike, 2023-24 normalization). These are representative
annual figures, not exact daily EIA pulls.

## Revenue model

### Cabin fare multipliers

The demand model's `avg_fare_usd` is on an **economy-fare scale**: the fare
formula behind `demand_observations.csv` was calibrated against economy
benchmark ranges (AU domestic ~$100-180, trans-Tasman ~$150-280, AU-Asia
~$350-650), and `competitors.csv` fares are real spot-checked economy fares
expressed as multiples of that same base. Each cabin's fare is a multiple
of it, so the blended average revenue per passenger is `avg_fare_usd x
weighted_multiplier` (~1.18x on the A320/A321neo two-class mix, ~1.46x on
the B787-9 three-class mix):

| Cabin | Fare multiple vs. economy |
|---|---|
| Economy | 1.0x |
| Premium economy | 1.6x |
| Business | 3.2x |

These multiples are within the range commonly cited for international fare
structures (business fares roughly 3-4x economy, premium economy roughly
1.5-2x).

Premium cabins also sell fewer of their seats than economy (business runs
~70-75% load factor vs. economy ~85%+ industry-wide), so passengers are
allocated by seat share x a cabin fill weight (economy 1.0, premium economy
0.85, business 0.7), renormalized:

```
fill[cabin] = seat_share[cabin] * fill_weight[cabin]
cabin_passengers = total_passengers * fill[cabin] / sum(fill)
cabin_fare = avg_fare_usd * multiplier[cabin]
ticket_revenue = sum(cabin_passengers * cabin_fare)
blended_avg_fare = ticket_revenue / total_passengers   (reported as blended_avg_fare_usd)
```

### Ancillary revenue

Ancillary revenue per passenger (baggage fees, seat selection, lounge
access, onboard sales) scales with journey length - $15 base + 0.2c/km,
capped at 10,000 km: ~$16 domestic, ~$28 medium-haul, $35 long-haul. The
range is consistent with the $15-35/passenger cited for full-service
international carriers in IATA ancillary revenue reports.

```
ancillary_per_pax = 15 + 0.002 * min(distance_km, 10000)
ancillary_revenue = total_passengers * ancillary_per_pax
total_revenue     = ticket_revenue + ancillary_revenue
```

## Market share model

`pacific_wings/simulation/market_share.py` implements a multinomial logit ("attraction")
model over Pacific Wings and the synthetic competitors in
`data/processed/competitors.csv`:

```
utility_i = BETA_LN_FREQUENCY * ln(frequency_i) - BETA_LN_PRICE * ln(price_i) + BETA_RATING * rating_i - product_form_penalty_i
share_i   = exp(utility_i) / sum_j(exp(utility_j))
```

Price and frequency both enter in log form: fares span $25-720 and weekly
frequencies 3-259 across routes, and linear terms would make a $100 or
100-flight gap mean the same thing everywhere. Log terms give a constant
share response to a given *percentage* difference on every route (standard
log-log logit form).

Calibration constants (`BETA_LN_PRICE=-0.7`, `BETA_FREQUENCY=0.4`,
`BETA_RATING=1.8`) are illustrative, chosen so price, frequency, and rating
each have a visible but non-dominant effect - and cross-checked against the
one real benchmark available (BITRE AU-Singapore traffic): Singapore
Airlines models at ~62% share on SYD-SIN vs. its real ~60%. Pacific Wings'
own rating defaults to **4.1**. This is a relative, what-if-comparison
tool, not a model fitted to real market-share data (which isn't publicly
available at route level).

## Simulation engine

`pacific_wings/simulation/engine.py`'s `SimulationEngine.run_scenario(...)`
ties the market, share, revenue, cost and fleet models together for a given
route/month:

1. Apply scenario deltas to fare (`price_delta_pct`), frequency
   (`frequency_delta`), aircraft (`aircraft_type`), fuel price
   (`fuel_price_usd_per_gallon`), and Pacific Wings' rating (`rating_delta`).
2. Forecast the **total route market**, then apply the explicit multipliers:
   macro growth, fare elasticity, tourism, GDP shock.
3. Compute **market share** from the scenario fare/frequency/rating and take
   Pacific Wings' slice: `own_demand = market x share`.
4. Apply the spill curve: `carried = expected_passengers_carried(own_demand, capacity)`. The
   remainder is reported as **spilled** demand.
5. Compute revenue, cost and profit from `carried`.
6. Check the schedule against the **fleet**: block hours required vs. tails
   available.

`SimulationEngine.compare(...)` runs a no-deltas baseline alongside the
scenario and returns the difference in profit, passengers carried, spilled
demand, market share, and fleet feasibility. Exposed via `/what_if`.

Step 3 is the one that used to be missing: market share was computed on a line
nothing consumed, so adding fourteen weekly flights moved modeled share from
9.4% to 13.5% and carried passengers by exactly zero.
