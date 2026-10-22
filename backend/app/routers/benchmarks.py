"""
REST endpoints for benchmark submission and history retrieval.
Backend router mounted under /api/v1.
Collaborates with BenchmarkHistoryRepository and API key auth.
Every accepted runner submission identity is retained as one immutable history row.
"""

from __future__ import annotations
import csv
import hashlib
import io
import json
from datetime import datetime, timezone
import logging
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import APIRouter, Depends, Query, Request, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError
from backend.app.core.auth import require_api_key
from backend.app.repositories.benchmark_repository import BenchmarkRepository
from backend.app.schemas import (
    BenchmarkHistoryPoint,
    BenchmarkOverview,
    BenchmarkRun,
    BenchmarkRunSubmission,
    BenchmarkIngestionReadiness,
    BenchmarkRunDetail,
    CompositeProfilesResponse,
    ApprovalEvaluationResponse,
    ExperimentTagSummary,
)

router = APIRouter(tags=["benchmarks"], dependencies=[Depends(require_api_key(scope="visitor"))])
results_router = APIRouter(tags=["benchmark-results"], dependencies=[Depends(require_api_key(scope="admin"))])
logger = logging.getLogger(__name__)


def _ingestion_error_response(
    *,
    status_code: int,
    error_code: str,
    message: str,
    error_id: str,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "detail": message,
            "error_code": error_code,
            "error_id": error_id,
        },
        headers={"X-Error-ID": error_id},
    )


def get_repository(request: Request) -> BenchmarkRepository:
    return request.app.state.repository


@router.get("/composite-profiles", response_model=CompositeProfilesResponse)
def get_composite_profiles() -> CompositeProfilesResponse:
    """Return the composite scoring config (tiers and weight profiles).

    The dashboard renders weight breakdowns from this rather than hardcoding
    them, so profiles can be tuned without a frontend deploy.
    """
    from backend.app.services.composite_score import load_profiles
    config = load_profiles()
    return CompositeProfilesResponse(
        tiers=config["tiers"],
        profiles=config["profiles"],
    )


@router.get("/benchmarks/scorecard-runs", response_model=list[BenchmarkRun])
def list_scorecard_benchmarks(
    request: Request,
    concurrency: int | None = Query(default=None),
    model: str | None = Query(default=None),
    framework: str | None = Query(default=None),
    hardware_type: str | None = Query(default=None),
    suite_id: str | None = Query(default=None),
    repository: BenchmarkRepository = Depends(get_repository),
) -> list[BenchmarkRun]:
    """Return partitioned champion runs (top quality and top throughput per category/concurrency/deployment).

    Guarantees 100% complete category coverage and immunity to database row growth, preventing older
    models or categories from being crowded out by recent benchmark sweeps.
    """
    history_store = request.app.state.history_store
    if history_store:
        return history_store.list_scorecard_runs(
            concurrency=concurrency,
            model=model,
            framework=framework,
            hardware_type=hardware_type,
            suite_id=suite_id,
        )
    return repository.list_scorecard_runs(
        concurrency=concurrency,
        model=model,
        framework=framework,
        hardware_type=hardware_type,
        suite_id=suite_id,
    )


@router.get("/benchmarks/scoreboard-suites")
def list_scoreboard_suites(request: Request) -> list[dict]:
    """Public suite catalog with the SLA policy resolved for scorecard evaluation."""
    history_store = request.app.state.history_store
    if not history_store:
        return []
    return history_store.list_benchmark_suites()


