"""Persist fields needed to keep comparisons reproducible and honest."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0003_provenance_identity"
down_revision = "0002_metric_split"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    additions = {
        "quantization": sa.Column("quantization", sa.String(100), nullable=True),
        "context_len": sa.Column("context_len", sa.Integer(), nullable=True),
        "output_token_source": sa.Column("output_token_source", sa.String(50), nullable=True),
    }
    for name, column in additions.items():
        if name not in columns:
            op.add_column("benchmark_history", column)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    for name in ("output_token_source", "context_len", "quantization"):
        if name in columns:
            op.drop_column("benchmark_history", name)
