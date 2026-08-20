# Airline Strategy Simulator

A network strategy simulator for **Pacific Wings**, a fictional airline based
at Sydney (SYD), built on real airport, traffic, and macroeconomic data.

Ask it what happens if you cut fares, add frequency, swap aircraft, or open a
route no airline flies today — and get an answer that responds to the lever you
pulled, bounded by the aeroplanes you actually own.

**For the full math** behind every forecast — demand, revenue, cost, market
share, Monte Carlo, macro projections, and the worldwide open-route gravity
model — see [`docs/calculations_and_models.md`](docs/calculations_and_models.md).
Current model scores are in [`docs/model_metrics.md`](docs/model_metrics.md),
which the training run regenerates so it cannot drift from the artifact.

## How a scenario is computed

Every strategy lever reaches the P&L through one named, documented mechanism:

```
    market size          pacific_wings/ml/market_model.py, from real BITRE city-pair data
      x macro growth     pacific_wings/simulation/macro_projections.py
      x fare elasticity  MARKET_FARE_ELASTICITY (-0.8)
      = addressable market for the month
      x market share     pacific_wings/simulation/market_share.py (QSI multinomial logit)
      = Pacific Wings demand
      capped at capacity x MAX_SELLABLE_LOAD_FACTOR (0.88)
      = passengers carried, remainder reported as spilled
      -> revenue, cost, profit, and a fleet feasibility check
```

The model forecasts the **whole route market**, not Pacific Wings' slice of it.
The slice is derived, so frequency, price, service rating and competitor entry
all move it. Own-price elasticity comes out near -1.3, inside the -0.8 to -1.5
range the literature reports; profit has an interior maximum in both price and
frequency, which is what makes the tool answerable.

`pacific_wings/simulation/fleet.py` then checks the schedule against tail
counts and daily block hours, so a scenario that needs eleven A321neos says so
instead of pricing them as free.

## Repository layout

```
pacific_wings/          one importable package - no sys.path manipulation
├── paths.py            every file location, defined once
├── simulation/         the deterministic model: engine, cost, revenue,
│                       market share, fleet, Monte Carlo, macro projections
├── ml/                 market-size model, its selection, and confidence
├── analysis/           screening for routes not in the network
├── agents/             the LLM narration layer, and nothing else
├── storage/            saved reports
└── api/                FastAPI: config, deps, schemas, routes/ by domain

etl/                    data pipeline (run with -m from the repo root)
data/                   reference inputs and derived observations
models/                 the fitted market model and its scoreboard
docs/                   methodology; model_metrics.md is generated
frontend/               Next.js UI
tests/                   84 regression tests
db/                     reference schema for the ETL's optional Postgres target
```

Everything importable lives under one package. The layout used to be six
top-level directories that reached each other through nineteen
`sys.path.insert` calls — which forced two lint rules off and filed an
866-line route calculator under `agents/` because that is where it was first
written.

## Data model

