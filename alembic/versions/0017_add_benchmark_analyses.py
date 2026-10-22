"""Store one cached AI analysis per benchmark run."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0017_benchmark_analyses"
down_revision = "0016_catastrophic_failure_count"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "benchmark_analyses" in inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "benchmark_analyses",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("benchmark_history.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("model", sa.String(100)),
        sa.Column("prompt_version", sa.String(40)),
        sa.Column("result", sa.String),
        sa.Column("error_message", sa.String),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_benchmark_analyses_run_id", "benchmark_analyses", ["run_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_benchmark_analyses_run_id", table_name="benchmark_analyses")
    op.drop_table("benchmark_analyses")
