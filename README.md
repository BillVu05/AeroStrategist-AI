# Airline Strategy Simulator

A simulation and analytics platform for **Pacific Wings**, a fictional airline
based at Sydney (SYD), grounded in real airport, geographic, and macroeconomic
data. See [PLAN.md](PLAN.md) for the full project roadmap.

## Data model

| Tier | What it is | Source |
|---|---|---|
| Real — structural | Airports, coordinates, distances | [OurAirports](https://ourairports.com/data/) |
| Real — macro | GDP, population, tourism arrivals | [World Bank Open Data API](https://api.worldbank.org/v2) |
| Real — reference | Aircraft seats, range, fuel burn, CASM | Curated from Airbus/Boeing public spec sheets |
| Real — fuel | Jet fuel price history | EIA (planned) |
| Real — competitors | Carriers, frequencies, Skytrax ratings, spot-checked fares per route | Flight-aggregator schedules + Skytrax (see `etl/generate_synthetic_demand.py`) |
| Real-derived — demand | Monthly passengers/load factor for SIN, HND, AKL (+ a population-scaled estimate for candidate route DAD) | BITRE international airline statistics (see `etl/fetch_real_aviation_stats.py`) |
| Synthetic — calibrated | Demand/load factor for SYD-MEL (domestic — no real source downloaded), fares for all routes, market share | Generated from real features + noise, calibrated to published benchmarks |

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
including `/copilot`: the simulation results (`scenario`, `demand`, `finance`
- all real numbers from the Phase 3-7 model/engine, no LLM involved) are
always returned. Only the `market`, `risk`, and `strategy` sections of
`/copilot` depend on Gemini; without a key they return
`{"available": false, ...}` with an explanatory notice instead of narration.

## ETL pipeline

Run in order from the `etl/` directory:

```bash
python fetch_airports.py          # -> data/reference/airports.csv
python fetch_worldbank.py         # -> data/reference/macro_indicators.csv
python build_airline_profile.py   # -> data/airline_profile.json
python generate_synthetic_demand.py  # -> data/processed/{demand_observations,competitors}.csv
python fetch_real_aviation_stats.py  # -> overwrites demand_observations.csv with real BITRE figures
```

`data/aircraft_specs.json` is a static curated table (no fetch needed).

`fetch_real_aviation_stats.py` requires two BITRE spreadsheets to already be
present in `data/raw/` (large government files, gitignored, downloaded
manually since BITRE/data.gov.au block programmatic fetches) — see the
script's module docstring for exact filenames, sources, and what's real vs.
assumption per route.

## Database

Start PostgreSQL (schema from `db/schema.sql` is applied automatically on
first start):

```bash
docker compose up -d
```

Then load all reference/profile/processed data:

```bash
python etl/load_db.py
```

Connection defaults to `postgresql+psycopg2://airline:airline@localhost:5432/airline_sim`,
overridable via the `DATABASE_URL` env var.

## Demand forecasting (Phase 3)

Train the model (reads `demand_observations` from Postgres, writes to `models/`):

```bash
python ml/train_demand_model.py
```

Serve the forecast API:

```bash
uvicorn api.main:app --reload
```

```bash
curl "http://127.0.0.1:8000/demand_forecast?destination=SIN&year=2025&month=7"
```

Optional query params: `origin` (default `SYD`), `avg_fare_usd` (defaults to
the route's historical average if omitted).

## Revenue & cost model (Phases 4-5)

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

## Simulation engine & what-if scenarios (Phases 6-7)

`/what_if` runs the full simulation engine (`simulation/engine.py`):
demand -> capacity-constrained passengers carried -> revenue -> cost ->
profit -> market share (Phase 6, `simulation/market_share.py`), comparing a
baseline against a scenario with the given deltas.

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
`rating_delta`. See `docs/cost_assumptions.md` for the market share and
simulation engine methodology.

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

## AI agents & copilot (Phases 8-9)

`/copilot` runs a LangGraph pipeline (`agents/graph.py`) of five agents:

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

## Frontend dashboard (Phase 11)

A Next.js (App Router, TypeScript, Tailwind, Recharts, React-Leaflet) dashboard
in `frontend/` provides nine views:

- **Executive Dashboard** (`/`) - current-month profit, load factor, and
  market share for each active route, plus a profit-by-route chart.
- **Route Explorer** (`/routes`) - a Leaflet/OpenStreetMap map of SYD and its
  routes (including the SYD-DAD candidate route), with a details panel
  showing distance, frequency, fleet, and market stats for the selected route.
- **Market Intelligence** (`/market`) - route opportunity ranking, competitor
  positioning, GDP/tourism correlation, and market share leaderboard.
- **Demand Forecasting** (`/demand`) - 12-month passenger and load-factor
  series, YoY growth, demand-driver breakdown, and competitor intelligence.
- **Revenue Intelligence** (`/revenue`) - cabin revenue composition, pricing
  simulator, revenue leaderboard, and sparkline trend charts.
- **AI Agents** (`/copilot`) - conversational AI executive team with nine
  function-calling tools (simulation, forecasting, future analysis, macro
  projection, network ranking).
- **Future Analysis** (`/future`) - multi-year GDP, population, tourism, and
  fuel price projections; annual P&L trajectory with macro-adjusted demand;
  market size multiplier chart; monthly profile for the end year; network
  portfolio ranking by cumulative projected profit. Route and year-range
  selectable interactively.
- **Risk Intelligence** (`/risk`) - network risk score, stress-test simulator,
  route-level fuel/competitive/economic/capacity risk coefficients.
- **Reports** (`/reports`) - full five-agent pipeline output with strategy
  recommendation, demand/finance agent numbers, and market/risk commentary.

Run the backend and frontend in separate terminals:

```bash
uvicorn api.main:app --reload
```

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Then open http://localhost:3000.

## Deployment (Phase 12)

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

To retrain the demand model or reload the database from inside Docker, run
the ETL scripts and `ml/train_demand_model.py` locally against `db` as
described above, then `docker compose up --build api` to bake the updated
`models/` into the API image.

## Project structure

```
data/
  aircraft_specs.json       Real fleet specs (A320-200, A321neo, B787-9)
  airline_profile.json      Generated: Pacific Wings routes + fleet + market data
  reference/
    airports.csv            Real airport coordinates/distances
    macro_indicators.csv    Real GDP/population/tourism per country/year
  processed/
    demand_observations.csv Monthly demand (Phase 3 training target) - real BITRE-derived
                             for SIN/HND/AKL/DAD, synthetic formula for domestic SYD-MEL
    competitors.csv          Real carriers/frequencies/ratings/fares per route
  raw/
    bitre_*.xlsx              Manually-downloaded BITRE source spreadsheets (gitignored)
models/
  demand_model.json          Trained XGBoost demand model
  feature_columns.json        Feature column order
  metrics.json                Holdout evaluation metrics
ml/
  features.py                 Shared feature engineering (train + API)
  train_demand_model.py       Phase 3 model training
simulation/
  revenue.py                   Phase 4 revenue model
  cost.py                       Phase 5 cost model
  market_share.py              Phase 6 market share model
  engine.py                     Phase 7 simulation engine
  macro_projections.py         GDP/population/tourism/fuel projection models
  future_analysis.py           Multi-year route P&L and network portfolio analysis
agents/
  llm_client.py                Claude client wrapper (graceful degradation, no API key)
  context.py                   Real macro/tourism + competitor context for Market/Risk agents
  demand_agent.py              Demand agent (pure extraction, no LLM)
  finance_agent.py             Finance agent (pure extraction, no LLM)
  market_agent.py              Market agent (Claude narration)
  risk_agent.py                Risk agent (Claude narration)
  strategy_agent.py            Strategy agent / executive summary (Claude narration)
  graph.py                     Phase 8 LangGraph StateGraph wiring all five agents
  copilot.py                   Phase 9 copilot orchestration
api/
  main.py                      FastAPI app (/demand_forecast, /route_economics, /what_if, /copilot)
db/
  schema.sql                 PostgreSQL schema
etl/
  fetch_airports.py
  fetch_worldbank.py
  build_airline_profile.py
docs/
  cost_assumptions.md          Phases 4-6 cost/revenue/market-share methodology
  agent_architecture.md        Phases 8-9 agent/copilot methodology
Dockerfile                   Phase 12: backend image (FastAPI + pre-trained model)
docker-compose.yml            Phase 12: db + api + frontend services
frontend/
  Dockerfile                  Phase 12: frontend image (Next.js standalone build)
  app/
    page.tsx                    Executive Dashboard ("/")
    routes/page.tsx             Route Explorer
    market/page.tsx             Market Intelligence
    demand/page.tsx             Demand Forecasting
    revenue/page.tsx            Revenue Intelligence
    future/page.tsx             Future Analysis & Macro Projections
    copilot/page.tsx            AI Agents (conversational + tool-calling)
    risk/page.tsx               Risk Intelligence
    reports/page.tsx            Executive Reports
  components/                   Shared UI (nav, charts, map, scenario form, ...)
  lib/                          API client, types, constants
```
