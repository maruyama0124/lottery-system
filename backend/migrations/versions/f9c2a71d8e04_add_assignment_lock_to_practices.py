"""Protect administrator-fixed practice assignments (D-053)."""
from alembic import op
import sqlalchemy as sa

revision = "f9c2a71d8e04"
down_revision = "b9d3f6a21c57"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("practices", sa.Column(
        "is_assignment_locked", sa.Boolean(), nullable=False, server_default=sa.false()
    ))


def downgrade() -> None:
    op.drop_column("practices", "is_assignment_locked")
