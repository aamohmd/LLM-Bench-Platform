"""Add explicit approval versus diagnostic provenance to benchmark history."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0013_benchmark_run_type"
down_revision = "0012_benchmark_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "run_type" not in columns:
        op.add_column(
            "benchmark_history",
            sa.Column("run_type", sa.String(length=20), nullable=True, server_default="diagnostic"),
        )
    op.execute("UPDATE benchmark_history SET run_type = 'diagnostic' WHERE run_type IS NULL")
    if bind.dialect.name != "sqlite":
        op.alter_column("benchmark_history", "run_type", nullable=False, server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "run_type" in columns:
        op.drop_column("benchmark_history", "run_type")
