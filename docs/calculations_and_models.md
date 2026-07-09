# Calculations & Models: The Full Quantitative Methodology

This is the single consolidated reference for every forecasting model,
formula, and calibration constant in the Airline Strategy Simulator — how it
forecasts **demand**, **market size**, **routes**, **revenue/cost/profit**,
and **risk**, and what specifically makes the approach more rigorous than a
typical simulation toy.

Three companion docs cover sub-slices of this in more granular detail and
are cross-linked throughout: [`data_methodology.md`](data_methodology.md)
(what's real vs. synthetic, field by field), [`cost_assumptions.md`](cost_assumptions.md)
(cost/revenue/market-share calibration), and [`agent_architecture.md`](agent_architecture.md)
(the LLM agent layer). This document is the narrative walkthrough that ties
all of it together, end to end, with the math shown.

---

## 0. Design philosophy

Pacific Wings is a fictional airline, so nothing about its historical
performance, market share, or fares is "real" in the sense of being
recorded anywhere. The project's central discipline is to **never pretend
otherwise**: every number is tagged as *real* (sourced, dated), *real-derived*
(built from real data plus one stated bridging assumption), or *illustrative*
(a calibrated modeling choice with no claim to historical accuracy) — see
`data_methodology.md` for the full field-by-field ledger. That discipline is
what lets the rest of this document show actual formulas without caveats
littering every line: the caveats live in one place, and are linked from here
instead of repeated.

The stack is built in layers, each one a prerequisite for the next:

```
real geography + macro data
        │
        ▼
demand forecasting model (XGBoost)  ──┐
        │                             │
        ▼                             │
revenue model  +  cost model          │  Phases 3-6
        │              │              │
        ▼              ▼              │
     market share model  ─────────────┘
        │
        ▼
simulation engine (ties 3-6 together, capacity-constrained)
        │
        ├──► Monte Carlo (distributional what-if)
        ├──► macro projections + future analysis (multi-year, network ranking)
        ├──► what-if presets (named scenarios)
        └──► open-route exploration (gravity model for any world airport)
        │
        ▼
AI agent layer (LangGraph 5-agent pipeline + conversational copilot)
```

---

## 1. Demand forecasting model (`ml/train_demand_model.py`, `ml/features.py`)

### 1.1 What predicts demand

An XGBoost gradient-boosted regressor (`n_estimators=150, max_depth=3,
learning_rate=0.1`) predicts **monthly passengers** for a route from 10
features (`ml/features.py:FEATURE_COLUMNS`):

| Feature | Source |
|---|---|
| `distance_km` | Real haversine distance |
| `gdp_usd`, `gdp_growth_pct`, `population` | Real, World Bank, per year |
| `tourism_arrivals_baseline` | Real, frozen 2019 snapshot |
| `competitor_count`, `competitor_avg_fare_usd` | Real-derived competitor set |
| `avg_fare_usd` | Pacific Wings' own fare (the lever a what-if controls) |
| `month_sin`, `month_cos` | Cyclical month encoding — a plain integer month would tell the tree "December (12) is far from January (1)" when they're adjacent; the sin/cos pair maps the 12-month cycle onto a circle so December and January sit next to each other in feature space |

### 1.2 Training protocol: why 2022 is excluded, why two evaluations exist

Training data is **real BITRE-derived** figures for SIN/HND/AKL/DAD and a
calibrated synthetic formula for the domestic SYD-MEL route (see
`data_methodology.md`). 2022 is dropped entirely — Australia's border reopened
mid-2022 and Japan didn't reopen to tourism until October 2022, so 2022 is a
COVID reopening ramp, not steady-state demand (HND averaged a 0.16 load factor
in 2022 vs. 0.57 in 2024). Training on it dragged deployed HND predictions to
roughly half of 2024 actuals.

Two different, complementary evaluations are reported (`models/metrics.json`),
because each answers a different question:

- **Time-based holdout** (train 2023, test 2024) — "can the model forecast a
  year it has never seen?" This is the honest test of forecast skill:
  **R² = 0.952, MAPE = 15.3%** against real-world noise (before the real-data
  rebuild, this metric was R² = 0.984 against a known synthetic formula — the
  drop is real and expected, not a regression).
- **5-fold cross-validation** (shuffled, ignores time order) — "how stable is
  performance across different random splits of the same data?" R² is stable
  (0.966 ± 0.014) but MAPE is not (42% ± 26%), because DAD's tiny passenger
  counts (as low as 15/month) blow up percentage error whenever a fold
  under-represents that route. Reported honestly rather than hidden.

The **deployed** model is then refit on all rows including the 2024 holdout —
the holdout exists to grade the protocol, not to be a data point the shipped
model is blind to.

### 1.3 Prediction intervals: residual bootstrap, not a model-based interval

`/demand_forecast`'s `predicted_passengers_low/high` band is the point
forecast plus the historical holdout's 10th/90th percentile error, clamped to
`[0, capacity]`. This is **not** quantile regression or any model-native
uncertainty — it's the empirically observed error distribution from the one
real holdout year, applied as a fixed offset. Cheap, transparent, and honest
about being an approximation.

### 1.4 Confidence score: three independent uncertainty signals (`ml/confidence.py`)

Every forecast reports a single `confidence_pct` (5-95 range), built by
combining three genuinely different, independently-computed signals into one
number — this is one of the more deliberately-engineered pieces of the
project, built specifically to replace fabricated "Confidence %" badges that
existed earlier and had no real basis.

**Signal 1 — Bootstrap ensemble disagreement (epistemic uncertainty).**
Training also fits `N_BOOTSTRAP=30` extra XGBoost models, each on a
resample-with-replacement of the same training rows
(`train_bootstrap_ensemble`). At inference, all 30 models score the same
input; the **coefficient of variation** of their 30 predictions measures how
sensitive the answer is to exactly which rows the model happened to train on:

```
coefficient_of_variation = std(bootstrap_predictions) / point_prediction
bootstrap_deduction = min(35, coefficient_of_variation * 120)
```

**Signal 2 — Per-route historical reliability (aleatoric uncertainty).**
The real holdout residual spread, computed **per route** rather than pooled
(some routes, like DAD with its tiny passenger counts, are just noisier to
forecast than others — this is a fact about the route, not the model):

```
relative_spread = |p90_residual - p10_residual| / predicted_passengers
reliability_deduction = min(40, relative_spread * 60)
```

**Signal 3 — Extrapolation distance.** How far this request sits outside
what the model actually saw in training: years beyond the 2023-2024 training
window, and how far any input feature (typically an extreme what-if fare
override) sits outside its training range:

```
temporal_score = min(1, years_outside_window / 5)
feature_score   = max over features of min(1, distance_outside_range / feature_span)
extrapolation_deduction = min(25, (0.5*temporal_score + 0.5*feature_score) * 25)
```

**Combination:**

```
confidence_pct = clamp(100 - bootstrap_deduction - reliability_deduction
                            - extrapolation_deduction,  5, 95)
```

The three deduction caps (35/40/25) and scaling constants are **illustrative
combination weights** — there is no labeled "was this forecast right" dataset
to fit them against, since Pacific Wings has no real track record. What's
real is every *input* to the formula: actual bootstrap spread, actual
historical residuals, actual training-data ranges. `confidence_notes` surfaces
the specific reason for any deduction in plain language, e.g. *"Forecast year
2026 is 3 year(s) outside the model's 2022-2023 training window."*

---

## 2. Revenue model (`simulation/revenue.py`)

The forecast's `avg_fare_usd` is on an **economy-fare scale**. Cabin
revenue scales *up* from it using the aircraft's real seat mix, calibrated
fare multipliers, and cabin-specific fill weights:

```
fare multiplier:  economy 1.0x · premium economy 1.6x · business 3.2x
fill weight:      economy 1.0  · premium economy 0.85 · business 0.7   (premium sells less full)

fill[cabin]        = seat_share[cabin] * fill_weight[cabin]
cabin_passengers    = total_passengers * fill[cabin] / sum(fill)
cabin_revenue        = cabin_passengers * (avg_fare_usd * multiplier[cabin])
ticket_revenue       = sum(cabin_revenue)
blended_avg_fare_usd = ticket_revenue / total_passengers        (reported, ~1.18-1.46x economy)
```

Ancillary revenue (bags, seat selection, onboard sales) scales with distance:

```
ancillary_per_pax = 15 + 0.002 * min(distance_km, 10000)      # ~$16 domestic → $35 long-haul
total_revenue     = ticket_revenue + (total_passengers * ancillary_per_pax)
```

Both multiplier sets sit within commonly-cited industry ranges (business
3-4x economy; ancillary $15-35/pax for full-service international carriers)
but are not fitted to Pacific-Wings-specific data — see `cost_assumptions.md`.

---

## 3. Cost model (`simulation/cost.py`)

### 3.1 A real anchor, split so fuel becomes a lever

Each aircraft's published CASM (cost per available-seat-km) is anchored to
**Qantas Group's FY25 disclosed ex-fuel unit cost** (6.22 AUD cents/ASK) — the
only clean public CASK figure found for any carrier relevant to this network.
Converted to USD (~$0.0404/ASK) and scaled onto the three Pacific Wings
aircraft types by a single factor that preserves their relative shape while
landing the network average exactly on that real anchor.

To make fuel price a controllable what-if variable, CASM is split at a
**baseline fuel price of $1.74/gallon (2019 EIA annual average)**:

```
fuel_price_usd_per_kg = usd_per_gallon / 3.03                      # KG_PER_GALLON
fuel_cost_per_hour    = cruise_fuel_burn_kg_per_hour * fuel_price_usd_per_kg
ask_per_hour          = seats_total * cruise_speed_kmh
baseline_fuel_casm    = fuel_cost_per_hour / ask_per_hour
non_fuel_casm         = casm_usd - baseline_fuel_casm               # held constant
```

For any scenario, `fuel_casm` is recomputed at the scenario's own fuel price
(from real per-aircraft fuel-burn figures — not re-derived from Qantas's
unknown fuel cost), so the fuel share of cost responds correctly to any
"what if fuel is $X/gallon" query. At baseline, fuel is ~18% of CASM for the
narrowbody types, ~31% for the B787-9 — in line with published 15-30%
industry ranges.

### 3.2 Departures vs. distance: a real fixed/variable cost split

Landing fees, per-passenger airport charges, and ground handling scale with
**departures**, not distance flown — a fixed per-departure charge
(A320-200 $3,500 / A321neo $5,000 / B787-9 $12,000, real-world magnitude
estimates) is carved **out of** the non-fuel CASM rate (not added on top), at
a rebate rate calibrated so the network-wide non-fuel total is unchanged:

```
ASK_month        = seats_total * distance_km * weekly_frequency * 4.345
departures_month = weekly_frequency * 4.345
non_fuel_cost    = non_fuel_ask_casm * ASK_month + per_departure_usd * departures_month
total_cost       = fuel_casm * ASK_month + non_fuel_cost
```

The practical payoff: short sectors now correctly cost more per seat-km than
long ones, and an aircraft swap in a what-if carries its real fixed-cost
difference — without this, the model would treat cost as a pure function of
ASK and miss why frequency changes on short routes hit unit economics harder
than the same change on long ones.

---

## 4. Market share model (`simulation/market_share.py`)

A multinomial logit ("attraction"/QSI-style) model over Pacific Wings and its
real competitor set:

```
utility_i = BETA_LN_PRICE * ln(price_i) + BETA_FREQUENCY * log1p(weekly_frequency_i) + BETA_RATING * rating_i
share_i   = exp(utility_i) / Σ_j exp(utility_j)

BETA_LN_PRICE = -0.7,  BETA_FREQUENCY = 0.4,  BETA_RATING = 1.8
```

**Why log terms, specifically:** fares in this dataset span $25-720 and
weekly frequencies span 3-259 (two orders of magnitude — SYD-DAD has zero
existing competitors, SYD-MEL has Qantas alone flying ~259/week). A linear
price or frequency term would make a $100 fare gap mean the same thing on a
$113 domestic fare as on a $700 long-haul fare, and would let the densest
domestic trunk route swamp every other route's frequency signal. Log terms
give a constant *percentage*-difference response everywhere — the standard
log-log form used in real airline QSI modeling.

**Calibration, not fitting:** no public route-level market-share dataset
exists to fit against, so the three betas are chosen so each factor has a
visible-but-not-dominant effect, then **cross-checked** against the one real
benchmark available — BITRE country-level AU-Singapore traffic share. This
calibration puts Singapore Airlines at ~61-62% modeled share on SYD-SIN vs.
its real ~60% reported share: one data point, used as a plausibility check,
not a calibration target. A `__main__` self-check in `market_share.py`
re-asserts this on every run so a recalibration can't silently drift away
from it.

---

## 5. Simulation engine (`simulation/engine.py`) — the deterministic core

`SimulationEngine.run_scenario(...)` is a pure function that ties sections
1-4 together for one route/month:

1. Apply scenario deltas (fare, frequency, fuel price, aircraft, rating).
2. Forecast **demand** from market features + the scenario fare — Pacific
   Wings' own capacity choice does not change market demand.
3. Compute **capacity** from the scenario frequency/aircraft, and cap:
   `passengers_carried = min(predicted_demand, capacity)` — capacity only
   binds when frequency is cut or an aircraft swap shrinks capacity below
   what demand alone would fill.
4. Compute **revenue**, **cost**, **profit** from `passengers_carried`.
5. Compute **market share** from the scenario fare/frequency/rating.

`SimulationEngine.compare(...)` runs a no-deltas baseline alongside the
scenario and returns the deltas — this is what powers `/what_if`,
`/copilot`, and every chat-agent tool that needs a baseline-vs-scenario
comparison.

### 5.1 The extrapolation problem, and how it's solved

Gradient-boosted trees split the training feature space into a finite set of
leaves and **cannot extrapolate** beyond the ranges they were trained on:
feed a tree model macro features for 2030 and it lands in the same leaf as
2024, producing a flat forecast regardless of how much bigger the real
economy has become. This was actually observed — deployed future-year
forecasts were flat until this was diagnosed and fixed.

The fix: `market_growth_multiplier()` computes an explicit growth factor from
`macro_projections.py` (Section 7) for any year beyond the model's training
window, and applies it as a **multiplier on the raw tree prediction** rather
than feeding grown macro values into the tree itself:

```
predicted_passengers = tree_prediction(features) * market_growth_multiplier(destination, year) * demand_noise_multiplier
```

This is the central design decision that lets Section 8's multi-year
projections and network ranking mean anything at all beyond 2024 — a purely
tree-based forecast would otherwise be structurally incapable of showing
growth.

---

## 6. Monte Carlo scenario simulator (`simulation/monte_carlo.py`)

The deterministic engine answers "what happens under these specific
assumptions." Monte Carlo answers "what's the plausible **range** of
outcomes, given real uncertainty in four inputs nobody at Pacific Wings
controls" — sampling each from a distribution and running many
`SimulationEngine` passes (100-1000, default 500).

| Input | Distribution | Parameters, and why |
|---|---|---|
| Fuel price | Lognormal | `sigma = 0.67`, the **real** log-return volatility of `fuel_prices.csv`'s 2019-2024 series — a period spanning the COVID collapse ($0.81/gal) and the 2022 spike ($3.48/gal), so the resulting bands are wide because fuel genuinely was that volatile, not because the model invents drama. Clamped to [$0.40, $6.00]/gal as a physical sanity backstop. |
| GDP growth | Normal | `std` = the destination country's **real** 2010-2024 GDP growth standard deviation (e.g. ~1.0pp Australia vs. ~4.0pp Singapore, a small trade-exposed economy that really has been more volatile). |
| Competitor entry | Bernoulli(25%) × triangular(5%, 12%, 25%) discount | **Illustrative** — no public source for new-entrant timing probabilities exists; centred on the same point assumption as the `competitor_entry` what-if preset, but expressed as a probability instead of an on/off toggle. |
| Demand-model error | Normal multiplier on the point forecast | `std` derived from the model's **own real holdout residual spread**, per route where available (`models/metrics.json`) — routes the model historically forecast poorly (e.g. DAD) get wider profit bands, not an arbitrary flat noise term. |

Fare, frequency, aircraft, and rating are **not** randomized — they're
decisions Pacific Wings makes, held fixed per trial, exactly as the
deterministic `/what_if` treats them as levers rather than external
uncertainty.

Output: full percentile summaries (p10-p90) for profit/passengers/load
factor/market share, a profit histogram, and — the single most
decision-relevant number — `probability_of_loss`, the fraction of trials
where the scenario loses money.

---

## 7. Macro projection models (`simulation/macro_projections.py`) — forecasting the market itself

Four independent models project GDP, population, tourism, and fuel price
forward from real historical data, each using a different technique matched
to how that indicator actually behaves:

### 7.1 GDP — EWMA trend blended with long-run mean reversion

```
ewma_rate = exponential-weighted mean of the last 6 non-COVID years' growth rates (span=4)
alpha     = e^(-0.12 * horizon_years)                      # decays toward 0 as horizon grows
projected_growth = alpha * ewma_rate + (1 - alpha) * long_run_rate
gdp[t] = gdp[t-1] * (1 + projected_growth / 100)
```

`long_run_rate` is the destination country's IMF WEO potential-growth
estimate (Australia 2.3%, Japan 0.9%, New Zealand 2.2%, Singapore 2.6%,
Vietnam 6.0%). **Why blend instead of a flat extrapolation:** recent
momentum should dominate the near-term forecast, but nothing grows at a
short-term rate forever — the alpha decay means a 1-year-out forecast is
almost entirely EWMA-driven, while an 8-year-out forecast has mostly reverted
to the IMF long-run rate. 2020-2021 are excluded from the EWMA input
entirely (COVID years, not structural).

### 7.2 Population — OLS linear trend

```
(slope, intercept) = ordinary least squares fit on the last 6 historical years
population[year] = slope * year + intercept
```

Population moves slowly and close to linearly over any 5-10 year horizon —
a straight OLS fit on real World Bank data needs nothing fancier.

### 7.3 Tourism — pre-COVID structural CAGR, compounded from the 2019 baseline

```
structural_cagr = (tourism_2019 / tourism_2015)^(1/4) - 1,  clamped to [1%, 15%]
tourism[year]   = tourism_2019 * (1 + structural_cagr)^(year - 2019)
```

Post-2020 tourism data is largely missing/incomplete across all 5 countries
(see `data_methodology.md`), so 2019 — the last complete pre-pandemic year —
is used as the compounding anchor, with growth rate estimated from the
pre-COVID 2015-2019 structural trend rather than any post-pandemic
recovery-year noise.

### 7.4 Fuel price — discrete Ornstein-Uhlenbeck mean reversion

```
P[t] = P[t-1] + 0.30 * ($2.50 - P[t-1])
```

A **stochastic mean-reversion process**, used here in its deterministic
(expected-value) form: fuel prices don't trend indefinitely in either
direction, they oscillate around a long-run equilibrium ($2.50/gallon,
between the 2019 pre-pandemic $1.74 and the 2022 spike $3.48). The 0.30
reversion speed means roughly 30% of any gap to equilibrium closes each year
— a real modeling technique borrowed from commodity/interest-rate finance,
applied here to jet fuel because fuel genuinely behaves this way over
multi-year horizons (spikes and crashes, but doesn't escape a band).

### 7.5 Composite market-size index

```
gdp_ratio    = gdp[year] / gdp[from_year]
tourism_ratio = tourism[year] / tourism[from_year]
demand_multiplier = 0.6 * (gdp_ratio ^ 1.5) + 0.4 * tourism_ratio
```

The **1.5 exponent** is IATA's published income elasticity of aviation
demand for long-haul/developing markets (air travel grows faster than GDP —
a 10% richer economy flies noticeably more than 10% more) — this is a real,
sourced elasticity, not a free parameter. The 0.6/0.4 GDP/tourism weighting
is illustrative. Sanity check: IATA reported Asia-Pacific international
traffic +10.9% in 2025 (the fastest of any region) and projects >12B global
passengers by 2030 led by Asia-Pacific; the ~3-11%/yr per-market multipliers
this formula produces sit inside that reported band.

`demand_multiplier` is exactly the growth factor Section 5.1 applies to
bridge the tree model's extrapolation gap — this is the one place the
"forecast the market" and "forecast demand for one route" halves of the
project connect.

---

## 8. Future analysis: multi-year P&L and network portfolio ranking (`simulation/future_analysis.py`)

Three escalating levels of analysis, all built on Sections 5-7:

1. **`project_route_fundamentals`** — raw macro projections (Section 7) for
   one route, no simulation run.
2. **`multi_year_route_projection`** — runs all 12 months of every year in
   the horizon through `SimulationEngine.run_scenario`, feeding that year's
   *projected* fuel price into cost and the market-growth multiplier into
   demand, then aggregates to annual passengers/revenue/profit, average load
   factor, peak month, and year-over-year growth. Also reports
   `passenger_cagr_pct` across the full horizon.
3. **`network_future_analysis`** — runs level 2 for **every** Pacific Wings
   route (active and candidate) and ranks the whole network by cumulative
   projected profit — the tool that answers "where should Pacific Wings
   invest next?" across the full route portfolio, not one route at a time.

This is where the "static macro snapshot" limitation of a typical toy
simulator is deliberately avoided: profit five years out reflects a genuinely
different, larger addressable market (via Section 7's multipliers), not last
year's numbers with a `* 1.05` bolted on.

---

## 9. What-if presets (`simulation/presets.py`)

Three named scenarios as thin, self-documenting wrappers over
`run_scenario`/`compare` kwargs, each derived from the route's own reference
data so a preset means something appropriate for whichever destination it's
applied to (not a single hardcoded number reused everywhere):

| Preset | Mechanism |
|---|---|
| `fuel_price_shock` | Reference fuel price × 1.3 |
| `tourism_boom` | Tourism-arrivals feature × 1.2 (affects the demand model directly) |
| `competitor_entry` | Injects a new competitor priced 10% below Pacific Wings, at the route's own base frequency, into both the demand model's competitor features and the market-share model |

---

## 10. Open-route exploration: a gravity model for any airport on Earth (`agents/open_route_analyst.py`)

Sections 1-9 all operate on Pacific Wings' five known routes, where a trained
demand model and real competitor data exist. This module answers a
structurally different question — **"should Pacific Wings fly somewhere it
has never flown, to a city with no route-level data at all?"** — using a
first-principles gravity model instead of a trained regressor, because no
training data exists for an arbitrary new city pair.

### 10.1 Bilateral market size: a calibrated gravity model

```
market_pax_annual = min(
    REF_MARKET * gdp_ratio * dist_ratio * tour_ratio,     # gravity estimate
    (0.30 * population_millions + 0.15 * tourism_millions) * 1,000,000   # destination-size cap
)

gdp_ratio  = (ln(max(gdp_dest_B, 10)) / ln(REF_GDP_B))^0.5
dist_ratio = (REF_DIST_KM / distance_km)^1.30
tour_ratio = sqrt(tourism_factor(dest) / tourism_factor(REF_TOURISM))
```

Calibrated against the **real** SYD-SIN bilateral market (3.5M passengers/yr,
BITRE), using log-damped GDP (prevents wildly over-predicting for
enormous economies like the US or China) and a square-root tourism factor. A
separate flat-density formula handles short-haul/domestic markets (<2,500km),
since domestic and trans-Tasman city pairs are denser than the distance-decay
gravity term alone would predict.

**The destination-size cap is the important addition:** without it, the raw
gravity formula's distance term alone assigned metro-scale demand to small
island destinations purely because they happened to be a convenient
distance away. The cap — grounded in the destination's own real population
and tourism volume — was calibrated against three known real markets
(SYD-MEL ~9M/yr against Australia's 27M population; SYD-AKL ~1.6M/yr against
NZ's 5.3M population + 3.9M tourists; SYD-NAN ~0.4-0.5M/yr against Fiji's
0.9M population + 0.9M tourists) so a market estimate can never exceed what
the destination itself could plausibly generate.

### 10.2 New-entrant market share

```
share = min(0.20 / max(1, n_existing_carriers) + min(weekly_frequency/14, 1) * 0.08,  0.40)
```

A new entrant typically captures a smaller share against more incumbents, and
more share at higher frequency (up to a diminishing-returns cap) — a standard
new-entrant heuristic, not fitted to any real launch data (none exists at
this granularity).

### 10.3 Fare estimation, cost, and breakeven

Fares use the **same flat-fee + per-km formula** that `etl/generate_synthetic_demand.py`
used to derive Pacific Wings' own competitor fare multipliers — so it is
real-anchored by construction against the spot-checked economy fares on the
five known routes, not an independent guess:

```
fare(distance_km) = 60 + distance_km * 0.075                          if distance_km ≤ 2000
                  = 60 + 2000*0.075 + (distance_km - 2000) * 0.045     otherwise
```

Cost and revenue reuse the exact same `CostModel`/`ancillary_per_pax_usd`
logic as Sections 2-3 (imported, not reimplemented), so a hypothetical London
or Dubai route is costed on the identical calibrated-CASM basis as the five
real routes. Breakeven load factor:

```
breakeven_pax_monthly = total_cost_monthly / (avg_fare + ancillary_per_pax)
breakeven_lf = breakeven_pax_monthly / monthly_capacity_seats
```

### 10.4 Risk scoring and composite strategic score

Five 0-3 risk dimensions combine into one overall score:

```
overall_risk = 0.25*geopolitical + 0.20*currency + 0.25*demand + 0.15*competition + 0.15*financial
```

`geopolitical` and `currency` are hand-curated per-country 0-3 tables
(illustrative qualitative judgment, not a sourced index — see
`data_methodology.md`); `demand` risk scales with route length and market
size; `competition` risk scales with the number of existing carriers;
`financial` risk scales with breakeven load factor and margin.

Three 0-100 sub-scores blend into one composite (weights 0.35/0.40/0.25):

```
demand_score    = 20*log10(market_pax/500K + 1) + 30*min(load_factor/0.82, 1)
financial_score = 50*min(max(margin+0.1,0)/0.2, 1) + 50*(1 - max(breakeven_lf-0.5,0)/0.4)
strategic_score = 30*(tourism_factor/1.4) + 20*(1 - min(overall_risk/2,1)) + 20*min(gdp_B/1000,1) + 30*(1 if profitable else 0)
composite_score = 0.35*demand_score + 0.40*financial_score + 0.25*strategic_score
```

...which maps to a verdict: `NOT FEASIBLE` (exceeds aircraft range),
`PROCEED` (score ≥65 and profitable), `PROCEED WITH CAUTION` (score ≥45 or
profitable), else `DO NOT PROCEED`. A generated pros/cons list explains
*why* in plain language, driven off the same underlying numbers.

This whole module is explicitly scoped as **order-of-magnitude strategic
screening** (±30-40% confidence bands are attached throughout), distinct
from the precision `SimulationEngine` analysis available once a route is
actually part of the network.

---

## 11. The AI agent layer: numbers vs. narration

Full detail in `agent_architecture.md`; summarized here because it's the
layer that makes the rest of this document *usable* by a non-technical
stakeholder.

**The one rule that governs everything:** any quantitative claim in an LLM
response must trace back to a deterministic function call from Sections 1-10
above. The LLM is only ever allowed to *narrate* numbers, never invent or
recompute them.

- **`/copilot`** runs a fixed 5-agent LangGraph pipeline: `simulation → demand
  → finance → market → risk → strategy`. Demand and Finance are pure
  extractions from `SimulationEngine.compare()` output — no LLM call, so
  they're bit-for-bit reproducible. Market, Risk, and Strategy each make a
  separate Gemini call, grounded in the same simulation output plus real
  macro/tourism/competitor context (`agents/context.py`) — three genuinely
  independent AI perspectives, not one voice split three ways.
- **`/chat`** (`agents/chat_agent.py`) is a different interaction model: one
  Gemini conversation using **automatic function calling** over **12 tools**
  spanning the entire stack above — route lookup, deterministic simulation,
  Monte Carlo, market context, multi-year demand trend, network opportunity
  ranking, macro projection, long-term route analysis, network long-term
  ranking, and — critically — `analyze_new_route`/`compare_new_routes`,
  which extend the conversational agent to **any airport on Earth**, not just
  Pacific Wings' five existing routes. The model decides for itself which
  tools to call, with what arguments, and how many times, before writing one
  unified answer; the system prompt enforces that any number cited must come
  from a tool result.
- Every LLM-dependent section degrades gracefully to
  `{"available": false, ...}` if no `GEMINI_API_KEY` is set or the call
  fails — the deterministic sections (`scenario`, `demand`, `finance`) are
  never affected, by construction, since they don't depend on the LLM client
  at all.

---

## What makes this project's approach distinctive

Pulling the threads above together, the things that go meaningfully beyond a
typical "toy" airline simulator:

1. **An honest three-tier data provenance system** (real / real-derived /
   illustrative) applied to *every* number in the project, not just headline
   figures — documented per-field in `data_methodology.md` and referenced
   throughout this document instead of asserted once and forgotten.
2. **Explicitly solving the tree-model extrapolation problem** (Section 5.1)
   by separating "forecast demand under known conditions" (XGBoost, which is
   good at this) from "project how the addressable market grows" (explicit
   macro models, Section 7) — rather than either refusing to forecast future
   years or silently producing flat, wrong long-horizon forecasts.
3. **A three-signal confidence score** (Section 1.4) that combines epistemic
   uncertainty (bootstrap ensemble disagreement), aleatoric uncertainty
   (real per-route historical error), and extrapolation distance into one
   number — replacing what was originally a fabricated badge with something
   built entirely from real, inspectable inputs.
4. **Monte Carlo uncertainty sourced from real historical volatility**
   (Section 6) rather than arbitrarily chosen noise bands — fuel and GDP
   growth distributions are parameterized directly from the actual historical
   series in `data/reference/`.
5. **A cost model that preserves a real calibration anchor while adding
   granularity** (Section 3.2) — the per-departure/per-ASK split changes
   *how* cost responds to frequency and stage length without moving the
   network-wide total away from the one real Qantas-anchored figure available.
6. **A gravity model calibrated against real bilateral markets and capped by
   real destination-size data** (Section 10.1), extending route analysis to
   *any* airport worldwide with no training data required — with explicit,
   wide confidence bands rather than false precision.
7. **Strict numbers/narration separation in the AI layer** (Section 11),
   enforced architecturally (deterministic agents literally cannot call an
   LLM) rather than only by prompt instruction — and a genuinely agentic
   conversational layer (12 tools, model-directed tool selection) sitting
   alongside, not replacing, the fixed deterministic pipeline.
