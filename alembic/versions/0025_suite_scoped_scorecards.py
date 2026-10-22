"""Scope benchmark results and SLA criteria to a benchmark suite.

Revision ID: 0025_suite_scoped_scorecards
Revises: 0024_strategy_registry_cleanup
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0025_suite_scoped_scorecards"
down_revision = "0024_strategy_registry_cleanup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    history_columns = {column["name"] for column in inspector.get_columns("benchmark_history")}
    criteria_columns = {column["name"] for column in inspector.get_columns("scorecard_criteria")}

    if "suite_id" not in history_columns:
        op.add_column("benchmark_history", sa.Column("suite_id", sa.String(100), nullable=True))
        op.create_index("ix_benchmark_history_suite_id", "benchmark_history", ["suite_id"])

    if "suite_id" not in criteria_columns:
        op.add_column("scorecard_criteria", sa.Column("suite_id", sa.String(100), nullable=True))
        op.create_index("ix_scorecard_criteria_suite_id", "scorecard_criteria", ["suite_id"])

    # Preserve historical Banking evidence by deriving its registered suite from
    # the canonical category identifier. Unknown legacy records remain unscoped.
    bind.execute(sa.text("""
        UPDATE benchmark_history
        SET suite_id = CASE category_id
            WHEN 'financial_reasoning' THEN 'finqa'
            WHEN 'grounded_banking' THEN 'grounded_banking'
            WHEN 'compliance_safety' THEN 'compliance_safety'
            WHEN 'document_operations' THEN 'document_operations'
            WHEN 'multilingual_quality' THEN 'multilingual_quality'
            WHEN 'robustness_security' THEN 'robustness_security'
            ELSE suite_id
        END
        WHERE suite_id IS NULL
    """))
    bind.execute(sa.text("""
        UPDATE scorecard_criteria
        SET suite_id = 'finqa'
        WHERE suite_id IS NULL AND id LIKE 'banking%'
    """))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    history_columns = {column["name"] for column in inspector.get_columns("benchmark_history")}
    criteria_columns = {column["name"] for column in inspector.get_columns("scorecard_criteria")}
    if "suite_id" in criteria_columns:
        op.drop_index("ix_scorecard_criteria_suite_id", table_name="scorecard_criteria")
        op.drop_column("scorecard_criteria", "suite_id")
    if "suite_id" in history_columns:
        op.drop_index("ix_benchmark_history_suite_id", table_name="benchmark_history")
        op.drop_column("benchmark_history", "suite_id")
