"""Add versioned prompt registry and immutable benchmark prompt provenance.

Revision ID: 0021_prompt_registry
Revises: 0020_suites_tasks_criteria
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0021_prompt_registry"
down_revision = "0020_suites_tasks_criteria"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "prompts" not in tables:
        op.create_table(
            "prompts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(100), nullable=False, unique=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
    if "prompt_versions" not in tables:
        op.create_table(
            "prompt_versions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("prompt_id", sa.String(36), sa.ForeignKey("prompts.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("system_prompt", sa.Text(), nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("prompt_id", "version", name="uq_prompt_versions_prompt_version"),
        )

    history_columns = {column["name"] for column in inspector.get_columns("benchmark_history")}
    additions = [
        ("prompt_id", sa.String(36), True),
        ("prompt_name", sa.String(100), True),
        ("prompt_version", sa.Integer(), True),
        ("prompt_sha256", sa.String(64), True),
        ("system_prompt_snapshot", sa.Text(), True),
    ]
    for name, column_type, nullable in additions:
        if name not in history_columns:
            op.add_column("benchmark_history", sa.Column(name, column_type, nullable=nullable))
    if "prompt_id" not in history_columns:
        op.create_foreign_key("fk_benchmark_history_prompt", "benchmark_history", "prompts", ["prompt_id"], ["id"], ondelete="SET NULL")
        op.create_index("ix_benchmark_history_prompt_id", "benchmark_history", ["prompt_id"])


def downgrade() -> None:
    # Provenance is intentionally retained on downgrade to avoid deleting audit data.
    op.drop_table("prompt_versions")
    op.drop_table("prompts")
