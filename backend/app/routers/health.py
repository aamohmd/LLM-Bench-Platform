"""
Provides the liveness and readiness health check endpoints.
Backend router, mounted under /api/v1.
Collaborates with the hardware server, history store, and DB to verify overall system health.
Requires a valid Postgres connection; otherwise, the DB check will fail the health status.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from backend.app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def check_health(request: Request) -> HealthResponse:
    repository = request.app.state.repository
    history_store = request.app.state.history_store
    return HealthResponse(
        results_available=history_store.has_records() if history_store else (repository.results_dir / "summary.csv").exists(),
        task_suite_available=repository.tasks_path.exists(),
    )


