"""Add first-class required flag for benchmark categories.

Revision ID: 0028_add_suite_required_flag
Revises: 0027_add_banking_parent_suite
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0028_add_suite_required_flag"
down_revision = "0027_add_banking_parent_suite"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("benchmark_suites")}
    if "is_required" not in columns:
        op.add_column(
            "benchmark_suites",
            sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
    indexes = {index["name"] for index in inspect(bind).get_indexes("benchmark_suites")}
    if "ix_benchmark_suites_is_required" not in indexes:
        op.create_index("ix_benchmark_suites_is_required", "benchmark_suites", ["is_required"])
    bind.execute(sa.text("""
        UPDATE benchmark_suites
        SET is_required = false
        WHERE parent_suite_id IS NOT NULL
          AND parent_suite_id <> id
          AND NOT EXISTS (
              SELECT 1 FROM banking_tasks WHERE banking_tasks.suite_id = benchmark_suites.id
          )
    """))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_suites")}
    if "is_required" in columns:
        indexes = {index["name"] for index in inspect(bind).get_indexes("benchmark_suites")}
        if "ix_benchmark_suites_is_required" in indexes:
            op.drop_index("ix_benchmark_suites_is_required", table_name="benchmark_suites")
        op.drop_column("benchmark_suites", "is_required")
