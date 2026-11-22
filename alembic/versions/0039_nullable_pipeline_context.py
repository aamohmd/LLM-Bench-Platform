"""Preserve unknown pipeline context limits instead of inventing defaults."""
from alembic import op
import sqlalchemy as sa

revision = "0039_nullable_pipeline_context"
down_revision = "0038_onboarding_state"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("pipeline_configs") as batch:
        batch.alter_column("max_context_len", existing_type=sa.Integer(), nullable=True)


def downgrade():
    # Unknown measurements cannot be replaced with a truthful numeric default.
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM pipeline_configs WHERE max_context_len IS NULL")):
        raise RuntimeError("Cannot downgrade while pipeline configurations have unknown context limits")
    with op.batch_alter_table("pipeline_configs") as batch:
        batch.alter_column("max_context_len", existing_type=sa.Integer(), nullable=False)
