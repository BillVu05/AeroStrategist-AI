"""
The executive question typed in the Copilot chat must reach the three LLM
agents' prompts (and must not replace the data they reason over).
"""

from pacific_wings.agents import market_agent, risk_agent, strategy_agent
from pacific_wings.agents.copilot import brief

QUESTION = "Should we launch Sydney to Da Nang?"


def _capture(monkeypatch, module):
    seen = {}

    def fake_complete(system, user, **kwargs):
        seen["user"] = user
        return "ok"

    monkeypatch.setattr(module, "complete", fake_complete)
    return seen


def test_market_agent_receives_question(monkeypatch):
    seen = _capture(monkeypatch, market_agent)
    market_agent.analyze({"destination": "DAD"}, QUESTION)
    assert QUESTION in seen["user"]
    assert "DAD" in seen["user"]


def test_risk_agent_receives_question(monkeypatch):
    seen = _capture(monkeypatch, risk_agent)
    risk_agent.analyze({"destination": "DAD"}, {"baseline": {}}, QUESTION)
    assert QUESTION in seen["user"]
    assert "baseline" in seen["user"]


def test_strategy_agent_receives_question(monkeypatch):
    seen = _capture(monkeypatch, strategy_agent)
    strategy_agent.recommend({"pax": 1}, {"profit": 2}, {"commentary": "c"}, {"risks": "r"}, QUESTION)
    assert QUESTION in seen["user"]
    assert "profit" in seen["user"]  # question steers the prompt, doesn't replace the figures


def test_brief_carries_the_chat_answer_into_the_deep_dive():
    steer = brief(QUESTION, "Chat said: DAD looks marginal at 3x weekly.") or ""
    assert QUESTION in steer
    assert "DAD looks marginal" in steer
    assert "deeper" in steer  # the report must extend the chat answer, not restate it


def test_brief_is_just_the_question_without_evidence():
    assert brief(QUESTION) == QUESTION
    assert brief(None, "some chat answer") is None  # no question, no steering


def test_agents_unchanged_without_question(monkeypatch):
    seen = _capture(monkeypatch, market_agent)
    market_agent.analyze({"destination": "DAD"})
    assert "asked" not in seen["user"] and "question" not in seen["user"]
