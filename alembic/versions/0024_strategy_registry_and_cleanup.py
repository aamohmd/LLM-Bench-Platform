"""Create prompt_strategies table, seed initial strategies, and drop legacy directive/prompt_type columns.

Revision ID: 0024_strategy_registry_cleanup
Revises: 0023_explicit_prompt_strategy
"""

import uuid
from datetime import datetime, timezone
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0024_strategy_registry_cleanup"
down_revision = "0023_explicit_prompt_strategy"
branch_labels = None
depends_on = None

CANONICAL_STRATEGIES = [
    {
        "id": "strategy-standard",
        "name": "standard",
        "label": "Standard",
        "description": "Standard zero-shot benchmark execution without additional reasoning or formatting directives.",
        "directive_text": None,
        "is_builtin": True,
    },
    {
        "id": "strategy-chain-of-thought",
        "name": "chain_of_thought",
        "label": "Chain of Thought",
        "description": "Step-by-step arithmetic deductions scratchpad prior to generating final output figures.",
        "directive_text": (
            "CRITICAL REASONING DIRECTIVE:\n"
            "Before stating the final answer, provide a concise scratchpad of step-by-step arithmetic deductions. "
            "Break down intermediate values clearly: Step 1: ..., Step 2: ..., Final Result: ... State the exact final number."
        ),
        "is_builtin": True,
    },
    {
        "id": "strategy-strict-json",
        "name": "strict_json",
        "label": "Strict JSON",
        "description": "Enforces strict JSON formatting without conversational preambles or markdown code fences.",
        "directive_text": (
            "CRITICAL FORMAT DIRECTIVE:\n"
            "You MUST respond strictly with valid JSON without markdown code blocks, conversational pleasantries, or explanations. "
            "Output format: {\"decision\": string, \"confidence\": float, \"extracted_data\": object, \"reasoning_summary\": string}."
        ),
        "is_builtin": True,
    },
    {
        "id": "strategy-negative-compliance",
        "name": "negative_compliance",
        "label": "Negative Compliance",
        "description": "Strict zero-hallucination refusal directive when required information or policy is missing.",
        "directive_text": (
            "CRITICAL NEGATIVE REFUSAL DIRECTIVE:\n"
            "Strict zero-hallucination policy. If any required data point, fee amount, or account condition is not explicitly confirmed in the provided context, "
            "you MUST NOT infer or extrapolate. State: 'Information not provided in regulatory banking context' and return null."
        ),
        "is_builtin": True,
    },
]


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

    # 2. Seed initial canonical strategies into prompt_strategies
    now = datetime.now(timezone.utc)
    for strat in CANONICAL_STRATEGIES:
        existing = bind.execute(
            sa.text("SELECT id FROM prompt_strategies WHERE name = :name"),
            {"name": strat["name"]},
        ).first()
        if not existing:
            bind.execute(
                sa.text("""
                    INSERT INTO prompt_strategies (id, name, label, description, directive_text, is_builtin, is_active, created_at, updated_at)
                    VALUES (:id, :name, :label, :description, :directive_text, :is_builtin, true, :created_at, :updated_at)
                """),
                {
                    "id": strat["id"],
                    "name": strat["name"],
                    "label": strat["label"],
                    "description": strat["description"],
                    "directive_text": strat["directive_text"],
                    "is_builtin": strat["is_builtin"],
                    "created_at": now,
                    "updated_at": now,
                },
            )

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
