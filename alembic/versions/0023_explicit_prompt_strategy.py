"""Add explicit prompt_strategy column to benchmark_history and purge legacy strategies from prompts table.

Revision ID: 0023_explicit_prompt_strategy
Revises: 0022_composable_prompts
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0023_explicit_prompt_strategy"
down_revision = "0022_composable_prompts"
branch_labels = None
depends_on = None

STRATEGY_NAMES = ("standard", "strict_json", "chain_of_thought", "negative_compliance")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # 1. Add prompt_strategy column to benchmark_history if not present
    bh_cols = {c["name"] for c in inspector.get_columns("benchmark_history")}
    if "prompt_strategy" not in bh_cols:
        op.add_column("benchmark_history", sa.Column("prompt_strategy", sa.String(100), nullable=True))

    # 2. Backfill benchmark_history:
    # First: any runs whose prompt_name was mistakenly set to a strategy slug -> set prompt_strategy to that slug, prompt_name to 'enterprise_banking'
    bind.execute(sa.text("""
        UPDATE benchmark_history
        SET prompt_strategy = prompt_name,
            prompt_name = 'enterprise_banking'
        WHERE prompt_name IN ('standard', 'strict_json', 'chain_of_thought', 'negative_compliance')
    """))

    # Second: ensure prompt_strategy is populated from directive_name if still null
    bind.execute(sa.text("""
        UPDATE benchmark_history
        SET prompt_strategy = COALESCE(directive_name, 'standard')
        WHERE prompt_strategy IS NULL OR prompt_strategy = ''
    """))

    # Third: ensure prompt_name is populated
    bind.execute(sa.text("""
        UPDATE benchmark_history
        SET prompt_name = 'enterprise_banking'
        WHERE prompt_name IS NULL OR prompt_name = ''
    """))

    # 3. Purge strategy slugs from prompts table (and child prompt_versions)
    bind.execute(sa.text("""
        DELETE FROM prompt_versions
        WHERE prompt_id IN (
            SELECT id FROM prompts WHERE name IN ('standard', 'strict_json', 'chain_of_thought', 'negative_compliance')
        )
    """))
    bind.execute(sa.text("""
        DELETE FROM prompts
        WHERE name IN ('standard', 'strict_json', 'chain_of_thought', 'negative_compliance')
    """))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    bh_cols = {c["name"] for c in inspector.get_columns("benchmark_history")}
    if "prompt_strategy" in bh_cols:
        op.drop_column("benchmark_history", "prompt_strategy")
