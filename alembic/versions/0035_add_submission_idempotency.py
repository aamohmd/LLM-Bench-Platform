"""Add runner submission identities for idempotent outbox replay."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0035_submission_idempotency"
down_revision = "0034_generation_timeout_metrics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("benchmark_history")}
    if "submission_id" not in columns:
        op.add_column(
            "benchmark_history",
            sa.Column("submission_id", sa.String(length=36), nullable=True),
        )
    if "submission_payload_hash" not in columns:
        op.add_column(
            "benchmark_history",
            sa.Column("submission_payload_hash", sa.String(length=64), nullable=True),
        )

    indexes = {index["name"] for index in inspect(bind).get_indexes("benchmark_history")}
    if "ix_benchmark_history_submission_id" not in indexes:
        op.create_index(
            "ix_benchmark_history_submission_id",
            "benchmark_history",
            ["submission_id"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes("benchmark_history")}
    if "ix_benchmark_history_submission_id" in indexes:
        op.drop_index("ix_benchmark_history_submission_id", table_name="benchmark_history")
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "submission_payload_hash" in columns:
        op.drop_column("benchmark_history", "submission_payload_hash")
    if "submission_id" in columns:
        op.drop_column("benchmark_history", "submission_id")
