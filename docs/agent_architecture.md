# AI Agent Architecture (Phases 8-9)

This documents how the LangGraph agents and the Copilot endpoint
(`agents/`, `/copilot`) split work between the deterministic simulation
engine (Phases 3-7) and Claude (LLM narration), so results can be
interpreted honestly - same spirit as `docs/cost_assumptions.md`.

## Strict separation of numbers vs. narration

> "Demand/Finance agents call the simulation engine directly (no
> hallucinated numbers - numbers come from Phases 3-6, LLM only narrates
> them)." - PLAN.md, Phase 8/9

- **Demand agent** (`agents/demand_agent.py`) and **Finance agent**
  (`agents/finance_agent.py`) are pure functions with no LLM call. They
  extract and label fields already computed by
  `SimulationEngine.compare()` (passengers, load factor, revenue, cost,
  profit, deltas). Given the same simulation output, they always return the
  same result.
- **Market**, **Risk**, and **Strategy** agents call Claude
  (`agents/llm_client.py`) to produce qualitative text. Their prompts
  include the exact numbers from the simulation/demand/finance steps and
  instruct the model to reference those numbers as-is, not recompute or
  invent new ones.

## The five agents

| Agent | Module | LLM? | Input | Output |
|---|---|---|---|---|
| Demand | `agents/demand_agent.py` | No | `engine.compare()` result | baseline/scenario/delta passenger & load-factor facts |
| Finance | `agents/finance_agent.py` | No | `engine.compare()` result | baseline/scenario/delta revenue/cost/profit facts |
| Market | `agents/market_agent.py` | Yes | route market context (`agents/context.py`) | qualitative commentary on demand drivers, tourism, competition |
| Risk | `agents/risk_agent.py` | Yes | market context + simulation comparison | 2-4 material risks (fuel, competition, capacity, macro) |
| Strategy | `agents/strategy_agent.py` | Yes | demand/finance summaries + market/risk commentary | executive summary + proceed/caution/no-go recommendation |

## Market/Risk context: real data, no live retrieval

PLAN.md's Phase 8 description allows Market/Risk agents to use "real
web/news context via LLM + retrieval for qualitative factors". No live
web/news retrieval is wired up in this project - instead, `agents/context.py`
re-shapes the **real** macro data (GDP, GDP growth, population - World Bank,
`data/reference/macro_indicators.csv`), **real** route data (distance,
tourism arrivals baseline - `data/airline_profile.json`), and
**calibrated-synthetic** competitor data (`data/processed/competitors.csv`)
that already feed the Phase 3 demand model. Claude interprets this data
qualitatively; it does not introduce new figures.

## LangGraph pipeline (`agents/graph.py`)

```
simulation -> demand -> finance -> market -> risk -> strategy
```

- `simulation`: runs `SimulationEngine.compare()` once and builds the market
  context, so every downstream node works from the same numbers.
- `demand`, `finance`: pure extraction (no LLM).
- `market`, `risk`, `strategy`: sequential Claude calls, each building on the
  prior agents' output.

## Copilot (`agents/copilot.py`, `/copilot` endpoint)

`run_copilot(destination, year, month, **scenario_kwargs)` runs the graph
above and returns a single response combining:

- `scenario`, `demand`, `finance` - straight from the simulation engine
- `market_analysis`, `risk_analysis`, `strategy` - Claude narration, each
  with an `"available"` flag

## Missing API key / degraded mode

`agents/llm_client.py` resolves `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) from
the environment via the official `google-genai` SDK (`genai.Client()`). The
Gemini API has a free tier (no billing required) - get a key at
https://aistudio.google.com/apikey. If no key is set, or the API call fails
(`ClientError`, `ServerError`, `APIError`), `complete()` returns `None` and
each LLM agent reports `"available": false` with a fixed notice, rather than
raising an error. `demand`, `finance`, and `scenario` are unaffected - the
`/copilot` endpoint always returns full simulation results regardless of LLM
availability.

Default model: `gemini-2.5-flash` (overridable via the `GEMINI_MODEL` env
var).

## Chat agent (`agents/chat_agent.py`, `/chat` endpoint)

A separate, conversational alternative to the `/copilot` pipeline above,
powering the AI Strategy Assistant chat UI (`frontend/app/copilot/page.tsx`).
Instead of a fixed sequential pipeline with three separate Gemini calls, this
is a single Gemini conversation per turn using **automatic function calling**:
Gemini is given Python functions as tools and decides for itself which to
call, with what arguments, and how many times, before writing one unified
reply.

Tools exposed to the model:

| Tool | Wraps | Purpose |
|---|---|---|
| `list_routes` | `ml/features.py` `ReferenceData.routes_by_destination` | Resolve city/country names to IATA codes; check active vs. candidate routes |
| `list_what_if_presets` | `simulation/presets.py` | Discover named scenario presets |
| `simulate_route` | `SimulationEngine.compare()` | Baseline-vs-scenario demand/revenue/cost/profit/market-share for a route, given fare/frequency/fuel/aircraft/rating changes or a preset. Also accepts `fuel_price_delta_pct` (e.g. "fuel prices rise 25%"), converted internally via `simulation/cost.py:latest_fuel_price()` |
| `get_market_context` | `agents/context.py` | Real macro/tourism/competitor data for qualitative commentary |

The system prompt enforces the same "numbers vs. narration" rule as the rest
of this document: any quantitative claim must come from a tool call, and the
model cites those figures exactly. `agents/chat_agent.py:chat()` returns the
reply text plus a `tool_calls` trace (`{"name", "args", "result"}`) so the UI
can render simulation deltas alongside the conversational answer. Like the
other LLM agents, it degrades to `UNAVAILABLE_NOTICE` if `GEMINI_API_KEY` is
not set or the API call fails - this is independent of, and does not modify,
the `/copilot` 5-agent pipeline.
