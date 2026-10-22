"""Store cached fleet-wide AI analysis across all database runs."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0018_fleet_analyses"
down_revision = "0017_benchmark_analyses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "fleet_analyses" in inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "fleet_analyses",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False, server_default="openai"),
        sa.Column("model", sa.String(100)),
        sa.Column("prompt_version", sa.String(40)),
        sa.Column("result", sa.String),
        sa.Column("error_message", sa.String),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_fleet_analyses_created_at", "fleet_analyses", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_fleet_analyses_created_at", table_name="fleet_analyses")
    op.drop_table("fleet_analyses")
