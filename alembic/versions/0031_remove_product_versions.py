"""Retain the revision identifier already deployed before the repository split.

Revision ID: 0031_remove_product_versions
Revises: 0030_repair_category_snapshots

The original migration body was destructive and is intentionally not replayed
for new databases. Existing databases stamped at this revision are reconciled
by the merge migration at the current head.
"""

revision = "0031_remove_product_versions"
down_revision = "0030_repair_category_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
