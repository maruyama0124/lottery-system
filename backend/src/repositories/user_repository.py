"""users テーブルへのアクセス層"""
from sqlalchemy import func, select, Select
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

    def roster(
        self, *, grade: int | None = None, is_manager: bool | None = None,
        gender: str | None = None, q: str | None = None,
        page: int = 1, per_page: int = 50,
    ) -> tuple[list[User], int]:
        stmt: Select[tuple[User]] = select(User).where(
            User.is_deleted.is_(False), User.is_observer.is_(False)
        )
        if grade is not None:
            stmt = stmt.where(User.grade == grade)
        if is_manager is not None:
            stmt = stmt.where(User.is_manager == is_manager)
        if gender is not None:
            stmt = stmt.where(User.gender == gender)
        if q:
            stmt = stmt.where(User.name.ilike(f"%{q}%"))
        stmt = stmt.order_by(User.gender, User.grade.desc(), User.name)
        total = self.db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows = list(self.db.scalars(stmt.offset((page - 1) * per_page).limit(per_page)))
        return rows, total

    def list_for_update(self, user_ids: list[str]) -> list[User]:
        return list(self.db.scalars(select(User).where(
            User.id.in_(user_ids), User.is_deleted.is_(False)
        ).order_by(User.id).with_for_update()))

    def update_role(self, user: User, role: str) -> None:
        user.role = role
        self.db.flush()

    def deactivate(self, user: User) -> None:
        user.is_deleted = True
        self.db.flush()
