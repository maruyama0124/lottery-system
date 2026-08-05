"""use timestamptz for all datetime columns

Revision ID: 35596e50910f
Revises: 3d8f5481af09
Create Date: 2026-08-01 11:38:27.170259

D-013: 全ての日時カラムを timestamp without time zone → timestamptz へ移行する。

自動生成された alter_column 21件をテーブル定義のループに書き換え、
postgresql_using で「既存の値は UTC である」ことを明示している。
これを省くと変換時にセッションの TimeZone 設定が使われ、
UTC 以外の環境でマイグレーションを流したときに時刻がずれる。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '35596e50910f'
down_revision: Union[str, None] = '3d8f5481af09'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (テーブル名, カラム名) — DB設計書の全8テーブルの日時カラム
COLUMNS: list[tuple[str, str]] = [
    ("assignments", "created_at"),
    ("assignments", "updated_at"),
    ("lottery_executions", "created_at"),
    ("lottery_executions", "updated_at"),
    ("lottery_settings", "created_at"),
    ("lottery_settings", "updated_at"),
    ("monthly_member_results", "created_at"),
    ("monthly_member_results", "updated_at"),
    ("practice_months", "vote_starts_at"),
    ("practice_months", "vote_ends_at"),
    ("practice_months", "published_at"),
    ("practice_months", "created_at"),
    ("practice_months", "updated_at"),
    ("practices", "created_at"),
    ("practices", "updated_at"),
    ("users", "email_verified_at"),
    ("users", "verification_expires_at"),
    ("users", "created_at"),
    ("users", "updated_at"),
    ("votes", "created_at"),
    ("votes", "updated_at"),
]


def upgrade() -> None:
    for table, column in COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=postgresql.TIMESTAMP(),
            type_=sa.DateTime(timezone=True),
            # 既存の naive な値は UTC として保存されていた
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )


def downgrade() -> None:
    for table, column in reversed(COLUMNS):
        op.alter_column(
            table,
            column,
            existing_type=sa.DateTime(timezone=True),
            type_=postgresql.TIMESTAMP(),
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )
