"""メンバー・名簿サービス (REQ-002, REQ-007)"""
import csv
import io

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.errors import ForbiddenError, NotFoundError
from src.db.models import User
from src.repositories.user_repository import UserRepository
from src.schemas.users import UserUpdateRequest

# 個人情報は Google フォームで管理するため、本システムは氏名・学年・性別のみ扱う (D-021)
CSV_HEADERS = ["名前", "学年", "性別", "区分", "権限"]


def _roster_stmt(
    grade: int | None, is_manager: bool | None, gender: str | None, q: str | None
):
    # 閲覧専用アカウント (D-039) は名簿・追加候補のどこにも出さない
    stmt = select(User).where(User.is_deleted.is_(False), User.is_observer.is_(False))
    if grade is not None:
        stmt = stmt.where(User.grade == grade)
    if is_manager is not None:
        stmt = stmt.where(User.is_manager.is_(is_manager))
    if gender is not None:
        stmt = stmt.where(User.gender == gender)
    if q:
        stmt = stmt.where(User.name.ilike(f"%{q}%"))
    return stmt.order_by(User.gender, User.grade.desc(), User.name)


class UserService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)

    def update_me(self, user: User, data: UserUpdateRequest) -> None:
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(user, field, value)
        self.db.flush()

    def roster(
        self,
        *,
        grade: int | None = None,
        is_manager: bool | None = None,
        gender: str | None = None,
        q: str | None = None,
        page: int = 1,
        per_page: int = 50,
    ) -> tuple[list[User], int]:
        """名簿一覧 (REQ-007.1)。男女全体を対象とする (D-008)"""
        stmt = _roster_stmt(grade, is_manager, gender, q)
        total = self.db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows = list(self.db.scalars(stmt.offset((page - 1) * per_page).limit(per_page)))
        return rows, total

    def roster_csv(
        self,
        *,
        grade: int | None = None,
        is_manager: bool | None = None,
        gender: str | None = None,
        q: str | None = None,
    ) -> str:
        """名簿CSV (REQ-007.1.2)。絞り込み結果をそのまま出力する"""
        rows = list(self.db.scalars(_roster_stmt(grade, is_manager, gender, q)))
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(CSV_HEADERS)
        for u in rows:
            writer.writerow([
                u.name, f"{u.grade}年",
                "男" if u.gender == "male" else "女",
                "マネージャー" if u.is_manager else "プレイヤー",
                "代表" if u.role == "representative" else "メンバー",
            ])
        return buf.getvalue()

    def _get_target_in_scope(self, rep: User, user_id: str) -> User:
        """操作系は担当性別のみ (NFR-002.4)"""
        target = self.users.get_by_id(user_id)
        if target is None:
            raise NotFoundError("メンバーが見つかりません")
        if target.gender != rep.gender:
            raise ForbiddenError("担当性別以外のメンバーは操作できません")
        return target

    def update_role(self, rep: User, user_id: str, role: str) -> None:
        """代表権限の付与・剥奪 (REQ-007.2)。

        名簿系と同様に男女全体を対象とする (D-040)。立ち上げ時に最初の代表が
        両性別の代表を任命できるようにするため。退会 (deactivate) は従来どおり
        担当性別のみ
        """
        target = self.users.get_by_id(user_id)
        if target is None or target.is_deleted:
            raise NotFoundError("メンバーが見つかりません")
        target.role = role
        self.db.flush()

    def deactivate(self, rep: User, user_id: str) -> None:
        """退会 (REQ-007.3): 論理削除。履歴は保持する"""
        target = self._get_target_in_scope(rep, user_id)
        target.is_deleted = True
        self.db.flush()
