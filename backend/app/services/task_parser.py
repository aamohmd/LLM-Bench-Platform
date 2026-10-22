"""Global Task Suite Parser.

Parses, normalizes, and validates the Global JSON Format containing:
1. Category Metadata (suite details, default tolerance, default task type, system prompt)
2. Content (the list of benchmark tasks)

Supports structured envelopes and legacy backwards-compatible files.
"""

from __future__ import annotations

import json
import math
from typing import Any
from pydantic import BaseModel, Field
from benchmark_scoring import catalog, validate_task


CANONICAL_CATEGORIES: set[str] = set()

CATEGORY_ALIASES: dict[str, str] = {}

VALID_TASK_TYPES = {entry["id"] for entry in catalog()}


class CategoryMetadata(BaseModel):
    category_id: str
    suite_id: str | None = None
    parent_suite_id: str | None = None
    suite_name: str | None = None
    domain: str | None = "general"
    display_name: str | None = None
    description: str | None = None
    language: str = "en"
    default_task_type: str = "numeric_tolerance"
    default_tolerance: dict[str, Any] | None = Field(
        default_factory=lambda: {"relative": 0.001, "absolute_floor": 0.005}
    )
    system_prompt: str | None = None
    attribution: str | None = None
    source_dataset: str | None = None
    license: str | None = None
    status: str = "approval_ready"
    is_required: bool | None = None


class TaskItem(BaseModel):
    id: str
    suite_id: str | None = None
    suite_name: str | None = None
    domain: str | None = "general"
    category_id: str
    prompt: str
    expected_answer: Any
    task_type: str
    bucket: str = "general"
    language: str = "en"
    tolerance: dict[str, Any] | None = None
    scoring_config: dict[str, Any] | None = None
    program: str | None = None


class TaskParseDiagnostic(BaseModel):
    task_index: int
    task_id: str | None = None
    field: str
    error: str


class TaskSuiteParseResult(BaseModel):
    is_valid: bool
    suite_id: str | None = None
    suite_name: str | None = None
    domain: str | None = "general"
    category_metadata: CategoryMetadata | None = None
    tasks: list[TaskItem] = Field(default_factory=list)
    total_found: int = 0
    valid_count: int = 0
    errors: list[TaskParseDiagnostic] = Field(default_factory=list)


def normalize_category_id(raw_id: str | None) -> str | None:
    if not raw_id or not isinstance(raw_id, str):
        return None
    normalized = raw_id.strip().lower().replace(" ", "_")
    return CATEGORY_ALIASES.get(normalized, normalized)


