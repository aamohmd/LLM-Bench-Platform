"""Merge the deployed product-revision branch with the universal registry.

Revision ID: 0033_reconcile_legacy_heads
Revises: 0031_remove_product_versions, 0032_remove_product_versions
"""

from uuid import uuid4

import sqlalchemy as sa
from alembic import op


revision = "0033_reconcile_legacy_heads"
down_revision = ("0031_remove_product_versions", "0032_remove_product_versions")
branch_labels = None
depends_on = None


def _restore_prompt_snapshots(bind: sa.Connection) -> None:
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "prompts" not in tables:
        return

    if "prompt_versions" not in tables:
        op.create_table(
            "prompt_versions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "prompt_id",
                sa.String(36),
                sa.ForeignKey("prompts.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("system_prompt", sa.Text(), nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "prompt_id",
                "version",
                name="uq_prompt_versions_prompt_version",
            ),
        )

    prompt_columns = {column["name"] for column in inspector.get_columns("prompts")}
    if {"system_prompt", "content_hash"}.issubset(prompt_columns):
        rows = bind.execute(
            sa.text(
                "SELECT p.id, p.system_prompt, p.content_hash, p.created_at "
                "FROM prompts p "
                "WHERE NOT EXISTS ("
                "SELECT 1 FROM prompt_versions pv WHERE pv.prompt_id = p.id"
                ")"
            )
        ).mappings()
        for row in rows:
            bind.execute(
                sa.text(
                    "INSERT INTO prompt_versions "
                    "(id, prompt_id, version, system_prompt, content_hash, created_at) "
                    "VALUES (:id, :prompt_id, 1, :system_prompt, :content_hash, :created_at)"
                ),
                {
                    "id": str(uuid4()),
                    "prompt_id": row["id"],
                    "system_prompt": row["system_prompt"] or "",
                    "content_hash": row["content_hash"] or "",
                    "created_at": row["created_at"],
                },
            )

        with op.batch_alter_table("prompts") as batch_op:
            batch_op.drop_column("content_hash")
            batch_op.drop_column("system_prompt")

    inspector = sa.inspect(bind)
    unique_constraints = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints("prompt_versions")
    }
    if "uq_prompt_versions_prompt_version" not in unique_constraints:
        with op.batch_alter_table("prompt_versions") as batch_op:
            batch_op.create_unique_constraint(
                "uq_prompt_versions_prompt_version",
                ["prompt_id", "version"],
            )

    prompt_indexes = {
        index["name"] for index in sa.inspect(bind).get_indexes("prompt_versions")
    }
    if "ix_prompt_versions_prompt_id" not in prompt_indexes:
        op.create_index(
            "ix_prompt_versions_prompt_id",
            "prompt_versions",
            ["prompt_id"],
        )


def _normalize_task_indexes(bind: sa.Connection) -> None:
    inspector = sa.inspect(bind)
    if "benchmark_tasks" not in inspector.get_table_names():
        return

    indexes = {index["name"] for index in inspector.get_indexes("benchmark_tasks")}
    primary_key_name = inspector.get_pk_constraint("benchmark_tasks").get("name")
    if bind.dialect.name == "postgresql" and primary_key_name == "banking_tasks_pkey":
        op.execute(
            "ALTER TABLE benchmark_tasks "
            "RENAME CONSTRAINT banking_tasks_pkey TO benchmark_tasks_pkey"
        )
    columns = ("category_id", "created_at", "suite_id", "task_type")
    for column in columns:
        legacy_name = f"ix_banking_tasks_{column}"
        current_name = f"ix_benchmark_tasks_{column}"
        if legacy_name in indexes:
            op.drop_index(legacy_name, table_name="benchmark_tasks")
        if current_name not in indexes:
            op.create_index(current_name, "benchmark_tasks", [column])


def _ensure_scorecard_index(bind: sa.Connection) -> None:
    inspector = sa.inspect(bind)
    if "benchmark_history" not in inspector.get_table_names():
        return
    indexes = {index["name"] for index in inspector.get_indexes("benchmark_history")}
    if "ix_benchmark_scorecard_partition" not in indexes:
        op.create_index(
            "ix_benchmark_scorecard_partition",
            "benchmark_history",
            [
                "concurrency",
                "model",
                "framework",
                "prompt_category",
                "quality_score",
                "created_at",
            ],
        )


def upgrade() -> None:
    bind = op.get_bind()
    _restore_prompt_snapshots(bind)
    _normalize_task_indexes(bind)
    _ensure_scorecard_index(bind)

    inspector = sa.inspect(bind)
    if "benchmark_history" in inspector.get_table_names():
        history_columns = {
            column["name"] for column in inspector.get_columns("benchmark_history")
        }
        if "prompt_version" not in history_columns:
            op.add_column(
                "benchmark_history",
                sa.Column("prompt_version", sa.Integer(), nullable=True),
            )


def downgrade() -> None:
    # This merge revision only repairs compatibility with an already-deployed
    # branch. Downgrading must not discard recovered prompt snapshots.
    pass
