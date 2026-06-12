# Airline Strategy Simulator — Revised Plan (Real-Data Grounded)

## Core change from the original spec

The original spec treats every dataset as if it's freely available at airline-route
granularity (passenger counts, competitor fares, market share). In reality, almost none
of that exists publicly at the route level. The fix is **not** to fake everything, and
**not** to chase data that doesn't exist — it's to be explicit about a three-tier data
model:

| Tier | What it is | Source | Used for |
|---|---|---|---|
| **Real — structural** | Airports, coordinates, distances, country codes | [OurAirports](https://ourairports.com/data/) (free CSV, no key) | Route definitions, flight duration estimates |
| **Real — macro** | GDP, population, tourism arrivals, GDP growth | [World Bank Open Data API](https://api.worldbank.org/v2) (free, no key) | Demand model features, market attractiveness |
| **Real — reference** | Aircraft seat counts, range, fuel burn, published CASM | Airbus/Boeing public spec sheets (curated static table) | Capacity, cost model |
| **Real — fuel** | Jet fuel price history | EIA API (free key) or curated CSV from EIA historical data | Fuel cost model, "what-if fuel +30%" scenarios |
| **Synthetic — calibrated** | Passenger demand, ticket prices, load factors, competitor counts, market share | Generated via formulas using the real features above + noise, calibrated to published IATA/industry benchmark ranges | Demand forecasting *ground truth*, revenue, market share |

This is standard practice for this kind of project: real geographic/economic drivers,
synthetic-but-plausible outcome variables you control so models can actually be trained
and evaluated against known ground truth. It's explicitly documented as such — that
honesty is itself a positive signal in a portfolio review.

OpenSky is dropped as a hard dependency (auth-gated, rate-limited, doesn't give
commercial passenger counts) — kept as an optional future enrichment for flight
frequency only.

---

## Phase 1 — Business Model (`airline_profile.json`) — SCAFFOLDED NOW

Fictional airline **Pacific Wings**, based at Sydney (SYD), real routes/airports:

- SYD → SIN (Singapore Changi)
- SYD → NRT (Tokyo Narita)
- SYD → MEL (Melbourne)
- SYD → AKL (Auckland)
- Candidate new route: SYD → DAD (Da Nang)

Fleet: A320-200, A321neo, B787-9 — real published seat configs, range, fuel burn.

Distances computed from real airport coordinates (great-circle/haversine), not guessed.

## Phase 2 — Data Layer — SCAFFOLDED NOW

PostgreSQL schema (`db/schema.sql`) with tables: `airports`, `routes`, `aircraft`,
`fuel_prices`, `macro_indicators` (GDP/population/tourism per country/year),
`competitors`, `demand_observations`.

ETL scripts (`etl/`):
- `fetch_airports.py` — pulls airport master data from OurAirports, filters to relevant
  airports, writes `data/reference/airports.csv`.
- `fetch_worldbank.py` — pulls GDP, population, tourism arrivals for relevant countries
  (AU, SG, JP, NZ, VN) for recent years, writes `data/reference/macro_indicators.csv`.
- `generate_synthetic_demand.py` — generates monthly demand observations per route as a
  function of real distance/macro features + seasonality + noise; this becomes the
  training target for Phase 3.

## Phase 3 — Demand Forecasting

XGBoost/LightGBM trained on `demand_observations` (synthetic target) using real features
(distance, GDP, tourism arrivals, seasonality, competitor count, avg fare). Because the
target is generated from a known formula, you can report model accuracy against the true
generating function — useful for explaining the methodology honestly.

`/demand_forecast` API (FastAPI) — input route + month, output passenger forecast.

## Phase 4 — Revenue Model

Revenue = Σ(class passengers × class fare) + ancillary (baggage, seat selection, lounge).
Fares calibrated to real-world ranges (IATA average fare benchmarks per region/distance
band) rather than invented numbers.

## Phase 5 — Cost Model

Cost = fuel (real price history × real aircraft fuel burn × distance) + crew + airport
fees + lease + maintenance + catering + insurance. Per-unit cost ratios sourced from
published airline cost breakdowns (e.g., IATA/ICAO economic reports) as starting
calibration constants, documented in `docs/cost_assumptions.md`.

## Phase 6 — Market Share Model

Synthetic but feature-driven: competitor count, relative pricing, frequency, ratings →
market share via a calibrated logistic/multinomial model. Documented as a simulation
component, not a fitted-to-real-data model (since real market share data isn't public).

## Phase 7 — Simulation Engine

Pure function layer: takes `airline_profile.json` + scenario deltas (price, frequency,
fleet, fuel) → recomputes demand/revenue/profit/market share via Phases 3–6. This is the
deterministic core everything else calls.

## Phase 8 — AI Agents (LangGraph)

Five agents as specified (Market, Demand, Finance, Risk, Strategy). Market/Risk agents
can use **real** web/news context via LLM + retrieval for qualitative factors (tourism
trends, geopolitical notes); Demand/Finance agents call the simulation engine directly
(no hallucinated numbers — numbers come from Phases 3–6, LLM only narrates them).

## Phase 9 — LLM Copilot

Orchestrates Phase 8 agents, produces executive summary. Strict separation: LLM
*explains* simulation output, never invents figures.

## Phase 10 — What-If Analysis

Thin wrapper over Phase 7 with named scenario presets (fuel +30%, competitor entry,
tourism boom).

## Phase 11 — Dashboard (Next.js)

As specified — Executive Dashboard, Route Explorer (map using real airport coords),
Scenario Simulator, AI Strategy Assistant chat.

## Phase 12 — Deployment

FastAPI + PostgreSQL + Docker Compose for local/portfolio demo. AWS/Prometheus/Grafana
noted as stretch goals, not required for a working portfolio demo — Docker Compose
running locally (or on a single small cloud VM) is sufficient and far cheaper to show off.

---

## Status

Done:
1. `data/aircraft_specs.json` — real fleet specs
2. `etl/fetch_airports.py` + `data/reference/airports.csv` — real airport/coordinate data
3. `etl/fetch_worldbank.py` + `data/reference/macro_indicators.csv` — real GDP/population/tourism data
4. `etl/build_airline_profile.py` + `data/airline_profile.json` — Pacific Wings routes/fleet/market data
5. `etl/generate_synthetic_demand.py` + `data/processed/{demand_observations,competitors}.csv` — Phase 3 training target
6. `db/schema.sql` — PostgreSQL schema for Phase 2
7. `requirements.txt`, `README.md`
8. `docker-compose.yml` (Postgres, schema auto-applied) + `etl/load_db.py` — verified end-to-end, all tables loaded
9. Phase 3: `ml/features.py`, `ml/train_demand_model.py` (XGBoost, time-based 2022-2023 train / 2024 test split,
   R2=0.984, MAPE=3.7%), `api/main.py` (`/demand_forecast`, `/health`) — verified end-to-end via local server
10. Phase 4-5: `data/reference/fuel_prices.csv` (curated EIA annual averages), `docs/cost_assumptions.md`,
    `simulation/revenue.py` (cabin fare split + ancillary), `simulation/cost.py` (fuel/non-fuel CASM split,
    what-if fuel price lever), `api/main.py` `/route_economics` (demand -> revenue -> cost -> profit) —
    verified end-to-end including a fuel +30% what-if scenario
11. Phase 6-7: `simulation/market_share.py` (multinomial logit over Pacific Wings + synthetic competitors),
    `simulation/engine.py` (`SimulationEngine.run_scenario`/`compare` - applies price/frequency/aircraft/
    fuel/rating deltas, caps passengers carried by capacity, recomputes revenue/cost/profit/market share),
    `api/main.py` `/what_if` — verified with fare-cut, frequency-increase, and aircraft-swap scenarios
12. Phase 8-9: `agents/` — LangGraph `StateGraph` (`agents/graph.py`) wiring Demand and Finance agents
    (pure extraction from `SimulationEngine.compare()`, no LLM) and Market/Risk/Strategy agents (Gemini via
    `agents/llm_client.py`, `gemini-2.5-flash` free tier, grounded in real macro/tourism data +
    calibrated-synthetic competitor data via `agents/context.py`). `agents/copilot.py` orchestrates the graph
    and produces an executive summary; `api/main.py` `/copilot` — verified end-to-end including graceful
    degradation when `GEMINI_API_KEY` is unset (LLM sections report `"available": false` with a notice,
    simulation numbers unaffected). See `docs/agent_architecture.md`.

13. Phase 10: `simulation/presets.py` (`fuel_price_shock`, `tourism_boom`, `competitor_entry` - thin wrappers
    deriving scenario kwargs from route reference data), extended `ml/features.py` (`tourism_arrivals_multiplier`,
    `extra_competitors`), `simulation/market_share.py` (`extra_competitors`), and `simulation/engine.py` to
    thread both levers through `run_scenario`/`compare`. `api/main.py` `/what_if_presets` (lists presets) and
    `preset=` param on `/what_if` and `/copilot` - verified end-to-end: `fuel_price_shock` swings SIN profit
    from -$142.8k to -$290.2k, `competitor_entry` drops Pacific Wings' SIN market share from 22.8% to 17.6%.
    Note: `tourism_boom` is wired correctly but has near-zero effect on existing routes (SIN/NRT/MEL/AKL) -
    the demand model's tree splits on `tourism_arrivals_baseline` happen to fall between routes' fixed
    training values, so a +/-20% perturbation within one route mostly doesn't cross a split boundary. Only
    DAD (candidate route) shows a measurable effect (~104 passengers). This is an inherent limitation of
    training on one tourism value per route, not a bug in the preset.

14. Phase 11: `frontend/` - Next.js (App Router, TypeScript, Tailwind, Recharts, React-Leaflet@5) dashboard with
    four pages: Executive Dashboard (`/`, route cards + profit-by-route chart from `/what_if` baselines),
    Route Explorer (`/routes`, Leaflet/OpenStreetMap map of SYD + 5 routes incl. SYD-DAD candidate, backed by a
    new `api/main.py` `GET /routes` endpoint merging `airline_profile.json` with `airports.csv` coordinates,
    plus a details panel), Scenario Simulator (`/simulator`, shared `ScenarioForm` for manual deltas or named
    presets, `ComparisonCards`/`ComparisonCharts`/`MarketShareChart` for baseline-vs-scenario), and AI Strategy
    Assistant (`/copilot`, same form, renders demand/finance deltas plus market/risk/strategy report sections
    with graceful "unavailable" notices when `GEMINI_API_KEY` is unset). Backend updated with `CORSMiddleware`
    (`allow_origins=["http://localhost:3000"]`). Verified end-to-end: `npx tsc --noEmit` and `npm run build`
    clean, all 4 pages exercised in a browser (incl. running a manual scenario, a preset, and the AI assistant)
    against a live backend with zero console errors. Fixed a bug found during verification where selecting a
    preset left stale manual-delta values (e.g. a prior price change) in form state, which were then sent to
    `/what_if` alongside the preset and silently contaminated the result - `ScenarioForm` now clears manual
    deltas when a preset is selected.

15. Phase 12: `Dockerfile` (backend - copies pre-trained model + reference/profile data, runs
    `uvicorn api.main:app`), `frontend/Dockerfile` (multi-stage Next.js standalone build,
    `next.config.ts` `output: "standalone"`), `.dockerignore` files, and `docker-compose.yml`
    extended with `api` (port 8000) and `frontend` (port 3000) services alongside the existing
    `db` service. Verified end-to-end: `docker compose up --build` builds both images, all three
    containers start, `/health`, `/what_if_presets`, and `/what_if` respond correctly from `api`,
    and both `/` and `/simulator` return 200 from `frontend`. `db` remains used for ETL/training
    only - the API reads its baked-in model/data and doesn't need it at runtime.

Next:
- All 12 phases complete. Possible stretch goals: AWS/Prometheus/Grafana (noted as optional in
  the original plan, not required for the portfolio demo).
