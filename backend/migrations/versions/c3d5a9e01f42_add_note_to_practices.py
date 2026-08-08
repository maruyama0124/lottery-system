"""add note to practices

Revision ID: c3d5a9e01f42
Revises: b7e4f81c2d90
Create Date: 2026-08-09

練習日の備考 (D-041)。「練習試合の予定」のような一言。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d5a9e01f42"
down_revision: Union[str, None] = "b7e4f81c2d90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("practices", sa.Column("note", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("practices", "note")
