"""Router for Generic Tasks Management, Benchmark Suites, and Dynamic Scorecard Criteria."""

from __future__ import annotations
from backend.app.routers.registry_deletion import registry_deletion

import csv
import io
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, status

from backend.app.core.auth import require_api_key
from backend.app.schemas import (
    BenchmarkSuiteCreate,
    BenchmarkSuiteDetail,
    BenchmarkSuiteSchema,
    ScorecardCriteriaCreate,
    ScorecardCriteriaAssignment,
    ScorecardCriteriaSchema,
    ScorecardCriteriaUpdate,
    TaskCreate,
    TaskListResponse,
    TaskSchema,
    TaskSummaryResponse,
)
from backend.app.services.task_parser import VALID_TASK_TYPES, normalize_category_id, parse_global_task_suite
from benchmark_scoring.registry import catalog, fingerprint, validate_task

router = APIRouter(tags=["Task Management, Benchmark Suites & Scorecard Criteria"])


def _csv_json_cell(value: str | None) -> Any:
    if value is None or not value.strip():
        return None
    value = value.strip()
    if value[:1] not in ("{", "["):
        return value
    try:
        return json.loads(value)
    except ValueError:
        return value


def _csv_suite_payload(content: str) -> dict[str, Any]:
    rows = list(csv.DictReader(io.StringIO(content)))
    if not rows:
        return {"category_metadata": {"category_id": "general"}, "tasks": []}
    first = rows[0]
    suite_id = first.get("suite_id") or first.get("category_id") or first.get("task_category")
    suite_name = first.get("suite_name") or first.get("display_name") or first.get("name") or suite_id
    tasks: list[dict[str, Any]] = []
    for row in rows:
        tolerance = _csv_json_cell(row.get("tolerance"))
        if not tolerance and row.get("relative_tolerance"):
            try:
                tolerance = {
                    "relative": float(row["relative_tolerance"]),
                    "absolute_floor": float(row.get("absolute_floor") or 0.005),
                }
            except (TypeError, ValueError):
                tolerance = None
        tasks.append({
            "id": row.get("id") or row.get("task_id"),
            "suite_id": row.get("suite_id") or suite_id,
            "suite_name": row.get("suite_name") or suite_name,
            "domain": row.get("domain") or first.get("domain") or "general",
            "category_id": row.get("category_id") or row.get("task_category") or suite_id,
            "prompt": row.get("prompt"),
            "expected_answer": _csv_json_cell(row.get("expected_answer") or row.get("answer") or row.get("reference_answer")),
            "task_type": row.get("task_type") or first.get("default_task_type") or "grounded_answer",
            "bucket": row.get("bucket") or "general",
            "language": row.get("language") or first.get("language") or "en",
            "tolerance": tolerance,
            "scoring_config": _csv_json_cell(row.get("scoring_config")),
            "program": row.get("program") or None,
        })
    raw_required = (first.get("is_required") or "").strip().lower()
    return {
        "suite_id": suite_id,
        "suite_name": suite_name,
        "domain": first.get("domain") or "general",
        "parent_suite_id": first.get("parent_suite_id") or None,
        "is_required": raw_required in {"true", "1", "yes"} if raw_required else None,
        "category_metadata": {
            "category_id": suite_id or "general",
            "suite_id": suite_id,
            "suite_name": suite_name,
            "domain": first.get("domain") or "general",
            "parent_suite_id": first.get("parent_suite_id") or None,
            "description": first.get("description") or None,
            "language": first.get("language") or "en",
            "default_task_type": first.get("default_task_type") or first.get("task_type") or "grounded_answer",
            "is_required": raw_required in {"true", "1", "yes"} if raw_required else None,
        },
        "tasks": tasks,
    }


def _category_target(history_store, suite_id: str | None) -> dict[str, Any]:
    if not suite_id:
        raise HTTPException(status_code=422, detail="A category suite_id is required")
    suite = history_store.get_benchmark_suite(suite_id)
    if not suite:
        suite = history_store.get_category_suite_by_domain(suite_id)
    if not suite:
        raise HTTPException(status_code=422, detail=f"Category '{suite_id}' does not exist")
    if suite.get("parent_suite_id") == suite_id:
        raise HTTPException(status_code=422, detail="Questions cannot be stored directly on a parent suite")
    return suite


