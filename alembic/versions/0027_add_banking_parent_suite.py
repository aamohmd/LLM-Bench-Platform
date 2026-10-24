"""Retain the legacy parent-suite revision without seeding domain content.

Revision ID: 0027_add_banking_parent_suite
Revises: 0026_parent_suite_scoreboards
"""

revision = "0027_add_banking_parent_suite"
down_revision = "0026_parent_suite_scoreboards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing suites remain untouched. New suites are created through the API.
    pass


def downgrade() -> None:
    pass
