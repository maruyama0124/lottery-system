"""drop email auth columns from users (D-047)

Revision ID: a7c2e9d14b38
Revises: e5f1a7c3b9d2
Create Date: 2026-10-03

メール + パスワード認証の廃止 (D-042) 後も残っていた 6 列を削除する。
本番では全行 NULL / 0 であることを確認済み (D-047)。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a7c2e9d14b38"
down_revision: Union[str, None] = "e5f1a7c3b9d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("users", "email")
    op.drop_column("users", "password_hash")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "verification_code_hash")
    op.drop_column("users", "verification_expires_at")
    op.drop_column("users", "verification_attempts")


def downgrade() -> None:
    op.add_column("users", sa.Column("verification_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("verification_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("verification_code_hash", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("email", sa.String(255), nullable=True))
    op.create_unique_constraint("users_email_key", "users", ["email"])