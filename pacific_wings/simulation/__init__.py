"""The deterministic simulation core.

`engine.SimulationEngine` is the entry point; everything else here is a
component it composes. No module in this package calls an LLM or the
network - given the same inputs it returns the same numbers.
"""
