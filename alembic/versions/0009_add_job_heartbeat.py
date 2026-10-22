"""Add heartbeat_at to benchmark_jobs

Revision ID: 0009
Revises: 0008_add_quality_buckets
Create Date: 2026-08-17 09:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_jobs")}

    if "heartbeat_at" not in columns:
        op.add_column('benchmark_jobs', sa.Column('heartbeat_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_jobs")}

    if "heartbeat_at" in columns:
        op.drop_column('benchmark_jobs', 'heartbeat_at')
