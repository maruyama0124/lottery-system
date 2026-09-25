"""add publish_state to assignments

Revision ID: e5f1a7c3b9d2
Revises: c3d5a9e01f42
Create Date: 2026-09-25

割当の公開状態 (D-044)。公開後の微調整を保留にし、再公開でまとめてメンバーへ反映する。
既存データは、公開済みの月の割当を published に、それ以外を pending にする。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5f1a7c3b9d2"
down_revision: Union[str, None] = "c3d5a9e01f42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column(
            "publish_state", sa.String(length=20), nullable=False, server_default="pending"
        ),
    )
    op.create_check_constraint(
        "ck_assignments_publish_state",
        "assignments",
        "publish_state IN ('pending', 'published', 'removing')",
    )
    # すでに公開済みの月の割当はメンバーに見えているので published にそろえる
    op.execute(
        """
        UPDATE assignments a
        SET publish_state = 'published'
        FROM practices p
        JOIN practice_months pm ON pm.id = p.practice_month_id
        WHERE a.practice_id = p.id AND pm.status = 'published'
        """
    )


def downgrade() -> None:
    op.drop_constraint("ck_assignments_publish_state", "assignments", type_="check")
    op.drop_column("assignments", "publish_state")
