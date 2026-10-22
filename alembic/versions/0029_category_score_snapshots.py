"""Persist compact category aggregates and immutable suite-category snapshots.

Revision ID: 0029_category_score_snapshots
Revises: 0028_add_suite_required_flag
"""

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0029_category_score_snapshots"
down_revision = "0028_add_suite_required_flag"
branch_labels = None
depends_on = None


def _aggregate_task_scores(raw: str | None) -> dict[str, dict]:
    if not raw:
        return {}
    try:
        task_scores = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    aggregates: dict[str, dict] = {}
    for task in task_scores.values():
        rubric = task.get("rubric") if isinstance(task.get("rubric"), dict) else {}
        category_id = rubric.get("category_id") or task.get("task_category") or "unknown"
        if category_id == "unknown":
            continue
        item = aggregates.setdefault(category_id, {"success_count": 0, "failed_count": 0, "total_count": 0})
        item["total_count"] += 1
        if task.get("score") == 1.0:
            item["success_count"] += 1
        else:
            item["failed_count"] += 1
    for item in aggregates.values():
        item["score"] = item["success_count"] / item["total_count"] if item["total_count"] else None
    return aggregates


def upgrade() -> None:
    bind = op.get_bind()
    suite_indexes = {index["name"] for index in inspect(bind).get_indexes("benchmark_suites")}
    if "ix_benchmark_suites_is_required" not in suite_indexes:
        op.create_index("ix_benchmark_suites_is_required", "benchmark_suites", ["is_required"])
    bind.execute(sa.text("""
        UPDATE benchmark_suites
        SET is_required = false
        WHERE parent_suite_id IS NOT NULL
          AND parent_suite_id <> id
          AND NOT EXISTS (
              SELECT 1 FROM banking_tasks WHERE banking_tasks.suite_id = benchmark_suites.id
          )
    """))
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "category_results" not in columns:
        op.add_column("benchmark_history", sa.Column("category_results", sa.Text(), nullable=True))
    if "suite_category_snapshot" not in columns:
        op.add_column("benchmark_history", sa.Column("suite_category_snapshot", sa.Text(), nullable=True))

    rows = bind.execute(sa.text("SELECT id, task_scores FROM benchmark_history WHERE task_scores IS NOT NULL")).mappings()
    for row in rows:
        aggregates = _aggregate_task_scores(row["task_scores"])
        if aggregates:
            bind.execute(
                sa.text("UPDATE benchmark_history SET category_results = :value WHERE id = :id"),
                {"value": json.dumps(aggregates), "id": row["id"]},
            )

    suites = list(bind.execute(sa.text("""
        SELECT child.id, child.parent_suite_id, child.name, child.task_count, child.is_required,
               COUNT(task.id) AS live_task_count
        FROM benchmark_suites child
        LEFT JOIN banking_tasks task ON task.suite_id = child.id
        WHERE child.parent_suite_id IS NOT NULL AND child.parent_suite_id <> child.id
        GROUP BY child.id, child.parent_suite_id, child.name, child.task_count, child.is_required
    """)).mappings())
    snapshots: dict[str, list[dict]] = {}
    for suite in suites:
        snapshots.setdefault(suite["parent_suite_id"], []).append({
            "id": suite["id"],
            "name": suite["name"],
            "task_count": int(suite["live_task_count"] or suite["task_count"] or 0),
            "is_required": bool(suite["is_required"]),
        })
    for parent_id, snapshot in snapshots.items():
        bind.execute(
            sa.text("""
                UPDATE benchmark_history
                SET suite_category_snapshot = :value
                WHERE scoreboard_suite_id = :parent_id AND suite_category_snapshot IS NULL
            """),
            {"value": json.dumps(snapshot), "parent_id": parent_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "suite_category_snapshot" in columns:
        op.drop_column("benchmark_history", "suite_category_snapshot")
    if "category_results" in columns:
        op.drop_column("benchmark_history", "category_results")
