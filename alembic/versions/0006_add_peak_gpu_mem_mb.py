"""Add peak_gpu_mem_mb to benchmark_history"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0006_add_peak_gpu_mem_mb"
down_revision = "0005_hardware_telemetry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    
    if "peak_gpu_mem_mb" not in columns:
        op.add_column("benchmark_history", sa.Column("peak_gpu_mem_mb", sa.Float(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    
    if "peak_gpu_mem_mb" in columns:
        op.drop_column("benchmark_history", "peak_gpu_mem_mb")
