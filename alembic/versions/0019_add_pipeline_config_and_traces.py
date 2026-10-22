"""Add pipeline_config_id and trace_timeline_json to benchmark_history."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0019_pipeline_config_traces"
down_revision = "0018_fleet_analyses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}

    if "pipeline_config_id" not in columns:
        op.add_column(
            "benchmark_history",
            sa.Column(
                "pipeline_config_id",
                sa.String(36),
                sa.ForeignKey("pipeline_configs.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        try:
            op.create_index(
                "ix_benchmark_history_pipeline_config_id",
                "benchmark_history",
                ["pipeline_config_id"],
            )
        except Exception:
            pass

    if "trace_timeline_json" not in columns:
        op.add_column(
            "benchmark_history",
            sa.Column("trace_timeline_json", sa.String(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}

    if "trace_timeline_json" in columns:
        op.drop_column("benchmark_history", "trace_timeline_json")

    if "pipeline_config_id" in columns:
        try:
            op.drop_index("ix_benchmark_history_pipeline_config_id", table_name="benchmark_history")
        except Exception:
            pass
        op.drop_column("benchmark_history", "pipeline_config_id")
