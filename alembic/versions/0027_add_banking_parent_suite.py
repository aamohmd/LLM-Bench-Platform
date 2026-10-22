"""Add the Banking parent suite to the visible suite inventory.

Revision ID: 0027_add_banking_parent_suite
Revises: 0026_parent_suite_scoreboards
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0027_add_banking_parent_suite"
down_revision = "0026_parent_suite_scoreboards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    exists = bind.execute(sa.text("SELECT 1 FROM benchmark_suites WHERE id = 'banking'")).first()
    if not exists:
        columns = {column["name"] for column in inspect(bind).get_columns("benchmark_suites")}
        if "is_required" in columns:
            bind.execute(sa.text("""
                INSERT INTO benchmark_suites (id, parent_suite_id, name, domain, description, task_count, is_required, is_active, created_at, updated_at)
                VALUES ('banking', 'banking', 'Banking', 'banking', 'Six-category banking benchmark suite.', 320, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """))
        else:
            bind.execute(sa.text("""
                INSERT INTO benchmark_suites (id, parent_suite_id, name, domain, description, task_count, is_active, created_at, updated_at)
                VALUES ('banking', 'banking', 'Banking', 'banking', 'Six-category banking benchmark suite.', 320, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """))


def downgrade() -> None:
    op.execute("DELETE FROM benchmark_suites WHERE id = 'banking'")
