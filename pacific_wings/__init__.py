"""Pacific Wings: an airline network strategy simulator.

One package rather than six top-level directories on sys.path. The old
layout needed nineteen `sys.path.insert` calls to import across itself,
which in turn forced two lint rules off, and it filed a 866-line route
calculator and a JSON store under `agents/` because that is where they
were first written.

    simulation/  the deterministic model - market, share, spill, P&L, fleet
    ml/          the market-size model, its selection, and confidence
    analysis/    route screening for destinations not in the network
    agents/      the LLM narration layer, and nothing else
    storage/     saved reports
    api/         the FastAPI surface
"""