@router.get("/benchmarks", response_model=list[BenchmarkRun])
def list_benchmarks(
    request: Request,
    limit: int = Query(default=100, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    experiment_tag: str | None = Query(default=None),
    model: str | None = Query(default=None),
    framework: str | None = Query(default=None),
    concurrency: int | None = Query(default=None),
    hardware_type: str | None = Query(default=None),
    suite_id: str | None = Query(default=None),
    scorecard: bool = Query(default=False),
    repository: BenchmarkRepository = Depends(get_repository),
) -> list[BenchmarkRun]:
    history_store = request.app.state.history_store
    if scorecard:
        if history_store:
            return history_store.list_scorecard_runs(
                concurrency=concurrency,
                model=model,
                framework=framework,
                hardware_type=hardware_type,
                suite_id=suite_id,
            )
        return repository.list_scorecard_runs(
            concurrency=concurrency,
            model=model,
            framework=framework,
            hardware_type=hardware_type,
            suite_id=suite_id,
        )
    if history_store:
        return history_store.list_runs(
            limit=limit,
            offset=offset,
            experiment_tag=experiment_tag,
            model=model,
            framework=framework,
            concurrency=concurrency,
            hardware_type=hardware_type,
            suite_id=suite_id,
        )
    return repository.list_runs(
        experiment_tag=experiment_tag,
        model=model,
        framework=framework,
        concurrency=concurrency,
        hardware_type=hardware_type,
        suite_id=suite_id,
        limit=limit,
        offset=offset,
    )


@router.get("/experiment-tags", response_model=list[ExperimentTagSummary])
def list_experiment_tags(
    request: Request,
    repository: BenchmarkRepository = Depends(get_repository),
) -> list[ExperimentTagSummary]:
    """Return all distinct experiment tags, run counts, models, and date ranges."""
    history_store = request.app.state.history_store
    if history_store:
        tags = history_store.get_experiment_tags()
    else:
        tags = repository.get_experiment_tags()
    return [ExperimentTagSummary(**t) for t in tags]


@router.get("/benchmarks/export-csv")
def export_benchmarks_csv(
    request: Request,
    limit: int = Query(default=1000, ge=1, le=5000),
    experiment_tag: str | None = Query(default=None),
    model: str | None = Query(default=None),
    framework: str | None = Query(default=None),
    concurrency: int | None = Query(default=None),
    hardware_type: str | None = Query(default=None),
    repository: BenchmarkRepository = Depends(get_repository),
) -> Response:
    """Export benchmark telemetry and production gate evaluations as an audit-grade CSV."""
    history_store = request.app.state.history_store
    if history_store:
        runs = history_store.list_runs(
            limit=limit,
            experiment_tag=experiment_tag,
            model=model,
            framework=framework,
            concurrency=concurrency,
            hardware_type=hardware_type,
        )
    else:
        runs = repository.list_runs(
            experiment_tag=experiment_tag,
            model=model,
            framework=framework,
            concurrency=concurrency,
            hardware_type=hardware_type,
        )[:limit]

    output = io.StringIO()
    writer = csv.writer(output)

    headers = [
        "run_id",
        "timestamp",
        "model",
        "framework",
        "quantization",
        "concurrency",
        "prompt_category",
        "experiment_tag",
        "hw_platform",
        "hw_gpu_name",
        "hw_aws_instance_type",
        "median_ttft_s",
        "p95_ttft_s",
        "median_decode_tps",
        "aggregate_output_tps",
        "median_model_memory_mb",
        "peak_gpu_mem_mb",
        "peak_kv_cache_pct",
        "quality_score",
        "quality_success_rate",
        "error_count",
        "generation_timeout_count",
        "generation_timeout_rate",
        "gate1_decode_tps_pass",
        "gate2_median_ttft_pass",
        "gate3_p95_ttft_pass",
        "gate4_quality_pass",
        "gate5_memory_pass",
        "sla_precondition_pass",
    ]
    writer.writerow(headers)

    for r in runs:
        tps = r.median_decode_tps or 0.0
        ttft = r.median_ttft_s if r.median_ttft_s is not None else 999.0
        p95 = r.p95_ttft_s if r.p95_ttft_s is not None else 999.0
        q = r.quality_score if r.quality_score is not None else (r.quality_success_rate or 0.0)

        mem_pass = True
        if r.peak_kv_cache_pct is not None and r.peak_kv_cache_pct > 85.0:
            mem_pass = False
        if r.peak_gpu_mem_mb is not None and r.hw_gpu_memory_mb:
            if (r.peak_gpu_mem_mb / r.hw_gpu_memory_mb) > 0.85:
                mem_pass = False

        g1 = tps >= 25.0
        g2 = ttft <= 0.800
        g3 = p95 <= 1.500
        g4 = q >= 0.75
        g5 = mem_pass
        request_count = r.quality_total_count or r.num_runs or 1
        err_rate = (r.error_count or 0) / request_count
        precond = err_rate <= 0.01

        writer.writerow([
            r.id or "",
            r.timestamp.isoformat() if r.timestamp else "",
            r.model,
            r.framework or "",
            r.quantization or "",
            r.concurrency if r.concurrency is not None else 1,
            r.prompt_category or "",
            r.experiment_tag or "",
            r.hw_platform or "",
            r.hw_gpu_name or "",
            r.hw_aws_instance_type or "",
            f"{r.median_ttft_s:.4f}" if r.median_ttft_s is not None else "",
            f"{r.p95_ttft_s:.4f}" if r.p95_ttft_s is not None else "",
            f"{r.median_decode_tps:.2f}" if r.median_decode_tps is not None else "",
            f"{r.aggregate_output_tps:.2f}" if r.aggregate_output_tps is not None else "",
            f"{r.median_model_memory_mb:.1f}" if r.median_model_memory_mb is not None else "",
            f"{r.peak_gpu_mem_mb:.1f}" if r.peak_gpu_mem_mb is not None else "",
            f"{r.peak_kv_cache_pct:.1f}" if r.peak_kv_cache_pct is not None else "",
            f"{r.quality_score:.4f}" if r.quality_score is not None else "",
            f"{r.quality_success_rate:.4f}" if r.quality_success_rate is not None else "",
            r.error_count or 0,
            r.generation_timeout_count or 0,
            f"{r.generation_timeout_rate:.4f}",
            g1,
            g2,
            g3,
            g4,
            g5,
            precond,
        ])

    csv_data = output.getvalue()
    filename = f"benchmark_audit_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/benchmarks/overview", response_model=BenchmarkOverview)
