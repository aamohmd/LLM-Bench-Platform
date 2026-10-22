"""Add API key lifecycle metadata for dashboard-managed keys."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "0011_api_key_lifecycle_metadata"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("api_keys")}
    additions = {
        "environment": sa.Column("environment", sa.String(length=100), nullable=True),
        "last_used_at": sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        "expires_at": sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    }
    for name, column in additions.items():
        if name not in columns:
            op.add_column("api_keys", column)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("api_keys")}
    for name in ("expires_at", "last_used_at", "environment"):
        if name in columns:
            op.drop_column("api_keys", name)
