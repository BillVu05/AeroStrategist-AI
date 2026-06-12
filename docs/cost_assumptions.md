# Cost & Revenue Model Assumptions (Phases 4-5)

This documents the calibration constants used by `simulation/cost.py` and
`simulation/revenue.py`. As with the demand model, the goal is to be
explicit about what is real vs. calibrated-synthetic so results can be
interpreted honestly.

## Cost model

### Fuel vs. non-fuel split of CASM

`data/aircraft_specs.json` provides `casm_usd` (cost per available-seat-km,
USD) per aircraft type - an industry-typical *total* unit cost figure
(published CAPA/IATA-style economic analyses).

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
fuel_cost_per_hour    = cruise_fuel_burn_kg_per_hour * fuel_price_usd_per_kg
ask_per_hour          = seats_total * cruise_speed_kmh
baseline_fuel_casm    = fuel_cost_per_hour / ask_per_hour
non_fuel_casm         = casm_usd - baseline_fuel_casm
```

For a given scenario, `fuel_casm` is recomputed at the scenario's fuel price
and `total_casm = non_fuel_casm + fuel_casm`.

At the $1.74/gal baseline this gives a fuel share of CASM of roughly:

| Aircraft | baseline_fuel_casm | casm_usd | fuel share |
|---|---|---|---|
| A320-200 | ~0.0111 | 0.075 | ~15% |
| A321neo | ~0.0097 | 0.065 | ~15% |
| B787-9 | ~0.0146 | 0.055 | ~26% |

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

### Monthly route cost

```
ASK_month  = seats_total * distance_km * (weekly_frequency * 4.345)
total_cost = total_casm * ASK_month
```

`weekly_frequency = 0` (candidate routes) uses a notional reference
frequency of 3/week, matching `ml/features.py`.

### Fuel price data

`data/reference/fuel_prices.csv` is a curated set of annual average jet
fuel spot prices (USD/gallon), based on EIA's published US Gulf Coast
Kerosene-Type Jet Fuel Spot Price historical trend (2019 pre-pandemic, 2020
COVID crash, 2022 spike, 2023-24 normalization). These are representative
annual figures, not exact daily EIA pulls.

## Revenue model

### Cabin fare multipliers

The demand model's `avg_fare_usd` is a single blended fare. To split
revenue by cabin, each cabin's fare is set as a multiple of an implied base
(economy) fare, calibrated so the seat-mix-weighted average reproduces
`avg_fare_usd`:

| Cabin | Fare multiple vs. economy |
|---|---|
| Economy | 1.0x |
| Premium economy | 1.6x |
| Business | 3.2x |

These multiples are within the range commonly cited for international fare
structures (business fares roughly 3-4x economy, premium economy roughly
1.5-2x).

```
base_economy_fare = avg_fare_usd / weighted_multiplier
weighted_multiplier = sum(seat_share[cabin] * multiplier[cabin])
cabin_fare = base_economy_fare * multiplier[cabin]
cabin_passengers = total_passengers * seat_share[cabin]
ticket_revenue = sum(cabin_passengers * cabin_fare)
```

### Ancillary revenue

A flat **$25/passenger** ancillary revenue (baggage fees, seat selection,
lounge access, onboard sales) is applied - within the commonly-cited
$15-30/passenger range for full-service international carriers per IATA
ancillary revenue reports.

```
ancillary_revenue = total_passengers * 25
total_revenue     = ticket_revenue + ancillary_revenue
```

## Market share model (Phase 6)

`simulation/market_share.py` implements a multinomial logit ("attraction")
model over Pacific Wings and the synthetic competitors in
`data/processed/competitors.csv`:

```
utility_i = BETA_PRICE * price_i + BETA_FREQUENCY * weekly_frequency_i + BETA_RATING * rating_i
share_i   = exp(utility_i) / sum_j(exp(utility_j))
```

Calibration constants (`BETA_PRICE=-0.01`, `BETA_FREQUENCY=0.15`,
`BETA_RATING=1.0`) are illustrative, chosen so price, frequency, and rating
each have a visible but non-dominant effect on share at the magnitudes seen
in this dataset (fares ~$100-500, frequencies ~3-21/week, ratings ~3.8-4.3).
Pacific Wings' own rating defaults to **4.1**. This is a relative,
what-if-comparison tool, not a model fitted to real market-share data (which
isn't publicly available at route level).

## Simulation engine (Phase 7)

`simulation/engine.py`'s `SimulationEngine.run_scenario(...)` ties Phases
3-6 together for a given route/month:

1. Apply scenario deltas to fare (`price_delta_pct`), frequency
   (`frequency_delta`), aircraft (`aircraft_type`), fuel price
   (`fuel_price_usd_per_gallon`), and Pacific Wings' rating (`rating_delta`).
2. Forecast demand (Phase 3) using the scenario fare - demand depends on
   market features and price, not on Pacific Wings' own capacity.
3. Compute capacity from the scenario frequency/aircraft, and cap
   `passengers_carried = min(predicted_demand, capacity)` - capacity becomes
   the binding constraint when frequency is cut.
4. Compute revenue (Phase 4), cost (Phase 5), and profit from
   `passengers_carried`.
5. Compute market share (Phase 6) from the scenario fare/frequency/rating.

`SimulationEngine.compare(...)` runs both a no-deltas baseline and a
scenario and returns the difference in profit, passengers carried, and
market share. Exposed via `/what_if`.