def get_overview(request: Request, repository: BenchmarkRepository = Depends(get_repository)) -> BenchmarkOverview:
    history_store = request.app.state.history_store
    if history_store:
        total_runs, models, latest_run = history_store.get_overview()
        return BenchmarkOverview(
            total_runs=total_runs,
            models=models,
            latest_run=latest_run,
        )
    runs = repository.list_runs()
    return BenchmarkOverview(
        total_runs=len(runs),
        models=len({run.model for run in runs}),
        latest_run=runs[0] if runs else None,
    )


@router.get("/approval-runs", response_model=dict[str, ApprovalEvaluationResponse])
def evaluate_all_approvals(request: Request) -> dict[str, ApprovalEvaluationResponse]:
    """Return SLA verdicts for all approval matrix executions in a single batch call."""
    history_store = request.app.state.history_store
    if history_store:
        all_runs = history_store.list_approval_runs(limit=1000)
    else:
        all_runs = get_repository(request).list_runs()

    runs_by_id: dict[str, list] = {}
    for r in all_runs:
        if r.approval_run_id:
            runs_by_id.setdefault(r.approval_run_id, []).append(r)

    if not runs_by_id:
        return {}

    from backend.app.services.approval import evaluate_approval_run
    from backend.app.services.composite_score import compute_all, load_profiles

    config = load_profiles()
    results: dict[str, ApprovalEvaluationResponse] = {}

    for app_id, runs in runs_by_id.items():
        evaluation = evaluate_approval_run(
            [run.model_dump(mode="json") for run in runs],
            approval_run_id=app_id,
        )
        composites = None
        if evaluation.verdict == "Qualified":
            composites = {}
            for run in runs:
                if run.approval_run_id != app_id or run.run_type != "approval" or run.concurrency_scope != "required":
                    continue
                composites[run.id or f"{run.model}:{run.concurrency}"] = compute_all(run.model_dump(mode="json"), config)

        results[app_id] = ApprovalEvaluationResponse(
            approval_run_id=app_id,
            verdict=evaluation.verdict,
            reasons=list(evaluation.reasons),
            category_scores=evaluation.category_scores,
            category_evidence=evaluation.category_evidence,
            required_result_count=evaluation.required_result_count,
            evaluated_result_count=evaluation.evaluated_result_count,
            composite_scores=composites,
        )
    return results


@router.get("/approval-runs/{approval_run_id}", response_model=ApprovalEvaluationResponse)
def evaluate_approval(
    request: Request,
    approval_run_id: str,
) -> ApprovalEvaluationResponse:
    """Return the single SLA verdict for one approval matrix execution.

    Diagnostic and exploratory rows are excluded by the evaluator. Composite
    ranking is intentionally computed only after a Qualified verdict.
    """
    history_store = request.app.state.history_store
    if history_store:
        runs = history_store.list_runs_by_approval_id(approval_run_id)
    else:
        all_runs = get_repository(request).list_runs()
        runs = [r for r in all_runs if r.approval_run_id == approval_run_id]
    from backend.app.services.approval import evaluate_approval_run

    evaluation = evaluate_approval_run(
        [run.model_dump(mode="json") for run in runs],
        approval_run_id=approval_run_id,
    )
    composites = None
    if evaluation.verdict == "Qualified":
        from backend.app.services.composite_score import compute_all, load_profiles
        config = load_profiles()
        composites = {}
        for run in runs:
            if run.approval_run_id != approval_run_id or run.run_type != "approval" or run.concurrency_scope != "required":
                continue
            composites[run.id or f"{run.model}:{run.concurrency}"] = compute_all(run.model_dump(mode="json"), config)

    return ApprovalEvaluationResponse(
        approval_run_id=approval_run_id,
        verdict=evaluation.verdict,
        reasons=list(evaluation.reasons),
        category_scores=evaluation.category_scores,
        category_evidence=evaluation.category_evidence,
        required_result_count=evaluation.required_result_count,
        evaluated_result_count=evaluation.evaluated_result_count,
        composite_scores=composites,
    )



