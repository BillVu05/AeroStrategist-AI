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
- SYD → HND (Tokyo Haneda)
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
9. Phase 3: `ml/features.py`, `ml/train_demand_model.py` (XGBoost, time-based 2022-2023 train / 2024 test split),
   `api/main.py` (`/demand_forecast`, `/health`) — verified end-to-end via local server. Training target was
   initially fully synthetic (R2=0.984, MAPE=3.7% — near-perfect because the target was a known formula the
   model could recover); `etl/fetch_real_aviation_stats.py` (real-data rebuild, see below) later replaced
   passengers/load_factor with real BITRE figures for SIN/HND/AKL/DAD, giving R2=0.952, MAPE=15.3% — lower
   but now a genuine forecast-skill number against real-world noise, not formula recovery.
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
    Note: `tourism_boom` is wired correctly but has near-zero effect on existing routes (SIN/HND/MEL/AKL) -
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

16. **Real-data rebuild** (post-launch hardening — replacing the synthetic-but-calibrated tier with real,
    citable data where it exists; full research/citations in the session plan doc):
    - Phase 1 — route correction: swapped `SYD-NRT` to the real-world `SYD-HND` (no carrier flies Narita
      from Sydney today) across `etl/build_airline_profile.py`, `etl/fetch_airports.py`,
      `etl/generate_synthetic_demand.py`, frontend constants.
    - Phase 2 — real competitors: `etl/generate_synthetic_demand.py`'s `COMPETITORS` now lists real carriers/
      frequencies/Skytrax ratings/spot-checked fares per route; recalibrated `simulation/market_share.py`'s
      logit model for the wider real frequency/fare range (sanity-checked: Singapore Airlines ~61% modeled
      vs ~60% real BITRE share on SYD-SIN).
    - Phase 3 — real demand: new `etl/fetch_real_aviation_stats.py` parses two manually-downloaded BITRE
      spreadsheets (`data/raw/`, gitignored) into real monthly passenger/load-factor figures for SIN, HND,
      and AKL, and a population-scaled real-reference estimate for the DAD candidate route. SYD-MEL is
      domestic — no real source was downloaded for it, so it stays on the original synthetic formula
      (documented choice, not an oversight). Retrained `ml/train_demand_model.py` — see item 9 for the
      before/after metrics.
    - Phase 4 — cost & fare calibration: `data/aircraft_specs.json`'s non-fuel CASM is now anchored to Qantas
      Group's FY25 disclosed ex-fuel unit cost (6.22 AUD cents/ASK, the only clean public figure found across
      the relevant carriers — a group blend, not per-aircraft), scaled uniformly across the fleet to preserve
      the prior relative shape (see `docs/cost_assumptions.md`). Found and fixed a bug along the way:
      `agents/open_route_analyst.py`'s separate fare-by-distance table (used for arbitrary new destinations)
      was running 60-105% above the real-anchored fare formula already in `etl/generate_synthetic_demand.py`
      (which, it turns out, already matched Phase 2's real spot-checked fares almost exactly — no changes
      needed there) — replaced it with the same formula. Re-verified via `SimulationEngine`: lower CASM
      raised profit/reduced losses across all 5 routes directionally as expected, nothing broke.
    - Phase 5 — forecasting research deepening: `ml/train_demand_model.py` adds 5-fold cross-validation
      (R2=0.966+/-0.014, but MAPE=42%+/-26% - far less stable than the single 2024 holdout's 15.3%, traced to
      DAD's tiny passenger counts blowing up percentage error in under-represented folds) and residual
      quantiles from the real holdout, surfaced as an 80% prediction interval on `/demand_forecast`
      (`predicted_passengers_low/high`) and in the demand page's comparison table. New
      `simulation/monte_carlo.py` samples fuel price and GDP growth from REAL historical volatility
      (`data/reference/fuel_prices.csv`, `macro_indicators.csv`) plus an illustrative competitor-entry
      probability, running hundreds of `SimulationEngine` passes to return an outcome distribution instead of
      a point estimate - exposed via `/monte_carlo`, a `run_route_monte_carlo` chat tool (verified the live
      Gemini agent actually selects it and cites the right figures), and a `MonteCarloPanel` on the Scenario
      Simulator page (histogram + percentiles, verified in-browser via Playwright with zero console errors).
      New `docs/data_methodology.md` is a full per-field real/real-derived/illustrative provenance appendix
      across the whole pipeline.

17. **Standalone Open Route page**: the worldwide new-route analysis (`agents/open_route_analyst.py` +
    `agents/open_route_agents.py`) was previously chat-only. Added `api/main.py`'s `GET /analyze_route_agents`
    (the five-agent narrative, `analyze_with_agents`, wasn't reachable outside the Gemini function-calling
    path before this). Extracted `AnalyzeNewRouteResult`/`CompareNewRoutesResult` out of `ChatToolResult.tsx`
    into shared `frontend/components/RouteAnalysisCard.tsx` (`RouteAnalysisReport`/`RouteComparisonList`) so
    the chat cards and the new page render identically from the same backend shape. New `frontend/app/open-
    route/page.tsx` + `OpenRouteForm.tsx` (destination autocomplete via `/search_airports`, frequency/
    aircraft/fare/fuel/competitor overrides, a single-destination report, a multi-city comparison queue, and
    an on-demand "Generate AI analysis" button so the page loads instantly without waiting on 3 LLM calls).
    Nav updated. Verified end-to-end in-browser via Playwright (single analysis, AI evidence generation, and
    a 2-city comparison), zero console errors. The chat agent remains the natural-language entry point
    (resolves ambiguous cities, multi-turn refinement); this page is the persistent/shareable structured
    workspace it can hand off to.

Next:
- All 5 real-data rebuild phases are complete (see item 16), and all 12 original phases are complete.
  AWS/Prometheus/Grafana remain optional stretch goals, not required for the portfolio demo.
