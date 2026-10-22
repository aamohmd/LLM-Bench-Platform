"""Create benchmark tables from the application metadata."""

from alembic import op
import sqlalchemy as sa

from backend.app.repositories.history_store import Base


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Later historical migrations seed this legacy shape. Do not derive its
    # columns from the current, unversioned PromptRecord on a fresh install.
    sa.Table(
        "prompts", sa.MetaData(),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    ).create(op.get_bind(), checkfirst=True)
    # Metadata create is intentional here: this is the baseline for databases
    # that predate Alembic. Later revisions contain explicit drift changes.
    Base.metadata.create_all(op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(op.get_bind())
