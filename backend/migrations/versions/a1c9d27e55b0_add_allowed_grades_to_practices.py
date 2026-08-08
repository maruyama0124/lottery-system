"""add allowed_grades to practices

Revision ID: a1c9d27e55b0
Revises: f82ebb281c70
Create Date: 2026-08-08

学年限定の練習日 (D-037)。NULL は全学年参加可。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "a1c9d27e55b0"
down_revision: Union[str, None] = "f82ebb281c70"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("practices", sa.Column("allowed_grades", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("practices", "allowed_grades")
