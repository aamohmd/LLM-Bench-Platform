"""Persist catastrophic benchmark failures for SLA hard gating."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0016_catastrophic_failure_count"
down_revision = "0015_admin_visitor_key_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "catastrophic_failure_count" not in columns:
        op.add_column(
            "benchmark_history",
            sa.Column(
                "catastrophic_failure_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )
        op.alter_column("benchmark_history", "catastrophic_failure_count", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "catastrophic_failure_count" in columns:
        op.drop_column("benchmark_history", "catastrophic_failure_count")
