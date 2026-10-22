"""Add missing hardware telemetry fields"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0005_hardware_telemetry"
down_revision = "0004_api_keys_and_aggregation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    
    additions = {
        "hw_cpu_physical_cores": sa.Column("hw_cpu_physical_cores", sa.Integer(), nullable=True),
        "hw_cpu_logical_cores": sa.Column("hw_cpu_logical_cores", sa.Integer(), nullable=True),
        "hw_gpu_driver": sa.Column("hw_gpu_driver", sa.String(100), nullable=True),
        "hw_gpu_count": sa.Column("hw_gpu_count", sa.Integer(), nullable=True),
        "hw_aws_instance_type": sa.Column("hw_aws_instance_type", sa.String(100), nullable=True),
    }
    
    for name, column in additions.items():
        if name not in columns:
            op.add_column("benchmark_history", column)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    
    removals = [
        "hw_cpu_physical_cores",
        "hw_cpu_logical_cores",
        "hw_gpu_driver",
        "hw_gpu_count",
        "hw_aws_instance_type"
    ]
    
    for name in removals:
        if name in columns:
            op.drop_column("benchmark_history", name)
