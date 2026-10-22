"""Group task categories under parent benchmark suites for scoreboards.

Revision ID: 0026_parent_suite_scoreboards
Revises: 0025_suite_scoped_scorecards
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0026_parent_suite_scoreboards"
down_revision = "0025_suite_scoped_scorecards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    suite_columns = {column["name"] for column in inspector.get_columns("benchmark_suites")}
    history_columns = {column["name"] for column in inspector.get_columns("benchmark_history")}
    criteria_columns = {column["name"] for column in inspector.get_columns("scorecard_criteria")}

    if "parent_suite_id" not in suite_columns:
        op.add_column("benchmark_suites", sa.Column("parent_suite_id", sa.String(100), nullable=True))
        op.create_index("ix_benchmark_suites_parent_suite_id", "benchmark_suites", ["parent_suite_id"])
    if "scoreboard_suite_id" not in history_columns:
        op.add_column("benchmark_history", sa.Column("scoreboard_suite_id", sa.String(100), nullable=True))
        op.create_index("ix_benchmark_history_scoreboard_suite_id", "benchmark_history", ["scoreboard_suite_id"])
    if "scoreboard_suite_id" not in criteria_columns:
        op.add_column("scorecard_criteria", sa.Column("scoreboard_suite_id", sa.String(100), nullable=True))
        op.create_index("ix_scorecard_criteria_scoreboard_suite_id", "scorecard_criteria", ["scoreboard_suite_id"])

    banking_members = "'finqa', 'grounded_banking', 'compliance_safety', 'document_operations', 'multilingual_quality', 'robustness_security'"
    bind.execute(sa.text(f"UPDATE benchmark_suites SET parent_suite_id = 'banking' WHERE id IN ({banking_members})"))
    bind.execute(sa.text("UPDATE benchmark_suites SET parent_suite_id = id WHERE parent_suite_id IS NULL"))
    bind.execute(sa.text(f"UPDATE benchmark_history SET scoreboard_suite_id = 'banking' WHERE suite_id IN ({banking_members})"))
    bind.execute(sa.text("UPDATE benchmark_history SET scoreboard_suite_id = suite_id WHERE scoreboard_suite_id IS NULL"))
    bind.execute(sa.text("UPDATE scorecard_criteria SET scoreboard_suite_id = CASE WHEN suite_id = 'finqa' THEN 'banking' ELSE suite_id END WHERE scoreboard_suite_id IS NULL"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    for table, column, index in (
        ("scorecard_criteria", "scoreboard_suite_id", "ix_scorecard_criteria_scoreboard_suite_id"),
        ("benchmark_history", "scoreboard_suite_id", "ix_benchmark_history_scoreboard_suite_id"),
        ("benchmark_suites", "parent_suite_id", "ix_benchmark_suites_parent_suite_id"),
    ):
        if column in {item["name"] for item in inspector.get_columns(table)}:
            op.drop_index(index, table_name=table)
            op.drop_column(table, column)
