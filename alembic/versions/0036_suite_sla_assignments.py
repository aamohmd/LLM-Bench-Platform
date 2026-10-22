"""Make reusable SLA policies assignable from benchmark suites.

Revision ID: 0036_suite_sla_assignments
Revises: 0035_submission_idempotency
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0036_suite_sla_assignments"
down_revision = "0035_submission_idempotency"
branch_labels = None
depends_on = None


def _deduplicate_criteria_names(bind: sa.Connection) -> None:
    rows = bind.execute(
        sa.text("SELECT id, name FROM scorecard_criteria ORDER BY created_at, id")
    ).mappings()
    used: set[str] = set()
    for row in rows:
        base = (row["name"] or row["id"]).strip()
        candidate = base
        suffix = 2
        while candidate.casefold() in used:
            candidate = f"{base} ({suffix})"
            suffix += 1
        used.add(candidate.casefold())
        if candidate != row["name"]:
            bind.execute(
                sa.text("UPDATE scorecard_criteria SET name = :name WHERE id = :id"),
                {"id": row["id"], "name": candidate},
            )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    suite_columns = {column["name"] for column in inspector.get_columns("benchmark_suites")}

    if "sla_criteria_id" not in suite_columns:
        with op.batch_alter_table("benchmark_suites") as batch_op:
            batch_op.add_column(sa.Column("sla_criteria_id", sa.String(64), nullable=True))
            batch_op.create_foreign_key(
                "fk_benchmark_suites_sla_criteria_id",
                "scorecard_criteria",
                ["sla_criteria_id"],
                ["id"],
                ondelete="RESTRICT",
            )
            batch_op.create_index("ix_benchmark_suites_sla_criteria_id", ["sla_criteria_id"])

    bind.execute(sa.text("""
        UPDATE benchmark_suites
        SET sla_criteria_id = (
            SELECT criteria.id
            FROM scorecard_criteria AS criteria
            WHERE COALESCE(criteria.scoreboard_suite_id, criteria.suite_id) = benchmark_suites.id
            ORDER BY criteria.is_default DESC, criteria.id ASC
            LIMIT 1
        )
        WHERE parent_suite_id = id
          AND sla_criteria_id IS NULL
    """))

    _deduplicate_criteria_names(bind)
    # SQLite does not reliably reflect expression indexes, so use the
    # idempotent form supported by both SQLite and PostgreSQL.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_scorecard_criteria_name_ci "
        "ON scorecard_criteria (lower(name))"
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    op.execute("DROP INDEX IF EXISTS uq_scorecard_criteria_name_ci")

    suite_columns = {column["name"] for column in sa.inspect(bind).get_columns("benchmark_suites")}
    if "sla_criteria_id" in suite_columns:
        with op.batch_alter_table("benchmark_suites") as batch_op:
            batch_op.drop_index("ix_benchmark_suites_sla_criteria_id")
            batch_op.drop_constraint("fk_benchmark_suites_sla_criteria_id", type_="foreignkey")
            batch_op.drop_column("sla_criteria_id")
