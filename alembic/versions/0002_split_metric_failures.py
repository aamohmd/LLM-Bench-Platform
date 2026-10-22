"""Add independent KV-cache and ITL failure counters."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0002_metric_split"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("run_deep_metrics")}
    if "kv_failed_count" not in columns:
        op.add_column("run_deep_metrics", sa.Column("kv_failed_count", sa.Integer(), nullable=True))
    if "itl_failed_count" not in columns:
        op.add_column("run_deep_metrics", sa.Column("itl_failed_count", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("run_deep_metrics")}
    if "itl_failed_count" in columns:
        op.drop_column("run_deep_metrics", "itl_failed_count")
    if "kv_failed_count" in columns:
        op.drop_column("run_deep_metrics", "kv_failed_count")
