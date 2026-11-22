"""
Provides the liveness and readiness health check endpoints.
Backend router, mounted under /api/v1.
Verifies database reachability and reports stored-result and legacy task-file availability.
Returns 503 when the database is unavailable. It does not check inference-engine health.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError

from backend.app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def check_health(request: Request) -> HealthResponse:
    repository = request.app.state.repository
    history_store = request.app.state.history_store
    if history_store is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    try:
        history_store.check_persistence_readiness()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return HealthResponse(
        results_available=history_store.has_records() if history_store else (repository.results_dir / "summary.csv").exists(),
        task_suite_available=repository.tasks_path.exists(),
    )


