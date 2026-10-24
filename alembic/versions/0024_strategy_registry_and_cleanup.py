"""Create prompt_strategies table and drop legacy directive/prompt_type columns.

Revision ID: 0024_strategy_registry_cleanup
Revises: 0023_explicit_prompt_strategy
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0024_strategy_registry_cleanup"
down_revision = "0023_explicit_prompt_strategy"
branch_labels = None
depends_on = None

def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # 1. Create prompt_strategies table if it does not exist
    if "prompt_strategies" not in inspector.get_table_names():
        op.create_table(
            "prompt_strategies",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(64), nullable=False, unique=True, index=True),
            sa.Column("label", sa.String(100), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("directive_text", sa.Text(), nullable=True),
            sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )

    # Strategy content is managed through the API, never seeded by migrations.

    # 3. Clean prompts table: drop prompt_type and parent_base_id
    prompt_cols = {c["name"] for c in inspector.get_columns("prompts")}
    with op.batch_alter_table("prompts") as batch_op:
        if "parent_base_id" in prompt_cols:
            batch_op.drop_column("parent_base_id")
        if "prompt_type" in prompt_cols:
            batch_op.drop_column("prompt_type")

    # 4. Clean benchmark_history table: drop directive_name, directive_version, base_prompt_name, base_prompt_version
    bh_cols = {c["name"] for c in inspector.get_columns("benchmark_history")}
    with op.batch_alter_table("benchmark_history") as batch_op:
        if "directive_name" in bh_cols:
            batch_op.drop_column("directive_name")
        if "directive_version" in bh_cols:
            batch_op.drop_column("directive_version")
        if "base_prompt_name" in bh_cols:
            batch_op.drop_column("base_prompt_name")
        if "base_prompt_version" in bh_cols:
            batch_op.drop_column("base_prompt_version")


def downgrade() -> None:
    pass
