from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.app.core.config import get_settings
from backend.app.repositories.benchmark_repository import BenchmarkRepository, RepositoryDataError
from backend.app.repositories.history_store import BenchmarkHistoryRepository
from backend.app.routers import (
    api_keys,
    auth_session,
    benchmarks,
    health,
    onboarding,
    prompts,
    tasks_management,
    strategies,
)
from backend.app.routers.benchmarks import results_router


def create_app(results_dir: Path | None = None, tasks_path: Path | None = None) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        history_store = BenchmarkHistoryRepository(
            settings.database_url,
            settings.tasks_path,
            settings.git_revision,
            experiment_tag=settings.experiment_tag,
        )
        try:
            history_store.create_schema()
            has_existing = history_store.has_records()
            if not has_existing:
                history_store.remove_legacy_duplicates()
                history_store.import_legacy_runs(app.state.repository.list_runs())
            history_store.list_api_keys()
        except Exception:
            logging.getLogger("uvicorn.error").exception("Control-plane startup failed")
            raise

        async def periodic_cleanup():
            while True:
                try:
                    cleaned = history_store.cleanup_expired_traces(days_to_keep=7)
                    if cleaned > 0:
                        print(f"🧹 Cleaned up {cleaned} expired failed traces.")
                except Exception as e:
                    print(f"Failed to cleanup expired traces: {e}")
                await asyncio.sleep(86400)

        cleanup_task = asyncio.create_task(periodic_cleanup())
        app.state.history_store = history_store
        yield
        cleanup_task.cancel()

    app = FastAPI(title="Local LLM Benchmark API", version="1.0.0", lifespan=lifespan)
    app.state.repository = BenchmarkRepository(
        results_dir=results_dir or settings.results_dir,
        tasks_path=tasks_path or settings.tasks_path,
    )
    app.state.history_store = None
    app.state.settings = settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins or ["http://localhost:3000"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["X-API-Key", "Content-Type"],
    )
    from fastapi.middleware.gzip import GZipMiddleware
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    @app.exception_handler(RepositoryDataError)
    async def repository_error_handler(_, exc: RepositoryDataError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    app.include_router(health.router, prefix="/api/v1")
    app.include_router(benchmarks.router, prefix="/api/v1")
    app.include_router(results_router, prefix="/api/v1")
    app.include_router(auth_session.router, prefix="/api/v1")
    app.include_router(prompts.router, prefix="/api/v1")
    app.include_router(api_keys.router, prefix="/api/v1")
    app.include_router(tasks_management.router, prefix="/api/v1")
    app.include_router(strategies.router, prefix="/api/v1")
    app.include_router(onboarding.router, prefix="/api/v1")

    @app.get("/", tags=["system"])
    async def root_status():
        return {
            "service": "Local LLM Benchmark Control Plane",
            "status": "online",
            "documentation": "/docs",
            "health_check": "/api/v1/health",
            "benchmarks": "/api/v1/benchmarks",
        }

    return app


app = create_app()