@router.get("/benchmark-history", response_model=list[BenchmarkHistoryPoint])
def list_history(
    request: Request,
    limit: int = Query(default=200, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    experiment_tag: str | None = Query(default=None),
    model: str | None = Query(default=None),
    framework: str | None = Query(default=None),
    concurrency: int | None = Query(default=None),
    hardware_type: str | None = Query(default=None),
) -> list[BenchmarkHistoryPoint]:
    history_store = request.app.state.history_store
    if history_store:
        return history_store.list_points(
            limit=limit,
            offset=offset,
            experiment_tag=experiment_tag,
            model=model,
            framework=framework,
            concurrency=concurrency,
            hardware_type=hardware_type,
        )
    runs = get_repository(request).list_runs(
        experiment_tag=experiment_tag,
        model=model,
        framework=framework,
        concurrency=concurrency,
        hardware_type=hardware_type,
        limit=limit,
        offset=offset,
    )
    points = [
        BenchmarkHistoryPoint(
            id=uuid5(NAMESPACE_URL, f"{run.timestamp}:{run.model}:{run.prompt_category}:{run.mode}"),
            created_at=run.timestamp,
            experiment_tag="legacy",
            model=run.model,
            prompt_category=run.prompt_category or "unknown",
            mode=run.mode if run.mode in {"warm", "cold"} else "warm",
            num_runs=run.num_runs,

            median_ttft_s=run.median_ttft_s,
            median_e2e_s=run.median_e2e_s,
            median_prefill_tps=run.median_prefill_tps,
            median_decode_tps=run.median_decode_tps,
            median_model_memory_mb=run.median_model_memory_mb,
            framework=run.framework,
        )
        for run in runs
        if run.timestamp is not None
    ]
    # Composite scoring is compute-on-read — derive it here too so the legacy
    # CSV fallback path stays consistent with the history-store path.
    if points:
        from backend.app.services.composite_score import compute_all, detect_tier, load_profiles
        config = load_profiles()
        for point in points:
            run_data = point.model_dump()
            point.hardware_tier = detect_tier(run_data, config)
            point.composite_scores = compute_all(run_data, config)
    return points


@router.get("/benchmark-history/{run_id}", response_model=BenchmarkRunDetail)
def get_run_detail(request: Request, run_id: str) -> BenchmarkRunDetail:
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="History store not available")
    
    run = history_store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    return run



@router.get(
    "/benchmark-history/{run_id}/failed-traces",
    dependencies=[Depends(require_api_key(scope="admin"))],
)
def get_failed_traces(request: Request, run_id: str):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="History store not available")
    
    traces = history_store.get_failed_traces(run_id)
    return traces

# --- Rate limiting (basic token bucket per key) ---
from collections import defaultdict
import time
class RateLimiter:
    def __init__(self, capacity=10, fill_rate=1.0):
        self.capacity = capacity
        self.fill_rate = fill_rate
        self.tokens = defaultdict(lambda: capacity)
        self.last_update = defaultdict(time.time)

    def consume(self, key: str, tokens: int = 1) -> bool:
        now = time.time()
        elapsed = now - self.last_update[key]
        self.tokens[key] = min(self.capacity, self.tokens[key] + elapsed * self.fill_rate)
        self.last_update[key] = now
        
        if self.tokens[key] >= tokens:
            self.tokens[key] -= tokens
            return True
        return False

rate_limiter = RateLimiter(capacity=5, fill_rate=0.5)

def check_rate_limit(request: Request, api_key_info: dict = Depends(require_api_key(scope="admin"))):
    key_id = api_key_info["id"]
    if not rate_limiter.consume(str(key_id)):
        raise HTTPException(status_code=429, detail="Too Many Requests")


@results_router.get(
    "/benchmark-results/readiness",
    response_model=BenchmarkIngestionReadiness,
)
def benchmark_result_readiness(request: Request) -> BenchmarkIngestionReadiness | JSONResponse:
    """Verify auth, ingestion contract compatibility, and database reachability."""
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="History store not available")
    try:
        history_store.check_persistence_readiness()
    except Exception as exc:
        error_id = str(uuid4())
        logger.exception(
            "Benchmark ingestion readiness failed error_id=%s error_type=%s",
            error_id,
            type(exc).__name__,
        )
        return _ingestion_error_response(
            status_code=503,
            error_code="persistence_unavailable",
            message="Benchmark result storage is not reachable.",
            error_id=error_id,
        )
    return BenchmarkIngestionReadiness(
        contract_version=4,
        git_revision=request.app.state.settings.git_revision,
    )


