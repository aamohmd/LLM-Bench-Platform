"""Remove versions from benchmark product concepts without deleting history.

Revision ID: 0032_remove_product_versions
Revises: 0031_universal_task_registry
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0032_remove_product_versions"
down_revision = "0031_universal_task_registry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "benchmark_history" in tables:
        history_columns = {column["name"] for column in inspector.get_columns("benchmark_history")}
        removable = [
            column
            for column in ("scorer_version", "registry_version", "aggregation_version")
            if column in history_columns
        ]
        if removable:
            with op.batch_alter_table("benchmark_history") as batch_op:
                for column in removable:
                    batch_op.drop_column(column)

    if "benchmark_suites" in tables:
        suite_columns = {column["name"] for column in inspector.get_columns("benchmark_suites")}
        if "version" in suite_columns:
            with op.batch_alter_table("benchmark_suites") as batch_op:
                batch_op.drop_column("version")


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())

    if "benchmark_suites" in tables:
        op.add_column(
            "benchmark_suites",
            sa.Column("version", sa.String(50), nullable=False, server_default="v1.0.0"),
        )

    if "benchmark_history" in tables:
        op.add_column("benchmark_history", sa.Column("aggregation_version", sa.String(50), nullable=True))
        op.add_column("benchmark_history", sa.Column("registry_version", sa.String(64), nullable=True))
        op.add_column("benchmark_history", sa.Column("scorer_version", sa.String(64), nullable=True))
