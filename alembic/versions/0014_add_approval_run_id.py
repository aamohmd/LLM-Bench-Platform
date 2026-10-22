"""Add an explicit grouping key for one approval matrix execution."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0014_approval_run_id"
down_revision = "0013_benchmark_run_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "approval_run_id" not in columns:
        op.add_column(
            "benchmark_history",
            sa.Column("approval_run_id", sa.String(length=36), nullable=True),
        )
    indexes = {index["name"] for index in inspect(bind).get_indexes("benchmark_history")}
    if "ix_benchmark_history_approval_run_id" not in indexes:
        op.create_index("ix_benchmark_history_approval_run_id", "benchmark_history", ["approval_run_id"])


def downgrade() -> None:
    bind = op.get_bind()
    indexes = {index["name"] for index in inspect(bind).get_indexes("benchmark_history")}
    if "ix_benchmark_history_approval_run_id" in indexes:
        op.drop_index("ix_benchmark_history_approval_run_id", table_name="benchmark_history")
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "approval_run_id" in columns:
        op.drop_column("benchmark_history", "approval_run_id")
