"""Add registry and concurrency-scope metadata to benchmark history."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0012_benchmark_metadata"
down_revision = "0011_api_key_lifecycle_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    additions = {
        "category_id": sa.Column("category_id", sa.String(length=80), nullable=True),
        "registry_version": sa.Column("registry_version", sa.String(length=64), nullable=True),
        # Historical runs must not be treated as approval evidence.
        "concurrency_scope": sa.Column("concurrency_scope", sa.String(length=20), nullable=True, server_default="exploratory"),
        "benchmark_commit": sa.Column("benchmark_commit", sa.String(length=128), nullable=True),
        "model_revision": sa.Column("model_revision", sa.String(length=256), nullable=True),
    }
    for name, column in additions.items():
        if name not in columns:
            op.add_column("benchmark_history", column)
    op.execute("UPDATE benchmark_history SET concurrency_scope = 'exploratory' WHERE concurrency_scope IS NULL")
    # SQLite does not support ALTER COLUMN. The application model and the
    # backfill enforce the safe default there; PostgreSQL gets the stronger
    # database constraint.
    if bind.dialect.name != "sqlite":
        op.alter_column("benchmark_history", "concurrency_scope", nullable=False, server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    for name in ("model_revision", "benchmark_commit", "concurrency_scope", "registry_version"):
        if name in columns:
            op.drop_column("benchmark_history", name)