# ---------------------------------------------------------------------------
# Generic task endpoints
# ---------------------------------------------------------------------------

@router.get("/scorers", response_model=list[str])
def list_scorers(auth: dict = Depends(require_api_key("admin"))):
    """Available shared scorer implementations; task parameters use the task API."""
    return sorted(VALID_TASK_TYPES)


@router.get("/scorers/catalog")
def scorer_catalog(auth: dict = Depends(require_api_key("admin"))):
    """Descriptions, examples and implementation identity from runnable scorers."""
    return {"fingerprint": fingerprint(), "scorers": catalog()}


@router.get("/tasks", response_model=TaskListResponse)
def list_tasks(
    request: Request,
    auth: dict = Depends(require_api_key("admin")),
    category_id: str | None = Query(None, description="Filter by category ID"),
    bucket: str | None = Query(None, description="Filter by task bucket"),
    search: str | None = Query(None, description="Search by task prompt or ID"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    tasks, total = history_store.list_tasks(
        category_id=category_id,
        bucket=bucket,
        search=search,
        offset=offset,
        limit=limit,
    )
    return TaskListResponse(tasks=tasks, total=total, offset=offset, limit=limit)


@router.get("/tasks/summary", response_model=TaskSummaryResponse)
def get_tasks_summary(
    request: Request,
    auth: dict = Depends(require_api_key("admin")),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    categories = history_store.get_task_summary()
    total = sum(categories.values())
    return TaskSummaryResponse(total_tasks=total, categories=categories)


@router.get("/tasks/{task_id}", response_model=TaskSchema)
def get_task(
    request: Request,
    task_id: str,
    auth: dict = Depends(require_api_key("admin")),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    task = history_store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    return task


@router.post("/tasks", response_model=TaskSchema, status_code=status.HTTP_201_CREATED)
def create_task(
    request: Request,
    task: TaskCreate,
    auth: dict = Depends(require_api_key("admin")),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    category = _category_target(history_store, task.suite_id or task.category_id)
    suite_id = category["id"]
    payload = task.model_dump()
    cat_id = task.category_id or category.get("domain") or normalize_category_id(suite_id) or suite_id
    payload.update({
        "suite_id": suite_id,
        "suite_name": category["name"],
        "domain": category["domain"],
        "category_id": cat_id,
    })
    created = history_store.upsert_task(payload)
    return created


@router.post("/tasks/upload")
async def upload_tasks(
    request: Request,
    file: UploadFile | None = File(None),
    auth: dict = Depends(require_api_key("admin")),
):
    """Uploads a task suite in Global JSON format (metadata + content) or CSV."""
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    content_str = ""
    is_csv = False

    if file:
        filename = file.filename or ""
        is_csv = filename.endswith(".csv")
        file_bytes = await file.read()
        try:
            content_str = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            content_str = file_bytes.decode("latin-1")
    else:
        # Check raw json body
        try:
            raw_body = await request.body()
            content_str = raw_body.decode("utf-8")
        except Exception:
            raise HTTPException(status_code=400, detail="Missing file or JSON payload")

    if not content_str.strip():
        raise HTTPException(status_code=400, detail="Empty upload payload")

    # CSV Parsing bridge into Global JSON
    if is_csv:
        parsed = parse_global_task_suite(_csv_suite_payload(content_str))
    else:
        parsed = parse_global_task_suite(content_str)

    if not parsed.is_valid:
        diagnostics = [d.model_dump() for d in parsed.errors]
        return {
            "success": False,
            "error": "Task suite validation failed",
            "diagnostics": diagnostics,
            "valid_count": parsed.valid_count,
            "total_found": parsed.total_found,
        }

    category = _category_target(history_store, parsed.suite_id)
    suite_id = category["id"]
    tasks_dicts = []
    for task in parsed.tasks:
        payload = task.model_dump()
        cat_id = (
            task.category_id
            or (parsed.category_metadata.category_id if parsed.category_metadata else None)
            or category.get("domain")
            or normalize_category_id(suite_id)
            or suite_id
        )
        payload.update({
            "suite_id": suite_id,
            "suite_name": category["name"],
            "domain": category["domain"],
            "category_id": cat_id,
        })
        tasks_dicts.append(payload)
    inserted, updated = history_store.bulk_insert_tasks(tasks_dicts)

    return {
        "success": True,
        "message": f"Successfully processed {len(tasks_dicts)} tasks ({inserted} inserted, {updated} updated)",
        "inserted": inserted,
        "updated": updated,
        "category_id": parsed.category_metadata.category_id if parsed.category_metadata else "general",
        "total_tasks": len(tasks_dicts),
    }


@router.delete("/tasks/{task_id}")
def delete_task(
    request: Request,
    task_id: str,
    auth: dict = Depends(require_api_key("admin")),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    deleted = history_store.delete_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    return {"deleted": True, "task_id": task_id}


@router.put("/tasks/{task_id}", response_model=TaskSchema)
def update_task(
    request: Request,
    task_id: str,
    task: TaskCreate,
    auth: dict = Depends(require_api_key("admin")),
):
    if task.id != task_id:
        raise HTTPException(status_code=400, detail="Task ID in path must match payload")
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if not history_store.get_task(task_id):
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    category = _category_target(history_store, task.suite_id or task.category_id)
    suite_id = category["id"]
    payload = task.model_dump()
    cat_id = task.category_id or category.get("domain") or normalize_category_id(suite_id) or suite_id
    payload.update({
        "suite_id": suite_id,
        "suite_name": category["name"],
        "domain": category["domain"],
        "category_id": cat_id,
    })
    return history_store.upsert_task(payload)


# ---------------------------------------------------------------------------
# Scorecard Criteria Endpoints
# ---------------------------------------------------------------------------

@router.get("/scorecard/criteria", response_model=list[ScorecardCriteriaSchema])
def list_scorecard_criteria(
    request: Request,
    auth: dict = Depends(require_api_key("admin")),
    suite_id: str | None = Query(None, description="Filter criteria by benchmark suite ID"),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    return history_store.list_scorecard_criteria(suite_id=suite_id)


@router.get("/scorecard/criteria/{criteria_id}", response_model=ScorecardCriteriaSchema)
def get_scorecard_criteria(
    request: Request,
    criteria_id: str,
    auth: dict = Depends(require_api_key("admin")),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    criteria = history_store.get_scorecard_criteria(criteria_id)
    if not criteria:
        raise HTTPException(status_code=404, detail=f"Criteria profile '{criteria_id}' not found")
    return criteria


@router.post("/scorecard/criteria", response_model=ScorecardCriteriaSchema, status_code=status.HTTP_201_CREATED)
def create_scorecard_criteria(
    request: Request,
    criteria: ScorecardCriteriaCreate,
    auth: dict = Depends(require_api_key("admin")),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    name = criteria.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="SLA policy name is required")
    if history_store.scorecard_criteria_name_exists(name):
        raise HTTPException(status_code=409, detail=f"An SLA policy named '{name}' already exists")
    data = criteria.model_dump()
    data["name"] = name
    data["is_locked"] = False
    created = history_store.upsert_scorecard_criteria(data)
    return created


@router.put("/scorecard/criteria/{criteria_id}", response_model=ScorecardCriteriaSchema)
def update_scorecard_criteria(
    request: Request,
    criteria_id: str,
    update: ScorecardCriteriaUpdate,
    auth: dict = Depends(require_api_key("admin")),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    existing = history_store.get_scorecard_criteria(criteria_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Criteria profile '{criteria_id}' not found")

    if update.name is not None:
        name = update.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="SLA policy name is required")
        if history_store.scorecard_criteria_name_exists(name, exclude_id=criteria_id):
            raise HTTPException(status_code=409, detail=f"An SLA policy named '{name}' already exists")
    data = update.model_dump(exclude_unset=True)
    if update.name is not None:
        data["name"] = update.name.strip()
    data["id"] = criteria_id
    updated = history_store.upsert_scorecard_criteria(data)
    return updated


@router.delete("/scorecard/criteria/{criteria_id}")
def delete_scorecard_criteria(
    request: Request,
    criteria_id: str,
    auth: dict = Depends(require_api_key("admin")),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        deleted = history_store.delete_scorecard_criteria(criteria_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Criteria profile '{criteria_id}' not found")
        return {"deleted": True, "criteria_id": criteria_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Benchmark Suites Endpoints
# ---------------------------------------------------------------------------

@router.post("/suites", response_model=BenchmarkSuiteSchema, status_code=status.HTTP_201_CREATED)
def create_benchmark_suite(
    request: Request,
    payload: BenchmarkSuiteCreate,
    auth: dict = Depends(require_api_key("admin")),
):
    """Create a parent suite or a category inside an existing parent suite."""
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if not payload.id:
        raise HTTPException(status_code=422, detail="Suite/category id is required")
    if history_store.get_benchmark_suite(payload.id):
        raise HTTPException(status_code=409, detail=f"Suite '{payload.id}' already exists")
    parent_id = payload.parent_suite_id or payload.id
    if parent_id != payload.id:
        parent = history_store.get_benchmark_suite(parent_id)
        if not parent or parent.get("parent_suite_id") != parent_id:
            raise HTTPException(status_code=422, detail=f"Parent suite '{parent_id}' does not exist")
        if "is_required" in payload.model_fields_set and payload.is_required:
            raise HTTPException(status_code=422, detail="Create an empty category as optional, then require it after tasks are added")
    data = payload.model_dump()
    data["parent_suite_id"] = parent_id
    if parent_id != payload.id:
        data["is_required"] = False
    return history_store.upsert_benchmark_suite(data)


@router.get("/suites", response_model=list[BenchmarkSuiteSchema])
def list_benchmark_suites(
    request: Request,
    auth: dict = Depends(require_api_key("admin")),
    domain: str | None = Query(None, description="Filter by domain or category"),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return history_store.list_benchmark_suites(domain=domain)


@router.get("/suites/{suite_id}", response_model=BenchmarkSuiteSchema)
def get_benchmark_suite(
    request: Request,
    suite_id: str,
    auth: dict = Depends(require_api_key("admin")),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")
    suite = history_store.get_benchmark_suite(suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail=f"Suite '{suite_id}' not found")
    return suite


@router.patch("/suites/{suite_id}/sla", response_model=BenchmarkSuiteSchema)
def assign_suite_sla(
    request: Request,
    suite_id: str,
    payload: ScorecardCriteriaAssignment,
    auth: dict = Depends(require_api_key("admin")),
):
    """Assign one reusable SLA policy to a parent scoreboard suite."""
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")
    try:
        return history_store.assign_suite_scorecard_criteria(suite_id, payload.criteria_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/suites/{suite_id}/execution")
def get_suite_execution(
    request: Request,
    suite_id: str,
    auth: dict = Depends(require_api_key("admin")),
):
    """Check shared-scorer compatibility on demand without changing stored tasks."""
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if not history_store.get_benchmark_suite(suite_id):
        raise HTTPException(status_code=404, detail=f"Suite '{suite_id}' not found")
    tasks = history_store.get_suite_tasks(suite_id)
    unsupported = sorted({str(task.get("task_type") or "<missing>") for task in tasks
                          if task.get("task_type") not in VALID_TASK_TYPES})
    invalid_tasks = []
    for task in tasks:
        try:
            validate_task(task)
        except ValueError as exc:
            invalid_tasks.append({"id": task.get("id"), "error": str(exc)})
    return {"suite_id": suite_id, "task_count": len(tasks), "runnable": bool(tasks) and not invalid_tasks,
            "unsupported_task_types": unsupported, "invalid_tasks": invalid_tasks}


@router.get("/suites/{suite_id}/tasks", response_model=list[TaskSchema])
def get_suite_tasks(
    request: Request,
    suite_id: str,
    auth: dict = Depends(require_api_key("admin")),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")
    tasks = history_store.get_suite_tasks(suite_id)
    return tasks


@router.post("/suites/upload")
async def upload_benchmark_suite(
    request: Request,
    file: UploadFile | None = File(None),
    auth: dict = Depends(require_api_key("admin")),
):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")

    raw_content = ""
    is_csv = False
    if file:
        is_csv = (file.filename or "").lower().endswith(".csv")
        content_bytes = await file.read()
        raw_content = content_bytes.decode("utf-8", errors="replace")
    else:
        try:
            body = await request.body()
            raw_content = body.decode("utf-8", errors="replace")
        except Exception:
            raise HTTPException(status_code=400, detail="No content received")
        is_csv = "text/csv" in (request.headers.get("content-type") or "").lower()

    parsed = parse_global_task_suite(_csv_suite_payload(raw_content) if is_csv else raw_content)
    if not parsed.tasks:
        return {
            "success": False,
            "error": "No valid tasks found in upload",
            "diagnostics": [d.model_dump() for d in parsed.errors],
        }

    if not parsed.suite_id:
        raise HTTPException(status_code=422, detail="Provide a category suite_id and its parent suite when importing tasks.")
    suite_id = parsed.suite_id
    suite_name = parsed.suite_name or suite_id.replace("_", " ").title()
    domain = parsed.domain or "general"
    meta = parsed.category_metadata
    existing = history_store.get_benchmark_suite(suite_id)
    parent_suite_id = meta.parent_suite_id if meta else None
    if not parent_suite_id and existing:
        parent_suite_id = existing.get("parent_suite_id")
    if not parent_suite_id or parent_suite_id == suite_id:
        raise HTTPException(
            status_code=422,
            detail="Question uploads must target a category inside an existing parent suite. Create the empty suite first.",
        )
    parent = history_store.get_benchmark_suite(parent_suite_id)
    if not parent or parent.get("parent_suite_id") != parent_suite_id:
        raise HTTPException(status_code=422, detail=f"Parent suite '{parent_suite_id}' does not exist")
    if existing and existing.get("parent_suite_id") != parent_suite_id:
        raise HTTPException(status_code=409, detail=f"Category '{suite_id}' already belongs to another suite")

    tasks_dict = []
    for t in parsed.tasks:
        td = t.model_dump()
        td["suite_id"] = suite_id
        td["suite_name"] = suite_name
        td["domain"] = domain
        td["category_id"] = normalize_category_id(suite_id) or suite_id
        tasks_dict.append(td)

    suite_record = {
        "id": suite_id,
        "parent_suite_id": parent_suite_id,
        "name": suite_name,
        "domain": domain,
        "description": meta.description if meta else None,
        "default_scorer": meta.default_task_type if meta else None,
        "default_tolerance": meta.default_tolerance if meta else None,
        "task_count": len(tasks_dict),
        "is_required": meta.is_required if meta and meta.is_required is not None else (existing.get("is_required", True) if existing else True),
        "is_active": True,
    }
    history_store.upsert_benchmark_suite(suite_record)
    inserted, updated = history_store.bulk_insert_tasks(tasks_dict)

    return {
        "success": True,
        "suite_id": suite_id,
        "suite_name": suite_name,
        "parent_suite_id": parent_suite_id,
        "domain": domain,
        "inserted": inserted,
        "updated": updated,
        "total_tasks": len(tasks_dict),
        "diagnostics": [d.model_dump() for d in parsed.errors],
    }


@router.delete("/suites/{suite_id}")
def delete_benchmark_suite(
    request: Request,
    suite_id: str,
    auth: dict = Depends(require_api_key("admin")),
    expected_run_count: int | None = Query(None, ge=0),
):
    return registry_deletion(request, "suite", suite_id, delete=True, expected_run_count=expected_run_count)


@router.get("/suites/{suite_id}/deletion-impact")
def suite_deletion_impact(request: Request, suite_id: str, auth: dict = Depends(require_api_key("admin"))):
    return registry_deletion(request, "suite", suite_id)


@router.put("/suites/{suite_id}", response_model=BenchmarkSuiteSchema)
def update_benchmark_suite(
    request: Request,
    suite_id: str,
    payload: BenchmarkSuiteCreate,
    auth: dict = Depends(require_api_key("admin")),
):
    """Update suite/category metadata without touching task or run history."""
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if payload.id and payload.id != suite_id:
        raise HTTPException(status_code=400, detail="Path suite_id does not match payload id")
    existing = history_store.get_benchmark_suite(suite_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Suite '{suite_id}' not found")
    if payload.parent_suite_id and payload.parent_suite_id != suite_id:
        parent = history_store.get_benchmark_suite(payload.parent_suite_id)
        if not parent or parent.get("parent_suite_id") != payload.parent_suite_id:
            raise HTTPException(status_code=422, detail=f"Parent suite '{payload.parent_suite_id}' does not exist")
    if "is_required" in payload.model_fields_set and payload.is_required is True and not history_store.get_suite_tasks(suite_id):
        raise HTTPException(status_code=422, detail="A category with no tasks cannot be required")
    data = payload.model_dump(exclude_unset=True)
    data.update({"id": suite_id, "name": payload.name or existing["name"]})
    return history_store.upsert_benchmark_suite(data)