@results_router.post("/benchmark-results", status_code=201)
def submit_results(
        payload: dict,
        request: Request,
        api_key_info: dict = Depends(check_rate_limit),
):
    try:
        validated_payload = BenchmarkRunSubmission.model_validate(payload)
    except ValidationError as exc:
        issues = []
        for issue in exc.errors(include_input=False, include_context=False):
            location = ".".join(str(part) for part in issue.get("loc", ())) or "payload"
            issues.append(f"{location}: {issue.get('msg', 'invalid value')}")
        error_id = str(uuid4())
        return _ingestion_error_response(
            status_code=422,
            error_code="invalid_submission",
            message="Validation error: " + "; ".join(issues[:10]),
            error_id=error_id,
        )

    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="History store not available")

    submission_id = validated_payload.submission_id
    summary = validated_payload.model_dump(exclude_none=True, mode="json")
    submission_payload_hash = hashlib.sha256(
        json.dumps(summary, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    if submission_id is not None:
        existing = history_store.find_run_by_submission_id(submission_id)
        if existing is not None:
            if existing.submission_payload_hash != submission_payload_hash:
                error_id = str(uuid4())
                return _ingestion_error_response(
                    status_code=409,
                    error_code="submission_identity_conflict",
                    message="The submission identity is already bound to a different payload.",
                    error_id=error_id,
                )
            return {"status": "already_created", "id": existing.id}

    # Insert it
    try:
        summary["submission_payload_hash"] = submission_payload_hash
        samples = summary.pop("samples", None)
        point = history_store.record_summary(
            summary=summary,
            samples=samples,
        )
        return {"status": "created", "id": point.id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except IntegrityError as exc:
        if submission_id is not None:
            existing = history_store.find_run_by_submission_id(submission_id)
            if existing is not None:
                if existing.submission_payload_hash != submission_payload_hash:
                    error_id = str(uuid4())
                    return _ingestion_error_response(
                        status_code=409,
                        error_code="submission_identity_conflict",
                        message="The submission identity is already bound to a different payload.",
                        error_id=error_id,
                    )
                return {"status": "already_created", "id": existing.id}
        error_id = str(uuid4())
        logger.exception(
            "Benchmark persistence integrity conflict error_id=%s error_type=%s model=%r category=%r",
            error_id,
            type(exc).__name__,
            payload.get("model"),
            payload.get("prompt_category"),
        )
        return _ingestion_error_response(
            status_code=409,
            error_code="persistence_integrity_conflict",
            message=(
                "The database rejected this benchmark identity. Keep the fallback file "
                "and inspect the backend log using the error ID."
            ),
            error_id=error_id,
        )
    except (OperationalError, DBAPIError, TimeoutError) as exc:
        error_id = str(uuid4())
        logger.exception(
            "Benchmark persistence unavailable error_id=%s error_type=%s model=%r category=%r",
            error_id,
            type(exc).__name__,
            payload.get("model"),
            payload.get("prompt_category"),
        )
        return _ingestion_error_response(
            status_code=503,
            error_code="persistence_unavailable",
            message="Benchmark result storage is temporarily unavailable.",
            error_id=error_id,
        )
    except Exception as exc:
        error_id = str(uuid4())
        logger.exception(
            "Unexpected benchmark persistence failure error_id=%s error_type=%s model=%r category=%r",
            error_id,
            type(exc).__name__,
            payload.get("model"),
            payload.get("prompt_category"),
        )
        return _ingestion_error_response(
            status_code=500,
            error_code="persistence_failed",
            message="Unexpected benchmark persistence failure.",
            error_id=error_id,
        )


@results_router.delete("/benchmark-results/by-tag")
def delete_benchmark_results_by_tag(
    request: Request,
    experiment_tag: str = Query(..., min_length=1, description="Exact experiment_tag to wipe"),
) -> dict:
    """Bulk-delete all benchmark history rows with the given experiment_tag (Admin only).

    Child rows in run_deep_metrics, failed_traces, and run_samples are removed
    automatically by CASCADE. Returns the number of deleted parent rows.
    """
    history_store = request.app.state.history_store
    if history_store is None:
        raise HTTPException(status_code=503, detail="History store not available")
    deleted = history_store.delete_runs_by_experiment_tag(experiment_tag)
    return {"deleted": deleted, "experiment_tag": experiment_tag}
