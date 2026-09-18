"""users テーブルへのアクセス層"""
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

    def get_by_line_user_id(self, line_user_id: str) -> User | None:
        """LINE ログインの本人特定 (D-021)"""
        stmt = select(User).where(User.line_user_id == line_user_id)
        return self.db.scalar(stmt)

    def create(self, **profile: object) -> User:
        """LINE ログインで本人を特定するため line_user_id を必ず持つ (D-021)"""
        user = User(id=generate_id("usr"), **profile)
        self.db.add(user)
        self.db.flush()
        return user
