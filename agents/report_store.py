"""
Persistence for the Strategic Report Library (frontend /reports).

A saved report is a snapshot of a completed analysis - either the existing-
network 5-agent pipeline (/copilot) or a new/open-route feasibility study
(/analyze_route or /analyze_route_agents) - kept so it can be browsed later
instead of being thrown away when the user navigates elsewhere.

Backed by a single JSON file rather than a database: this repo's API has no
live DB connection (db/schema.sql is a reference schema for the ETL phase
only), and report volume is low enough that a flat file is sufficient.
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

ROOT = Path(__file__).resolve().parents[1]
REPORTS_PATH = ROOT / "data" / "reports.json"

_lock = Lock()


def _load() -> list[dict]:
    if not REPORTS_PATH.exists():
        return []
    return json.loads(REPORTS_PATH.read_text())


def _save_all(records: list[dict]) -> None:
    REPORTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORTS_PATH.write_text(json.dumps(records, indent=2))


_SUMMARY_FIELDS = ["id", "created_at", "kind", "title", "description", "destination", "destination_city", "agents"]


def list_reports() -> list[dict]:
    """Newest first, payload omitted (the library grid only needs summaries)."""
    with _lock:
        records = _load()
    records.sort(key=lambda r: r["created_at"], reverse=True)
    return [{k: r[k] for k in _SUMMARY_FIELDS} for r in records]


def get_report(report_id: str) -> dict | None:
    with _lock:
        records = _load()
    return next((r for r in records if r["id"] == report_id), None)


def save_report(
    kind: str,
    destination: str,
    destination_city: str,
    title: str,
    description: str,
    agents: list[str],
    payload: dict,
    id: str | None = None,
) -> dict:
    """Create a new report, or - if `id` matches an existing one - overwrite
    it in place (keeping the original created_at). The latter lets a
    two-step flow like Open Route's base analysis + optional agent
    enrichment update one library entry instead of creating a duplicate."""
    with _lock:
        records = _load()
        existing = next((r for r in records if r["id"] == id), None) if id else None

        record = {
            "id": existing["id"] if existing else str(uuid.uuid4()),
            "created_at": existing["created_at"] if existing else datetime.now(timezone.utc).isoformat(),
            "kind": kind,
            "title": title,
            "description": description,
            "destination": destination,
            "destination_city": destination_city,
            "agents": agents,
            "payload": payload,
        }

        if existing:
            records = [record if r["id"] == existing["id"] else r for r in records]
        else:
            records.append(record)

        _save_all(records)
    return record


def delete_report(report_id: str) -> bool:
    with _lock:
        records = _load()
        remaining = [r for r in records if r["id"] != report_id]
        if len(remaining) == len(records):
            return False
        _save_all(remaining)
    return True
