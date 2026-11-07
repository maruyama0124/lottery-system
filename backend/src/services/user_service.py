"""メンバー・名簿サービス (REQ-002, REQ-007)"""
from sqlalchemy.orm import Session

from src.core.errors import ForbiddenError, NotFoundError
from src.db.models import User
from src.repositories.user_repository import UserRepository


class UserService:
    def __init__(self, db: Session) -> None:
        self.users = UserRepository(db)

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
        return self.users.roster(grade=grade, is_manager=is_manager, gender=gender,
            q=q, page=page, per_page=per_page)

    def _get_target_in_scope(self, rep: User, user_id: str) -> User:
        """代表は男女双方のメンバーを管理できる (D-068)。"""
        if rep.role != "representative":
            raise ForbiddenError("代表権限が必要です")
        target = self.users.get_by_id(user_id)
        if target is None:
            raise NotFoundError("メンバーが見つかりません")
        return target

    def update_role(self, rep: User, user_id: str, role: str) -> None:
        """代表権限の付与・剥奪 (REQ-007.2)。

        名簿系と同様に男女全体を対象とする (D-040)。立ち上げ時に最初の代表が
        両性別の代表を任命できるようにするため。退会も男女双方を対象とする (D-068)。
        """
        target = self.users.get_by_id(user_id)
        if target is None or target.is_deleted:
            raise NotFoundError("メンバーが見つかりません")
        self.users.update_role(target, role)

    def deactivate(self, rep: User, user_id: str) -> None:
        """退会 (REQ-007.3): 論理削除。履歴は保持する"""
        target = self._get_target_in_scope(rep, user_id)
        self.users.deactivate(target)
