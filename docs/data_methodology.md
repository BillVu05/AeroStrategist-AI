# Data Methodology: What's Real, What's Assumed, What's Illustrative

Pacific Wings is a fictional airline. Nothing here claims otherwise. What
this document does claim, field by field, is which numbers underneath it
are real (with a source and date), which are real data combined with a
necessary, stated assumption (because Pacific Wings itself isn't real), and
which are pure illustrative modeling choices with no claim to historical
accuracy. The goal is an honest provenance trail, not maximizing the
appearance of realism.

Three tiers, used throughout:

- **Real** - a number that exists in the world, sourced from a named
  publication, with a date.
- **Real-derived** - built from real data, but requires at least one
  assumption to bridge from "the real world" to "Pacific Wings" (which
  doesn't exist, so it can't have a real market share, real historical
  fares, etc.). The real component and the assumption are both stated.
- **Illustrative** - a deliberate modeling choice, calibrated to be
  plausible (in range, internally consistent) but not fitted to or anchored
  on any specific real dataset. Usually because no public dataset exists at
  the required granularity (e.g. route-level market share).

## Network & geography

| Field | Tier | Source | Notes |
|---|---|---|---|
| Airport coordinates, names | Real | [OurAirports](https://ourairports.com/data/) | `etl/fetch_airports.py` |
| Route distances | Real | Great-circle (haversine) from the above | `etl/build_airline_profile.py` |
| Route network (SYD-SIN/HND/MEL/AKL, candidate SYD-DAD) | Real-derived | Sydney is a real Pacific Wings HQ choice; SIN/HND/MEL/AKL are real Sydney routes flown by real carriers today | HND not NRT - no carrier flies Sydney-Narita today (Phase 1, 2026-06) |

## Macroeconomic & tourism data

| Field | Tier | Source | Notes |
|---|---|---|---|
| GDP, GDP growth, population (2010-2024) | Real | [World Bank Open Data API](https://api.worldbank.org/v2) | `etl/fetch_worldbank.py` |
| Tourism arrivals | Real, 2019 snapshot | World Bank | Frozen at 2019 (last pre-pandemic year with complete data for all 5 countries) and used as a static feature - post-2020 tourism data is largely missing/incomplete |

## Aircraft & cost

| Field | Tier | Source | Notes |
|---|---|---|---|
| Seats, range, cruise speed, fuel burn | Real | Airbus/Boeing public spec sheets | `data/aircraft_specs.json` |
| Jet fuel price history (2019-2024 annual averages) | Real | EIA US Gulf Coast Kerosene-Type Jet Fuel Spot Price | `data/reference/fuel_prices.csv`, curated annual averages, not daily pulls |
| Non-fuel CASM (cost per available-seat-km) | Real-derived | Qantas Group FY25 disclosed ex-fuel unit cost, 6.22 AUD cents/ASK (FY24: 5.97) | The **only** clean public CASK figure found for any carrier relevant to this network - Air New Zealand and Singapore Airlines didn't yield one. Explicitly a **group blend** (mainline + Jetstar, all stage lengths), not per-aircraft. Converted to USD at ~0.65 USD/AUD, then scaled uniformly across the 3 aircraft types to preserve their prior relative shape. See `docs/cost_assumptions.md` |
| Fuel component of CASM | Real | Computed per-aircraft from the real fuel-burn figures above, at the real EIA baseline fuel price | Not anchored to Qantas's fuel price (unknown, FY25-environment) - computed independently so it stays correct under any what-if fuel scenario |
| Non-fuel cost category breakdown (crew 30%, maintenance 15%, etc.) | Illustrative | Typical proportions from IATA/ICAO airline economic reports | Display-only - doesn't affect the total cost figure, see `docs/cost_assumptions.md` |

## Competitors & fares

| Field | Tier | Source | Notes |
|---|---|---|---|
| Competitor identities (Singapore Airlines, Scoot, Qantas, JAL, ANA, Virgin Australia, Jetstar, Air New Zealand) | Real | Flight-aggregator schedules (FlightConnections/FlightsFrom/Directflights) + BITRE international airline activity for relative scale | `etl/generate_synthetic_demand.py`'s `COMPETITORS` |
| Competitor weekly frequencies | Real | Same as above | Spans ~2 orders of magnitude (SYD-DAD: 0 to Qantas on SYD-MEL: ~259/week) |
| Competitor ratings | Real | Skytrax World Airline Star Rating, 1-5 scale | skytraxratings.com |
| Competitor fares | Real, single snapshot | Spot-checked one-way economy fares, June 2026 (Google Flights/Skyscanner/Kayak/Qantas/Travelocity) | A point-in-time observation, not a historical fare series (none exists for free at this granularity) |
| SYD-DAD competitors | Real (absence) | BITRE city-pair data confirms zero real nonstop SYD-Da Nang service since a suppressed 3-month blip, Dec 2014-Apr 2015 | Modeled with zero competitors, deliberately |
| Pacific Wings' own fare formula (flat fee + per-km rate) | Real-derived | Reproduces the spot-checked competitor fares above almost exactly when run on each route's real distance | The competitor fare *multipliers* were originally derived as `real_fare / this_formula's_output`, so the formula is real-anchored by construction, not just coincidentally close |
| `agents/open_route_analyst.py`'s fare estimate for arbitrary new destinations | Real-derived | Same formula as above (Phase 4 fix - the prior hardcoded step table ran 60-105% above this real anchor at every distance band) | |

## Demand (`data/processed/demand_observations.csv`)

| Route | Tier | Detail |
|---|---|---|
| SIN, HND, AKL | Real-derived | Total market = real BITRE Sydney-city monthly passenger counts (`bitre_international_citypairs.xlsx`), halved to a one-way-equivalent. Pacific Wings' own passengers = that real total x an assumed new-entrant market share (necessarily an assumption - Pacific Wings isn't real - reusing `agents/open_route_analyst.py`'s `_new_entrant_share` heuristic), capped at capacity x the real BITRE Australia-country seat utilisation rate (`bitre_international_flights_seats.xlsx`) so passengers never exceed physical capacity. `load_factor` is always `passengers / capacity`, so the two stay internally consistent |
| DAD (candidate) | Real-derived, deliberately rough | Same mechanism, but the "total market" itself doesn't exist (no real DAD service) - estimated by scaling the real SYD-Ho Chi Minh City + SYD-Hanoi BITRE markets down by Da Nang's share of combined city population (~1.25M vs ~18.3M, 2024 metro-area estimates, Macrotrends) |
| MEL | Synthetic (unchanged) | SYD-MEL is domestic; BITRE's free city-pair download is international-only and no real domestic source was downloaded for this rebuild (a deliberate scope decision, not an oversight) - left on the original formula-driven estimate (real distance/macro features + seasonality + noise, calibrated to published IATA benchmark ranges) |

The 2022 trough visible in the real-derived routes (e.g. SIN load factor
~35% in January 2022) is real: Australia's international border reopened
in February 2022, so early-2022 traffic genuinely was that low. Real data
brings real noise - this isn't model error.

## Demand forecasting model (`ml/train_demand_model.py`)

- **Headline metric**: time-based holdout, train on 2022-2023, test on
  2024. Once the routes above became real-derived, this changed meaning:
  it used to measure how well XGBoost recovers a known synthetic formula
  (R2=0.984, MAPE=3.7%); it now measures genuine forecast skill against
  real-world noise (R2=0.952, MAPE=15.3%) - a real, expected drop, not a
  regression.
- **5-fold cross-validation** (shuffled, ignores time order) gives a second,
  independent read: R2 is stable (0.966 +/- 0.014), but MAPE is far less
  stable (42% +/- 26%) than the single holdout suggests - almost certainly
  because DAD's tiny passenger counts (as low as 15/month) blow up
  percentage error whenever a fold under-represents that route. Reported
  honestly rather than hidden; see `models/metrics.json`.
- **Prediction intervals** on `/demand_forecast` (`predicted_passengers_low/
  high`) are a residual-bootstrap-style band: the point forecast plus the
  real holdout's 10th/90th percentile error, clamped to `[0, capacity]`.
  Not a model-based interval (no quantile regression) - just the actual
  historical error distribution.
- **Confidence score** (`ml/confidence.py`, every `confidence_pct` shown in
  the frontend) replaces the fabricated "Confidence %" badges removed
  during the realism audit. Real-derived, combining three signals:
  - *Bootstrap ensemble disagreement* - `ml/train_demand_model.py` also
    trains 30 models, each on a resample-with-replacement of the training
    rows; the spread of their predictions on a given forecast is a real
    epistemic-uncertainty signal (how sensitive the answer is to exactly
    which training rows the model happened to see).
  - *Per-route historical reliability* - the residual quantiles above,
    split by route instead of pooled. Only ~12 holdout rows per route, so
    treat as rough, but real: e.g. MEL's real holdout residuals are far
    tighter than DAD's, matching the CV finding above.
  - *Extrapolation distance* - how many years the request falls outside
    the 2022-2023 training window, and how far any input feature (e.g. an
    extreme what-if fare override) falls outside the range actually seen
    in training.
  The three signals are combined with documented, illustrative weights
  (not fitted to any ground truth - no labeled "was this forecast right"
  dataset exists, since Pacific Wings isn't real) - same honesty caveat as
  `simulation/market_share.py`'s betas. What's real is every input: the
  bootstrap spread, the historical residuals, and the training data's
  actual year/feature ranges. `confidence_notes` surfaces which specific
  factor (if any) is reducing the score, e.g. "Forecast year 2026 is 3
  year(s) outside the model's 2022-2023 training window."

## Market share model (`simulation/market_share.py`)

| Field | Tier | Notes |
|---|---|---|
| Functional form (multinomial logit / QSI-style attraction model) | Illustrative | Standard airline market-share modeling approach, not fitted |
| Beta coefficients (price, frequency, rating) | Illustrative | No public route-level market-share dataset exists to fit against - chosen so each factor has a visible, non-dominant effect at this dataset's real fare/frequency/rating magnitudes |
| Sanity check | Real cross-check, not a fit | Compared against one real benchmark (BITRE country-level AU-Singapore traffic share): this calibration puts Singapore Airlines at ~61% modeled share on SYD-SIN vs. its real ~60% reported share. One data point, used as a plausibility check, not a calibration target |

## Monte Carlo scenario simulator (`simulation/monte_carlo.py`)

| Randomized input | Tier | Notes |
|---|---|---|
| Fuel price | Real-derived | Lognormal, sigma = the real log-return volatility of `fuel_prices.csv`'s 2019-2024 series (~0.67) - wide because that period spans the COVID collapse and the 2022 spike, not because the model invents drama. From only 6 annual points, the volatility estimate is itself uncertain |
| GDP growth | Real-derived | Normal, std = the destination country's real 2010-2024 GDP growth standard deviation (`macro_indicators.csv`) - e.g. ~1.0pp for Australia vs. ~4.0pp for Singapore |
| Competitor entry (probability + discount) | Illustrative | No public source for new-entrant timing probabilities exists - a documented 25% entry probability, triangular(5%, 12%, 25%) discount, centred on the same point assumption as `simulation/presets.py`'s `competitor_entry` preset |
| Fare, frequency, aircraft, rating | N/A - controlled, not random | These are decisions Pacific Wings makes, held fixed per Monte Carlo run, exactly as in the deterministic `/what_if` |

## Revenue model (`simulation/revenue.py`)

| Field | Tier | Notes |
|---|---|---|
| Cabin fare multipliers (economy 1.0x, premium economy 1.6x, business 3.2x) | Illustrative | Within commonly-cited ranges for international fare structures, not fitted to Pacific-Wings-specific data |
| Ancillary revenue ($25/passenger flat) | Illustrative | Within the commonly-cited $15-30/passenger range per IATA ancillary revenue reports |

## Risk scores (`agents/open_route_analyst.py`)

| Field | Tier | Notes |
|---|---|---|
| Geopolitical / currency risk tables (per-country 0-3 scores) | Illustrative | Hand-curated qualitative judgment, not derived from a quantitative index (e.g. not a sourced country-risk score) |

## Where to look for more detail

- `docs/cost_assumptions.md` - full cost/revenue/market-share calibration
  math.
- `PLAN.md` - phase-by-phase build history and the real-data rebuild status.
- Code comments in `etl/generate_synthetic_demand.py`,
  `etl/fetch_real_aviation_stats.py`, and `simulation/monte_carlo.py` -
  each real-data anchor is cited inline, next to the number it justifies.
