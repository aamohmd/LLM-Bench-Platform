"""Add scorer_version to benchmark_history

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-15 23:55:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '0007'
down_revision = '0006_add_peak_gpu_mem_mb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}

    if "scorer_version" not in columns:
        op.add_column('benchmark_history', sa.Column('scorer_version', sa.String(length=64), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}

    if "scorer_version" in columns:
        op.drop_column('benchmark_history', 'scorer_version')
