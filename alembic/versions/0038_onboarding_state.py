"""Persist installation-wide setup-guide dismissal and completion.

Revision ID: 0038_onboarding_state
Revises: 0037_flat_prompt_registry
"""

from alembic import op
import sqlalchemy as sa

revision = "0038_onboarding_state"
down_revision = "0037_flat_prompt_registry"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("onboarding_state"):
        return
    op.create_table(
        "onboarding_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("onboarding_state")
