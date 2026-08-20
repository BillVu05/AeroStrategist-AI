"""
The saved report library.
"""

from fastapi import APIRouter, HTTPException

from pacific_wings.api.config import (
    PROTECTED,
)
from pacific_wings.api.schemas import SaveReportRequest
from pacific_wings.storage.reports import delete_report, get_report, list_reports, save_report

router = APIRouter()


@router.get("/reports")
def reports_list():
    """Summaries (no payload) for the Strategic Report Library grid, newest first."""
    return {"reports": list_reports()}

@router.get("/reports/{report_id}")
def reports_get(report_id: str):
    """Full saved report, including the original analysis payload, for Preview."""
    record = get_report(report_id)
    if record is None:
        raise HTTPException(status_code=404, detail="report not found")
    return record

@router.post("/reports", dependencies=PROTECTED)
def reports_save(req: SaveReportRequest):
    """
    Saves a completed analysis into the Strategic Report Library. Called by
    the frontend right after a /copilot run or an /analyze_route(_agents)
    run succeeds - this endpoint itself is storage-only and doesn't re-run
    any analysis.

    Pass `id` to overwrite an existing entry in place (e.g. Open Route's
    optional agent-enrichment step updating its earlier base-analysis save)
    rather than creating a duplicate.
    """
    return save_report(**req.model_dump())

@router.delete("/reports/{report_id}", dependencies=PROTECTED)
def reports_delete(report_id: str):
    if not delete_report(report_id):
        raise HTTPException(status_code=404, detail="report not found")
    return {"deleted": report_id}
