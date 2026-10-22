"""Add api_keys and aggregation_version"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0004_api_keys_and_aggregation"
down_revision = "0003_provenance_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    
    if "aggregation_version" not in columns:
        op.add_column("benchmark_history", sa.Column("aggregation_version", sa.String(50), nullable=True))
        # Data migration: backfill existing rows
        op.execute("UPDATE benchmark_history SET aggregation_version = 'pre-v1-unknown' WHERE aggregation_version IS NULL")

    tables = inspect(bind).get_table_names()
    if "api_keys" not in tables:
        op.create_table(
            "api_keys",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("key_hash", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("scope", sa.String(length=50), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("key_hash")
        )
        op.create_index(op.f("ix_api_keys_key_hash"), "api_keys", ["key_hash"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("benchmark_history")}
    if "aggregation_version" in columns:
        op.drop_column("benchmark_history", "aggregation_version")

    op.drop_index(op.f("ix_api_keys_key_hash"), table_name="api_keys")
    op.drop_table("api_keys")
