"""Add decision_mode to benchmark_history

Revision ID: 0010
Revises: 0009_add_job_heartbeat
Create Date: 2026-08-19 12:00:00.000000

decision_mode holds the JSON blob produced by --decision-mode runs
(3x repetitions, per-run success rates, min/max/stdev/range). Idempotent:
skips if the column already exists (mirrors 0008_add_quality_buckets).

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}

    if "decision_mode" not in columns:
        op.add_column('benchmark_history', sa.Column('decision_mode', sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}

    if "decision_mode" in columns:
        op.drop_column('benchmark_history', 'decision_mode')