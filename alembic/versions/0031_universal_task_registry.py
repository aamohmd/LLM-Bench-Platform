"""Generalize the task registry and retire domain-specific defaults.

Revision ID: 0031_universal_task_registry
Revises: 0030_repair_category_snapshots
"""

from alembic import op
import sqlalchemy as sa


revision = "0031_universal_task_registry"
down_revision = "0030_repair_category_snapshots"
branch_labels = None
depends_on = None


_LEGACY_SUITE_IDS = (
    "banking",
    "finqa",
    "grounded_banking",
    "compliance_safety",
    "document_operations",
    "multilingual_quality",
    "robustness_security",
)


def _copy_legacy_tasks(bind) -> None:
    columns = (
        "id, suite_id, suite_name, domain, category_id, prompt, expected_answer, "
        "task_type, bucket, language, tolerance_json, scoring_config_json, program, "
        "created_at, updated_at"
    )
    if bind.dialect.name == "sqlite":
        statement = f"INSERT OR IGNORE INTO benchmark_tasks ({columns}) SELECT {columns} FROM banking_tasks"
    else:
        statement = (
            f"INSERT INTO benchmark_tasks ({columns}) SELECT {columns} FROM banking_tasks "
            "ON CONFLICT (id) DO NOTHING"
        )
    bind.execute(sa.text(statement))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "banking_tasks" in tables and "benchmark_tasks" in tables:
        _copy_legacy_tasks(bind)
        op.drop_table("banking_tasks")
    elif "banking_tasks" in tables:
        op.rename_table("banking_tasks", "benchmark_tasks")

    placeholders = ", ".join(f":suite_{index}" for index, _ in enumerate(_LEGACY_SUITE_IDS))
    params = {f"suite_{index}": value for index, value in enumerate(_LEGACY_SUITE_IDS)}

    bind.execute(
        sa.text(f"DELETE FROM benchmark_tasks WHERE suite_id IN ({placeholders})"),
        params,
    )
    bind.execute(
        sa.text(
            "DELETE FROM scorecard_criteria "
            f"WHERE suite_id IN ({placeholders}) OR scoreboard_suite_id IN ({placeholders}) "
            "OR id IN ('banking_canonical', 'banking_strict_80', 'banking_throughput_35')"
        ),
        params,
    )
    bind.execute(
        sa.text(
            "DELETE FROM benchmark_suites "
            f"WHERE id IN ({placeholders}) OR parent_suite_id IN ({placeholders})"
        ),
        params,
    )
    bind.execute(
        sa.text("UPDATE prompts SET is_archived = true WHERE name = 'enterprise_banking'")
    )
    bind.execute(
        sa.text(
            "UPDATE prompt_strategies SET is_active = false "
            "WHERE name = 'negative_compliance'"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "benchmark_tasks" in tables and "banking_tasks" not in tables:
        op.rename_table("benchmark_tasks", "banking_tasks")
