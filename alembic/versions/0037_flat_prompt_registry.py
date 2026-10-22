"""Keep current prompt content directly on the registry record.

Revision ID: 0037_flat_prompt_registry
Revises: 0036_suite_sla_assignments
"""

from alembic import op
import sqlalchemy as sa

revision = "0037_flat_prompt_registry"
down_revision = "0036_suite_sla_assignments"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("prompts")}
    for name, kind in [("system_prompt", sa.Text()), ("content_hash", sa.String(64))]:
        if name not in columns:
            op.add_column("prompts", sa.Column(name, kind, nullable=True))
    # Preserve IDs, current content, timestamps, tasks and run snapshots. Former
    # archived entries remain ordinary records; no implicit deletion occurs.
    bind.execute(sa.text("""
        UPDATE prompts SET
          system_prompt = COALESCE((SELECT system_prompt FROM prompt_versions
            WHERE prompt_id = prompts.id ORDER BY version DESC LIMIT 1), system_prompt, ''),
          content_hash = COALESCE((SELECT content_hash FROM prompt_versions
            WHERE prompt_id = prompts.id ORDER BY version DESC LIMIT 1), content_hash, '')
    """))
    op.drop_table("prompt_versions")
    with op.batch_alter_table("prompts") as batch:
        batch.alter_column("system_prompt", existing_type=sa.Text(), nullable=False)
        batch.alter_column("content_hash", existing_type=sa.String(64), nullable=False)
        if "is_archived" in columns:
            batch.drop_column("is_archived")
    history = {c["name"] for c in sa.inspect(bind).get_columns("benchmark_history")}
    removable = history.intersection({"prompt_version", "base_prompt_version", "directive_version"})
    if removable:
        with op.batch_alter_table("benchmark_history") as batch:
            for name in sorted(removable):
                batch.drop_column(name)


def downgrade():
    raise RuntimeError("Removed prompt revision history cannot be reconstructed; restore a database backup to roll back.")
