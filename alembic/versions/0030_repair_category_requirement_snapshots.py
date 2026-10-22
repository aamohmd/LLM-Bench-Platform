"""Repair the initial category requirement snapshot backfill.

Revision ID: 0030_repair_category_snapshots
Revises: 0029_category_score_snapshots
"""

import json

from alembic import op
import sqlalchemy as sa

revision = "0030_repair_category_snapshots"
down_revision = "0029_category_score_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("""
        UPDATE benchmark_suites
        SET is_required = false
        WHERE parent_suite_id IS NOT NULL
          AND parent_suite_id <> id
          AND NOT EXISTS (
              SELECT 1 FROM banking_tasks WHERE banking_tasks.suite_id = benchmark_suites.id
          )
    """))

    suites = list(bind.execute(sa.text("""
        SELECT child.id, child.parent_suite_id, child.name, child.task_count, child.is_required,
               COUNT(task.id) AS live_task_count
        FROM benchmark_suites child
        LEFT JOIN banking_tasks task ON task.suite_id = child.id
        WHERE child.parent_suite_id IS NOT NULL AND child.parent_suite_id <> child.id
        GROUP BY child.id, child.parent_suite_id, child.name, child.task_count, child.is_required
        ORDER BY child.parent_suite_id, child.name
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
                WHERE scoreboard_suite_id = :parent_id
            """),
            {"value": json.dumps(snapshot), "parent_id": parent_id},
        )


def downgrade() -> None:
    # This migration corrects data written by the immediately preceding
    # backfill. Reintroducing the incorrect snapshot has no safe downgrade.
    pass
