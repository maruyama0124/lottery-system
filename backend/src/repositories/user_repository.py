"""users テーブルへのアクセス層"""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.ids import generate_id
from src.db.models import User


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, user_id: str) -> User | None:
        user = self.db.get(User, user_id)
        return user if user and not user.is_deleted else None

    def get_by_email(self, email: str) -> User | None:
        stmt = select(User).where(User.email == email, User.is_deleted.is_(False))
        return self.db.scalar(stmt)

    def create(self, *, email: str, password_hash: str, **profile: object) -> User:
        user = User(id=generate_id("usr"), email=email, password_hash=password_hash, **profile)
        self.db.add(user)
        self.db.flush()
        return user

    def update_password(self, user: User, password_hash: str) -> None:
        user.password_hash = password_hash
        self.db.flush()

    def set_verification_code(
        self, user: User, *, code_hash: str, expires_at: datetime
    ) -> None:
        """確認コードを設定する。再送時も失敗回数をリセットする (REQ-001.6)。"""
        user.verification_code_hash = code_hash
        user.verification_expires_at = expires_at
        user.verification_attempts = 0
        self.db.flush()

    def increment_verification_attempts(self, user: User) -> None:
        user.verification_attempts += 1
        self.db.flush()

    def mark_email_verified(self, user: User, *, verified_at: datetime) -> None:
        """確認済みにし、使用済みのコードを破棄する。"""
        user.email_verified_at = verified_at
        user.verification_code_hash = None
        user.verification_expires_at = None
        user.verification_attempts = 0
        self.db.flush()
