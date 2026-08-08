"""add is_observer to users

Revision ID: b7e4f81c2d90
Revises: a1c9d27e55b0
Create Date: 2026-08-09

閲覧専用アカウント (D-039)。投票・抽選・名簿の対象外だがログインして閲覧できる。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7e4f81c2d90"
down_revision: Union[str, None] = "a1c9d27e55b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_observer", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("users", "is_observer")