| Tier | What it is | Source |
|---|---|---|
| Real — structural | Airports, coordinates, distances | [OurAirports](https://ourairports.com/data/) |
| Real — macro | GDP, population, tourism arrivals | [World Bank Open Data API](https://api.worldbank.org/v2) |
| Real — reference | Aircraft seats, range, fuel burn, CASM | Curated from Airbus/Boeing public spec sheets |
| Real — fuel | Jet fuel price history | EIA (planned) |
| Real — competitors | Carriers, frequencies, Skytrax ratings, spot-checked fares per route | Flight-aggregator schedules + Skytrax (see `etl/generate_synthetic_demand.py`) |
| Real — market size | Monthly total route market (all carriers, one-way-equivalent) for SIN, HND, AKL (+ a population-scaled estimate for candidate route DAD) | BITRE international airline statistics (see `etl/fetch_real_aviation_stats.py`) |
| Synthetic — calibrated | Market size for SYD-MEL (domestic — no real source downloaded, anchored to the published ~9.2M/yr city-pair total), fares for all routes, market share | Generated from real features + noise, calibrated to published benchmarks |

This separation is intentional and documented throughout: real drivers,
real data where it's freely available, and synthetic-but-plausible
fallbacks elsewhere — evaluated against known ground truth and never
presented as more authoritative than it is.

## Setup

```bash
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in your own `GEMINI_API_KEY` (free, no
billing - get one at https://aistudio.google.com/apikey). `.env` is
git-ignored and never committed, so each user's key stays local to their own
machine - cloning this repo does not give you access to anyone else's key.

**A Gemini key is entirely optional.** Every endpoint works without one,
including `/copilot`: the simulation results (`scenario`, `demand`, `finance` —
all computed by the engine, no LLM involved) are always returned. Only the
`market`, `risk`, and `strategy` sections depend on Gemini; without a key they
return `{"available": false, ...}` with an explanatory notice instead of
narration. No agent in this codebase produces a number that reaches a
response.

## ETL pipeline

Run in order from the repo root:

```bash
python -m etl.fetch_airports              # -> data/reference/airports.csv
python -m etl.fetch_worldbank             # -> data/reference/macro_indicators.csv
python -m etl.build_airline_profile       # -> data/airline_profile.json
python -m etl.generate_synthetic_demand   # -> data/processed/{demand_observations,competitors}.csv
python -m etl.fetch_real_aviation_stats   # -> overwrites market_passengers with real BITRE figures
```

`data/aircraft_specs.json` is a static curated table (no fetch needed).

`etl.fetch_real_aviation_stats` requires two BITRE spreadsheets to already be
present in `data/raw/` (large government files, gitignored, downloaded
manually since BITRE/data.gov.au block programmatic fetches) — see the
script's module docstring for exact filenames, sources, and what's real vs.
assumption per route.

## Database (optional)

**The API never connects to Postgres.** It reads the fitted market model and
the reference files directly, which is why the container needs no database at
runtime. Postgres exists as a target for the ETL and a source the training
script tries before falling back to the CSV — so it is opt-in:

```bash
docker compose --profile etl up -d db   # schema from db/schema.sql applied on first start
python -m etl.load_db
```

Connection defaults to `postgresql+psycopg2://airline:airline@localhost:5432/airline_sim`,
overridable via `DATABASE_URL`.

## The market model

Fit and select the market model (reads `demand_observations` from Postgres or
the CSV fallback, writes to `models/` and `docs/model_metrics.md`):

```bash
python -m pacific_wings.ml.train
```

Each run scores two candidate models and two naive baselines on the same
forward-looking holdout, deploys the winner, and prints how it compares to the
best baseline. A model that cannot beat same-month-last-year is not paying for
its complexity, and the run says so.

Serve the forecast API:

```bash
uvicorn pacific_wings.api.main:app --reload
```

```bash
curl "http://127.0.0.1:8000/demand_forecast?destination=SIN&year=2025&month=7"
```

Optional query params: `origin` (default `SYD`), `avg_fare_usd` (defaults to
the route's historical average if omitted).

## Revenue and cost

`/route_economics` chains demand forecast -> revenue breakdown -> cost
breakdown -> profit for a route/month. See `docs/cost_assumptions.md` for
the full methodology (cabin fare multipliers, ancillary revenue, fuel vs.
non-fuel CASM split).

```bash
curl "http://127.0.0.1:8000/route_economics?destination=SIN&year=2025&month=7"

# What-if: fuel price +30%
curl "http://127.0.0.1:8000/route_economics?destination=SIN&year=2025&month=7&fuel_price_usd_per_gallon=2.99"
```

Optional query params: `avg_fare_usd`, `fuel_price_usd_per_gallon` (defaults
to the most recent year in `data/reference/fuel_prices.csv`).

## What-if scenarios

`/what_if` runs the full simulation engine
(`pacific_wings/simulation/engine.py`) and compares a baseline against a
scenario: market size, market share, passengers carried, spilled demand,
revenue, cost, profit, and whether the fleet can fly the result.

```bash
# 10% fare cut on SYD-SIN
curl "http://127.0.0.1:8000/what_if?destination=SIN&year=2025&month=7&price_delta_pct=-0.1"

# Add 4 more weekly flights to SYD-DAD
curl "http://127.0.0.1:8000/what_if?destination=DAD&year=2025&month=12&frequency_delta=4"

# Swap SYD-HND to an A321neo
curl "http://127.0.0.1:8000/what_if?destination=HND&year=2025&month=12&aircraft_type=A321neo"
```

Scenario params (all optional, default 0/unchanged): `price_delta_pct`,
`frequency_delta`, `fuel_price_usd_per_gallon`, `aircraft_type`,
`rating_delta`. Every one is bounded — out-of-range values return 422 rather
than a confident answer. See `docs/cost_assumptions.md` for the methodology.

Two response fields are worth knowing about. `demand.spilled_passengers` is
demand you turned away, and on a capacity-bound route it is the number that
moves when profit cannot. `fleet` says whether the schedule fits the aircraft
you own, and names the shortfall when it does not.

### Named presets

`/what_if_presets` lists three ready-made scenarios (`pacific_wings/simulation/presets.py`)
that can be passed as `preset=` instead of, or alongside, manual deltas:

```bash
curl "http://127.0.0.1:8000/what_if_presets"
curl "http://127.0.0.1:8000/what_if?destination=SIN&year=2025&month=7&preset=fuel_price_shock"
```

`fuel_price_shock` (+30% fuel), `tourism_boom` (+20% tourism arrivals),
`competitor_entry` (a new carrier enters 10% below Pacific Wings' fare).

### Monte Carlo scenario simulator

`/monte_carlo` runs the same scenario hundreds of times with fuel price, GDP
growth, competitor entry, and demand-model error each randomized from a
distribution grounded in real historical volatility (see
`docs/calculations_and_models.md` §6), returning a full outcome distribution
instead of one point estimate:

```bash
curl "http://127.0.0.1:8000/monte_carlo?destination=SIN&year=2025&month=7&n_simulations=500"
```

Returns percentiles (p10-p90) for profit, passengers, load factor, and market
share, a profit histogram, and `probability_of_loss` — the fraction of
trials where the scenario loses money.

## Future analysis & macro projections

Three endpoints project economic fundamentals and route P&L forward across a
multi-year horizon (default 2024–2032). Unlike point-in-time what-if queries,
these feed projected GDP, tourism, population, and fuel prices into each
simulation year so the total addressable market evolves over time.

### Mathematical models

| Indicator | Method |
|---|---|
| GDP | EWMA of recent non-COVID growth rates, mean-reverted toward IMF long-run rate (AUS 2.3 %, JPN 0.9 %, VNM 6 %, etc.). Blend shifts toward long-run as the horizon extends. |
| Population | OLS linear trend fitted to the last 6 historical years, extrapolated forward. |
| Tourism | Pre-COVID structural CAGR (2015–2019) compounded from the 2019 baseline. |
| Fuel price | Discrete Ornstein-Uhlenbeck model: `P[t] = P[t-1] + 0.3 × ($2.50 − P[t-1])`. |
| Market size | `0.6 × (GDP ratio ^ 1.5 elasticity) + 0.4 × tourism ratio`. The `demand_multiplier` shows how much larger the total addressable market becomes relative to the start year. |

### API

```bash
# Macro projections for Singapore 2024-2032
curl "http://127.0.0.1:8000/macro_projection?destination=SIN&from_year=2024&to_year=2032"

# Full P&L trajectory for SYD-HND with projected macro
curl "http://127.0.0.1:8000/future_analysis?destination=HND&from_year=2025&to_year=2032"

# Network-wide portfolio ranking by cumulative projected profit
curl "http://127.0.0.1:8000/network_future_analysis?from_year=2025&to_year=2032"
```

Optional scenario overrides for `/future_analysis`: `price_delta_pct`,
`frequency_delta`, `aircraft_type`, `rating_delta` — applied uniformly across
all projected years.

### Source files

```
simulation/
  macro_projections.py   GDP, population, tourism, fuel & market-size models
  future_analysis.py     Route fundamentals, multi-year P&L, network ranking
```

## Open-route exploration: any airport worldwide

Every endpoint above operates on Pacific Wings' five known routes. This
engine (`pacific_wings/analysis/open_route.py`) answers a different question — "what
if Pacific Wings flew somewhere it never has?" — using a gravity model
calibrated against real bilateral markets instead of the trained demand
model (no training data exists for an arbitrary new city pair). Full
methodology in `docs/calculations_and_models.md` §10.

```bash
# Search the worldwide airport database (autocomplete / resolve a city name)
curl "http://127.0.0.1:8000/search_airports?query=Da Nang"

# Full feasibility analysis for any IATA code or city name
curl "http://127.0.0.1:8000/analyze_route?destination=LHR&weekly_frequency=3"

# Same, plus a 5-agent Gemini narrative layer (Market/Risk/Strategy commentary)
curl "http://127.0.0.1:8000/analyze_route_agents?destination=LHR"

# Rank 2-8 candidate destinations side by side
curl "http://127.0.0.1:8000/compare_routes?destinations=LHR,DXB,JFK"
```

Returns bilateral market size, revenue/cost/profit estimates, breakeven load
factor, a 5-dimension risk score, a 0-100 composite strategic score, a
PROCEED/CAUTION/DO NOT PROCEED/NOT FEASIBLE verdict, and a generated
pros/cons list — all order-of-magnitude estimates (±30-40%), explicitly
distinct from the precision `SimulationEngine` analysis available for routes
already in the network.

```
agents/
  world_airports.py       Global airport database, haversine distance, per-country macro table
  analysis/open_route.py   Gravity model, cost/revenue/risk scoring, verdict logic
  open_route_agents.py    5-agent Gemini narrative layer for open-route analysis
```

## AI agents & copilot

`/copilot` runs a LangGraph pipeline (`pacific_wings/agents/graph.py`) of five agents:

```
simulation -> demand -> finance -> market -> risk -> strategy
```

Demand and Finance agents are pure extractions from
`SimulationEngine.compare()` (no LLM, no hallucinated numbers). Market,
Risk, and Strategy agents call Gemini (`gemini-2.5-flash`, free tier) to
narrate those numbers plus real macro/tourism data and calibrated-synthetic
competitor data - see `docs/agent_architecture.md` for the full methodology.

```bash
curl "http://127.0.0.1:8000/copilot?destination=SIN&year=2025&month=7&price_delta_pct=-0.1"
```

Same scenario params as `/what_if`. Requires `GEMINI_API_KEY` (free, no
billing - get one at https://aistudio.google.com/apikey) for the
market/risk/strategy commentary; without it, those sections return
`"available": false` with a notice while `scenario`/`demand`/`finance`
(simulation results) are returned as normal. Optionally override the model
via `GEMINI_MODEL` (defaults to `gemini-2.5-flash`).

### Conversational copilot (`/chat`)

An alternative to the fixed `/copilot` pipeline: one Gemini conversation per
turn using automatic function calling over **12 tools**
(`pacific_wings/agents/chat_agent.py`) spanning the entire stack — route lookup,
deterministic simulation, Monte Carlo, market context, multi-year demand
trend, network opportunity ranking, macro projection, long-term route
analysis/ranking, and open-route analysis/comparison for any airport
worldwide. Gemini decides which tools to call and cites their results
directly rather than following a fixed agent sequence.

```bash
curl -X POST "http://127.0.0.1:8000/chat" -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Should we launch Sydney to Da Nang?"}]}'
```

### Report library

Completed analyses (a `/copilot` run or an open-route feasibility study) can
be saved for later browsing via `POST /reports`, listed via `GET /reports`,
and retrieved in full via `GET /reports/{id}` - backed by a flat JSON file
(`data/reports.json`, `pacific_wings/storage/reports.py`), no database required.

## Frontend dashboard

A Next.js (App Router, TypeScript, Tailwind, Recharts, React-Leaflet) dashboard
in `frontend/` provides six views:

- **Dashboard** (`/`) - network-wide KPIs (revenue, profit, market share,
  passengers, load factor, margin) with month-over-month deltas, a
  Leaflet/OpenStreetMap route map, and generated strategic insight cards
  (growth leader, capacity watch, competitive alerts) driven off live
  simulation output.
- **Route Explorer** (`/routes`) - a sortable route profitability table, a
  details panel (cabin revenue breakdown, 12-month demand trend, market
  context) for the selected route, CSV export, and an **Analyze New Route**
  panel that runs the open-route gravity model on any worldwide destination
  from inside the same page.
- **Market & Demand** (`/market`) - market share leaderboard, a live
  competitor signals feed flagging contested routes, a demand-driver
  breakdown for the busiest market, and a 12-month network demand forecast
  with model-confidence readout.
- **Scenario Lab** (`/scenario-lab`) - three what-if modes: **What-if
  Analysis** (manual or preset deltas via `/what_if`), **Stress Test**
  (canned macro shocks - oil price surge, regional conflict, pandemic,
  recession - run through `/monte_carlo`), and **Long-range Projection**
  (multi-year P&L via `/future_analysis`).
- **AI Copilot** (`/copilot`) - a conversational chat UI over `/chat`'s
  12-tool agent, plus an on-demand five-agent pipeline run
  (Demand/Finance/Market/Risk/Strategy) with a full report generation flow
  that saves into the Report Library.
- **Reports Library** (`/reports`, `/reports/[id]`) - browsable grid/list of
  saved analyses with agent/date/route-type filters, and a full-detail
  preview page per report.

Run the backend and frontend in separate terminals:

```bash
uvicorn pacific_wings.api.main:app --reload
```

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Then open http://localhost:3000.

## Deployment

The whole stack (PostgreSQL, FastAPI backend, Next.js frontend) can be run with
Docker Compose - useful for a local/portfolio demo without installing Python
or Node.

```bash
cp .env.example .env   # fill in GEMINI_API_KEY (optional - see above)
docker compose up --build
```

This starts:

- `db` - PostgreSQL on `localhost:5432` (used by the ETL/training scripts; the
  API itself reads the pre-trained model and reference data baked into its
  image, so it doesn't need `db` at runtime).
- `api` - FastAPI backend on `localhost:8000`.
- `frontend` - Next.js production build on `localhost:3000`.

Open http://localhost:3000. The frontend image is built with
`NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` (overridable via the `args:`
in `docker-compose.yml`).

To refit the market model or reload the database, run the ETL and
`python -m pacific_wings.ml.train` locally, then
`docker compose up --build api` to bake the updated `models/` into the image.

## Project structure

```
pacific_wings/                   One importable package. No sys.path manipulation.
  paths.py                       Every file location, defined once
  simulation/
    engine.py                    The scenario core: market -> share -> spill -> P&L
    market_share.py              QSI multinomial logit over the real carriers
    cost.py                      CASM split into fuel and per-departure components
    revenue.py                   Cabin mix, blended fare, ancillary revenue
    fleet.py                     Block-hour feasibility against real tail counts
    monte_carlo.py               Outcome distributions from real input volatility
    macro_projections.py         GDP / tourism / fuel projected forward
    future_analysis.py           Multi-year route and network projections
    presets.py                   Named what-if scenarios
  ml/
    market_model.py              The deployed market-size model, and its rival
    train.py                     Fits both, scores them against naive baselines,
                                 deploys the winner, regenerates model_metrics.md
    confidence.py                Resampling spread + reliability + extrapolation
    features.py                  Feature engineering for the XGBoost candidate
  analysis/
    open_route.py                Screening any worldwide destination
    world_airports.py            Global airport database + per-country macro
  agents/                        LLM narration only; no agent produces a number
    llm_client.py                Gemini client, degrades to a notice without a key
    graph.py                     LangGraph wiring the five report agents
    chat_agent.py                Conversational copilot, 12 function-calling tools
    copilot.py                   Report pipeline orchestration
    {demand,finance,market,risk,strategy}_agent.py
    open_route_agents.py         Narrative layer over a screening run
    context.py                   Real macro/competitor context for the agents
  storage/reports.py             Report library persistence (flat JSON)
  api/
    main.py                      Assembles the app from its routers
    config.py                    CORS, bearer auth, rate limit, parameter bounds
    deps.py                      Shared singletons + the one forecast helper
    schemas.py                   Request/response models
    routes/                      Endpoints grouped by what they answer:
                                 forecasting, scenarios, network, screening, reports

etl/                             Data pipeline; run with -m from the repo root
data/                            Reference inputs, derived observations, saved reports
models/                          Fitted market model, metrics, bootstrap spread
docs/
  calculations_and_models.md     Full methodology - start here
  model_metrics.md               Live model scores (generated by every train run)
  data_methodology.md            Real vs. derived vs. calibrated, field by field
  cost_assumptions.md            Cost, revenue and market-share methodology
  agent_architecture.md          The LLM layer, and where the numbers come from
  project_history.md             Original roadmap, kept as history. Superseded.
db/schema.sql                    Reference schema for the ETL's optional Postgres
tests/                           84 regression tests, each naming a real defect
Dockerfile                       Backend image (API + fitted model, no database)
docker-compose.yml               api + frontend; Postgres behind the `etl` profile
frontend/
  app/
    page.tsx                     Dashboard ("/")
    routes/page.tsx              Route Explorer (+ open-route screening)
    market/page.tsx              Market & Demand
    scenario-lab/page.tsx        Scenario Lab (what-if / stress test / long-range)
    copilot/page.tsx             AI Copilot (chat + agent report pipeline)
    reports/page.tsx             Reports Library
    reports/[id]/page.tsx        Saved report detail
  components/                    Shared UI (nav, charts, map, scenario form, ...)
  lib/                           API client, types, constants
```

## Tests

```bash
pytest tests/          # 84 regression tests
ruff check .           # lint
```

Every test corresponds to a defect that shipped: profit must have an interior
maximum in both price and frequency, adding capacity to a spilling route must
carry more passengers, load factor must be physically achievable, confidence
must fall as a request moves away from the observed data, the open-route
screener and the network simulator must never disagree about whether a route
makes money, and invalid inputs must be rejected rather than answered.

The model modules also carry `__main__` self-checks that assert their
calibration constants still produce sane output (`pacific_wings/simulation/market_share.py`,
`pacific_wings/simulation/revenue.py`, `pacific_wings/simulation/fleet.py`, `pacific_wings/ml/confidence.py`,
`pacific_wings/analysis/open_route.py`). CI runs both, plus the frontend typecheck,
lint and build — see `.github/workflows/ci.yml`.

## API access control

The API runs open by default, which is right for a local demo, and `/health`
says so. For anything reachable beyond localhost set `API_TOKEN` (gates the
report-mutating and LLM-backed endpoints) and `ALLOWED_ORIGINS` (CORS). See
`.env.example`.
