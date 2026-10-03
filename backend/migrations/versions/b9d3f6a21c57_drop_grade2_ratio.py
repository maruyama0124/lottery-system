"""drop grade2_ratio from practice_months and lottery_executions (D-048)

Revision ID: b9d3f6a21c57
Revises: a7c2e9d14b38
Create Date: 2026-10-03

D-015 で月単位の学年枠比率を廃止した後も残っていた grade2_ratio を 2 テーブルから削除する。
本番では両テーブルとも全行 NULL であることを確認済み (D-048)。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b9d3f6a21c57"
down_revision: Union[str, None] = "a7c2e9d14b38"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("practice_months", "grade2_ratio")
    op.drop_column("lottery_executions", "grade2_ratio")


def downgrade() -> None:
    op.add_column(
        "lottery_executions",
        sa.Column("grade2_ratio", sa.Numeric(precision=3, scale=2), nullable=True),
    )
    op.add_column(
        "practice_months",
        sa.Column("grade2_ratio", sa.Numeric(precision=3, scale=2), nullable=True),
    )
