"""Collapse the legacy runner key role into the read-only visitor role."""

from alembic import op
import sqlalchemy as sa


revision = "0015_admin_visitor_key_roles"
down_revision = "0014_approval_run_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE api_keys SET scope = 'visitor' WHERE scope = 'runner'"))


def downgrade() -> None:
    op.execute(sa.text("UPDATE api_keys SET scope = 'runner' WHERE scope = 'visitor'"))
