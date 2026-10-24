"""Add composable prompt types (base, directive, standalone) and backfill existing runs.

Revision ID: 0022_composable_prompts
Revises: 0021_prompt_registry
"""

import json
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0022_composable_prompts"
down_revision = "0021_prompt_registry"
branch_labels = None
depends_on = None

def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    
    # 1. Extend prompts table with prompt_type and parent_base_id
    prompt_cols = {c["name"] for c in inspector.get_columns("prompts")}
    with op.batch_alter_table("prompts") as batch_op:
        if "prompt_type" not in prompt_cols:
            batch_op.add_column(
                sa.Column("prompt_type", sa.String(30), nullable=False, server_default="standalone"),
            )
        if "parent_base_id" not in prompt_cols:
            batch_op.add_column(
                sa.Column("parent_base_id", sa.String(36), sa.ForeignKey("prompts.id", ondelete="SET NULL", name="fk_prompts_parent_base_id"), nullable=True),
            )

    # 2. Extend benchmark_history with composable provenance columns
    history_cols = {c["name"] for c in inspector.get_columns("benchmark_history")}
    additions = [
        ("base_prompt_name", sa.String(100), True),
        ("base_prompt_version", sa.Integer(), True),
        ("directive_name", sa.String(100), True),
        ("directive_version", sa.Integer(), True),
    ]
    for col_name, col_type, nullable in additions:
        if col_name not in history_cols:
            op.add_column("benchmark_history", sa.Column(col_name, col_type, nullable=nullable))

    # Reuse installed legacy prompts; public migrations never seed prompt text.
    res = bind.execute(sa.text("SELECT id FROM prompts WHERE name = 'enterprise_banking'")).fetchone()
    base_id = res[0] if res else None
    if base_id is not None:
        bind.execute(sa.text("UPDATE prompts SET prompt_type = 'base' WHERE id = :id"), {"id": base_id})

    # 4. Categorize strategy prompts as directives attached to enterprise_banking
    bind.execute(sa.text("""
        UPDATE prompts
        SET prompt_type = 'directive', parent_base_id = :base_id
        WHERE name IN ('standard', 'chain_of_thought', 'strict_json', 'negative_compliance')
    """), {"base_id": base_id})

    bind.execute(sa.text("""
        UPDATE prompts
        SET prompt_type = 'standalone'
        WHERE name = 'banking_universal_precision_v1'
    """))

    # 5. Backfill all existing benchmark_history runs so none are lost
    if base_id is not None and bind.dialect.name == "postgresql":
        bind.execute(sa.text("""
            UPDATE benchmark_history
            SET base_prompt_name = 'enterprise_banking',
                base_prompt_version = 1,
                directive_name = prompt_name,
                directive_version = 1,
                prompt_name = 'enterprise_banking',
                prompt_id = :base_id,
                prompt_version = 1,
                engine_config = COALESCE(engine_config::jsonb, '{}'::jsonb) || jsonb_build_object(
                    'prompt_name', 'enterprise_banking',
                    'prompt_strategy', prompt_name,
                    'strategy', prompt_name,
                    'base_prompt', 'enterprise_banking',
                    'base_version', 1,
                    'directive', prompt_name,
                    'directive_version', 1
                )
            WHERE prompt_name IN ('standard', 'chain_of_thought', 'strict_json', 'negative_compliance')
        """), {"base_id": base_id})

        bind.execute(sa.text("""
            UPDATE benchmark_history
            SET base_prompt_name = 'banking_universal_precision_v1',
                base_prompt_version = 1,
                directive_name = 'standard',
                directive_version = 1,
                engine_config = COALESCE(engine_config::jsonb, '{}'::jsonb) || jsonb_build_object(
                    'prompt_name', 'banking_universal_precision_v1',
                    'prompt_strategy', 'standard',
                    'strategy', 'standard',
                    'base_prompt', 'banking_universal_precision_v1',
                    'base_version', 1,
                    'directive', 'standard',
                    'directive_version', 1
                )
            WHERE prompt_name = 'banking_universal_precision_v1'
        """))
    elif base_id is not None:
        # SQLite dialect handling
        rows = bind.execute(sa.text("SELECT id, prompt_name, engine_config FROM benchmark_history")).fetchall()
        for row_id, p_name, raw_cfg in rows:
            cfg = json.loads(raw_cfg) if raw_cfg else {}
            if p_name in ('standard', 'chain_of_thought', 'strict_json', 'negative_compliance'):
                cfg.update({
                    'prompt_name': 'enterprise_banking',
                    'prompt_strategy': p_name,
                    'strategy': p_name,
                    'base_prompt': 'enterprise_banking',
                    'base_version': 1,
                    'directive': p_name,
                    'directive_version': 1
                })
                bind.execute(sa.text("""
                    UPDATE benchmark_history
                    SET base_prompt_name = 'enterprise_banking',
                        base_prompt_version = 1,
                        directive_name = :dname,
                        directive_version = 1,
                        prompt_name = 'enterprise_banking',
                        prompt_id = :base_id,
                        prompt_version = 1,
                        engine_config = :cfg
                    WHERE id = :id
                """), {"dname": p_name, "base_id": base_id, "cfg": json.dumps(cfg), "id": row_id})
            elif p_name == 'banking_universal_precision_v1':
                cfg.update({
                    'prompt_name': 'banking_universal_precision_v1',
                    'prompt_strategy': 'standard',
                    'strategy': 'standard',
                    'base_prompt': 'banking_universal_precision_v1',
                    'base_version': 1,
                    'directive': 'standard',
                    'directive_version': 1
                })
                bind.execute(sa.text("""
                    UPDATE benchmark_history
                    SET base_prompt_name = 'banking_universal_precision_v1',
                        base_prompt_version = 1,
                        directive_name = 'standard',
                        directive_version = 1,
                        engine_config = :cfg
                    WHERE id = :id
                """), {"cfg": json.dumps(cfg), "id": row_id})


def downgrade() -> None:
    pass
