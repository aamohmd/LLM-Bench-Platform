"""Persist generation-timeout counts and rates for benchmark evidence."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0034_generation_timeout_metrics"
down_revision = "0033_reconcile_legacy_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "generation_timeout_count" not in columns:
        op.add_column(
            "benchmark_history",
            sa.Column(
                "generation_timeout_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )
        op.alter_column("benchmark_history", "generation_timeout_count", server_default=None)
    if "generation_timeout_rate" not in columns:
        op.add_column(
            "benchmark_history",
            sa.Column(
                "generation_timeout_rate",
                sa.Float(),
                nullable=False,
                server_default="0",
            ),
        )
        op.alter_column("benchmark_history", "generation_timeout_rate", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "generation_timeout_rate" in columns:
        op.drop_column("benchmark_history", "generation_timeout_rate")
    if "generation_timeout_count" in columns:
        op.drop_column("benchmark_history", "generation_timeout_count")
