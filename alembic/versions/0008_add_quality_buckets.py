"""Add quality_buckets to benchmark_history

Revision ID: 0008
Revises: 0007_add_scorer_version
Create Date: 2026-08-16 20:15:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}

    if "quality_buckets" not in columns:
        op.add_column('benchmark_history', sa.Column('quality_buckets', sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}

    if "quality_buckets" in columns:
        op.drop_column('benchmark_history', 'quality_buckets')