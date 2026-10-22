"""Add benchmark_suites, banking_tasks, and scorecard_criteria tables.

Revision ID: 0020_suites_tasks_criteria
Revises: 0019_pipeline_config_traces
Create Date: 2026-09-13
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0020_suites_tasks_criteria"
down_revision = "0019_pipeline_config_traces"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "benchmark_suites" not in tables:
        op.create_table(
            "benchmark_suites",
            sa.Column("id", sa.String(100), primary_key=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("domain", sa.String(100), nullable=False, server_default="general"),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("version", sa.String(50), nullable=False, server_default="v1.0.0"),
            sa.Column("default_scorer", sa.String(64), nullable=True),
            sa.Column("default_tolerance_json", sa.Text(), nullable=True),
            sa.Column("task_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "banking_tasks" not in tables:
        op.create_table(
            "banking_tasks",
            sa.Column("id", sa.String(200), primary_key=True),
            sa.Column("suite_id", sa.String(100), nullable=True, index=True),
            sa.Column("suite_name", sa.String(200), nullable=True),
            sa.Column("domain", sa.String(100), nullable=True, server_default="general"),
            sa.Column("category_id", sa.String(100), nullable=False, index=True),
            sa.Column("prompt", sa.Text(), nullable=False),
            sa.Column("expected_answer", sa.Text(), nullable=False),
            sa.Column("task_type", sa.String(50), nullable=False, index=True),
            sa.Column("bucket", sa.String(50), nullable=False, server_default="general"),
            sa.Column("language", sa.String(10), nullable=False, server_default="en"),
            sa.Column("tolerance_json", sa.Text(), nullable=True),
            sa.Column("scoring_config_json", sa.Text(), nullable=True),
            sa.Column("program", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
    else:
        existing_cols = {col["name"] for col in inspector.get_columns("banking_tasks")}
        if "suite_id" not in existing_cols:
            op.add_column("banking_tasks", sa.Column("suite_id", sa.String(100), nullable=True, index=True))
        if "suite_name" not in existing_cols:
            op.add_column("banking_tasks", sa.Column("suite_name", sa.String(200), nullable=True))
        if "domain" not in existing_cols:
            op.add_column("banking_tasks", sa.Column("domain", sa.String(100), nullable=True, server_default="general"))

    if "scorecard_criteria" not in tables:
        op.create_table(
            "scorecard_criteria",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("min_decode_tps", sa.Float(), nullable=False, server_default="25.0"),
            sa.Column("fast_ttft_s", sa.Float(), nullable=False, server_default="0.8"),
            sa.Column("tail_ttft_ceiling_s", sa.Float(), nullable=False, server_default="1.5"),
            sa.Column("interactive_ttft_max_s", sa.Float(), nullable=False, server_default="3.0"),
            sa.Column("min_quality_score", sa.Float(), nullable=False, server_default="0.75"),
            sa.Column("quality_surplus_tradeoff", sa.Float(), nullable=False, server_default="1.10"),
            sa.Column("memory_stability_max_pct", sa.Float(), nullable=False, server_default="85.0"),
            sa.Column("max_error_rate", sa.Float(), nullable=False, server_default="0.01"),
            sa.Column("weight_quality", sa.Float(), nullable=False, server_default="0.60"),
            sa.Column("weight_speed", sa.Float(), nullable=False, server_default="0.25"),
            sa.Column("weight_fit", sa.Float(), nullable=False, server_default="0.15"),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "scorecard_criteria" in tables:
        op.drop_table("scorecard_criteria")

    if "banking_tasks" in tables:
        op.drop_table("banking_tasks")

    if "benchmark_suites" in tables:
        op.drop_table("benchmark_suites")