def parse_global_task_suite(raw_input: dict[str, Any] | str) -> TaskSuiteParseResult:
    """Parses and validates a task suite JSON payload."""
    errors: list[TaskParseDiagnostic] = []

    if isinstance(raw_input, str):
        try:
            data = json.loads(raw_input)
        except Exception as e:
            return TaskSuiteParseResult(
                is_valid=False,
                errors=[TaskParseDiagnostic(task_index=-1, field="root", error=f"Invalid JSON: {e}")],
            )
    elif isinstance(raw_input, dict):
        data = raw_input
    else:
        return TaskSuiteParseResult(
            is_valid=False,
            errors=[TaskParseDiagnostic(task_index=-1, field="root", error="Input must be a JSON object")],
        )

    # 1. Resolve Category Metadata
    raw_meta = data.get("category_metadata")
    if not isinstance(raw_meta, dict):
        # Fallback to flattened metadata at root
        raw_meta = {
            k: v for k, v in data.items()
            if k not in ("content", "tasks")
        }

    raw_suite_id = (
        raw_meta.get("suite_id")
        or data.get("suite_id")
        or raw_meta.get("category_id")
        or data.get("category_id")
    )
    raw_suite_name = (
        raw_meta.get("suite_name")
        or data.get("suite_name")
        or raw_meta.get("name")
        or data.get("name")
        or raw_meta.get("benchmark_name")
        or data.get("benchmark_name")
        or raw_meta.get("display_name")
    )
    raw_domain = (
        raw_meta.get("domain")
        or data.get("domain")
        or raw_meta.get("category_id")
        or data.get("category_id")
    )
    norm_cat_id = normalize_category_id(raw_domain or raw_suite_id) or "general"

    suite_id = str(raw_suite_id or norm_cat_id).strip().lower().replace(" ", "_")
    suite_name = str(raw_suite_name or suite_id.replace("_", " ").title()).strip()
    domain = str(raw_domain or norm_cat_id).strip().lower()

    category_metadata = CategoryMetadata(
        category_id=norm_cat_id,
        suite_id=suite_id,
        parent_suite_id=raw_meta.get("parent_suite_id") or data.get("parent_suite_id"),
        suite_name=suite_name,
        domain=domain,
        display_name=suite_name,
        description=raw_meta.get("description"),
        language=raw_meta.get("language", "en"),
        default_task_type=raw_meta.get("default_task_type") or "grounded_answer",
        default_tolerance=raw_meta.get("default_tolerance") or raw_meta.get("tolerance") or {"relative": 0.001, "absolute_floor": 0.005},
        system_prompt=raw_meta.get("system_prompt"),
        attribution=raw_meta.get("attribution"),
        source_dataset=raw_meta.get("source_dataset"),
        license=raw_meta.get("license"),
        status=raw_meta.get("status", "approval_ready"),
        is_required=raw_meta.get("is_required", data.get("is_required")),
    )

    # 2. Extract Tasks / Content
    raw_tasks = data.get("content")
    if raw_tasks is None:
        raw_tasks = data.get("tasks")

    if not isinstance(raw_tasks, list):
        return TaskSuiteParseResult(
            is_valid=False,
            suite_id=suite_id,
            suite_name=suite_name,
            domain=domain,
            category_metadata=category_metadata,
            errors=[TaskParseDiagnostic(task_index=-1, field="content", error="Missing 'content' or 'tasks' list")],
        )

    validated_tasks: list[TaskItem] = []
    seen_ids: set[str] = set()

    for idx, item in enumerate(raw_tasks):
        if not isinstance(item, dict):
            errors.append(TaskParseDiagnostic(task_index=idx, field="item", error="Task entry must be an object"))
            continue

        # ID
        task_id = item.get("id")
        if not task_id or not isinstance(task_id, str):
            errors.append(TaskParseDiagnostic(task_index=idx, field="id", error="Missing or non-string 'id'"))
            continue
        task_id = task_id.strip()
        if task_id in seen_ids:
            errors.append(TaskParseDiagnostic(task_index=idx, task_id=task_id, field="id", error=f"Duplicate task ID '{task_id}' in batch"))
            continue
        seen_ids.add(task_id)

        # Prompt
        prompt = item.get("prompt")
        if not prompt or not isinstance(prompt, str) or not prompt.strip():
            errors.append(TaskParseDiagnostic(task_index=idx, task_id=task_id, field="prompt", error="Prompt must be a non-empty string"))
            continue

        # Task Type
        raw_task_type = item.get("task_type") or category_metadata.default_task_type
        if raw_task_type not in VALID_TASK_TYPES:
            errors.append(TaskParseDiagnostic(
                task_index=idx,
                task_id=task_id,
                field="task_type",
                error=f"Unsupported task_type '{raw_task_type}'. Valid types: {sorted(VALID_TASK_TYPES)}",
            ))
            continue

        # Category
        task_cat = normalize_category_id(item.get("category_id") or item.get("task_category")) or category_metadata.category_id

        # Language
        task_lang = item.get("language") or category_metadata.language

        # Expected Answer
        expected_answer = item.get("expected_answer")
        if expected_answer is None:
            expected_answer = (
                item.get("expected_json")
                if item.get("expected_json") is not None
                else (
                    item.get("expected_safe_behavior")
                    if item.get("expected_safe_behavior") is not None
                    else (
                        item.get("reference_answer")
                        if item.get("reference_answer") is not None
                        else item.get("answer")
                    )
                )
            )
        if expected_answer is None:
            errors.append(TaskParseDiagnostic(task_index=idx, task_id=task_id, field="expected_answer", error="Missing 'expected_answer'"))
            continue

        # Answer type sanity checks
        if raw_task_type in ("numeric_tolerance", "numeric_exact"):
            try:
                if isinstance(expected_answer, bool):
                    raise ValueError("Boolean is not a numeric reference")
                num_val = float(expected_answer)
                if not math.isfinite(num_val):
                    raise ValueError("Non-finite number")
                expected_answer = num_val
            except (ValueError, TypeError):
                errors.append(TaskParseDiagnostic(
                    task_index=idx,
                    task_id=task_id,
                    field="expected_answer",
                    error=f"Task type '{raw_task_type}' requires finite numeric expected_answer (got {expected_answer!r})",
                ))
                continue

        # Tolerance
        tolerance = item.get("tolerance")
        if not tolerance and raw_task_type == "numeric_tolerance":
            tolerance = category_metadata.default_tolerance

        # Bucket
        bucket = item.get("bucket") or "general"

        # Preserve scorer parameters without maintaining a second parameter list.
        scoring_config = item.get("scoring_config")
        if scoring_config is not None and not isinstance(scoring_config, dict):
            errors.append(TaskParseDiagnostic(task_index=idx, task_id=task_id, field="scoring_config", error="scoring_config must be an object"))
            continue
        scoring_config = dict(scoring_config or {})
        standard_keys = set(TaskItem.model_fields) | {"task_category", "expected_json", "expected_safe_behavior", "reference_answer", "answer"}
        for key, value in item.items():
            if key not in standard_keys and key not in scoring_config:
                scoring_config[key] = value
        try:
            validate_task({"task_type": raw_task_type, "expected_answer": expected_answer, "tolerance": tolerance, "scoring_config": scoring_config})
        except ValueError as exc:
            errors.append(TaskParseDiagnostic(task_index=idx, task_id=task_id, field="scoring_config", error=str(exc)))
            continue

        validated_tasks.append(
            TaskItem(
                id=task_id,
                suite_id=item.get("suite_id") or suite_id,
                suite_name=item.get("suite_name") or suite_name,
                domain=item.get("domain") or domain,
                category_id=task_cat,
                prompt=prompt,
                expected_answer=expected_answer,
                task_type=raw_task_type,
                bucket=bucket,
                language=task_lang,
                tolerance=tolerance,
                scoring_config=scoring_config,
                program=item.get("program"),
            )
        )

    is_valid = len(errors) == 0 and len(validated_tasks) > 0

    return TaskSuiteParseResult(
        is_valid=is_valid,
        suite_id=suite_id,
        suite_name=suite_name,
        domain=domain,
        category_metadata=category_metadata,
        tasks=validated_tasks,
        total_found=len(raw_tasks),
        valid_count=len(validated_tasks),
        errors=errors,
    )
