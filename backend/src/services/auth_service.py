"""認証サービス (REQ-001)

ログイン手段は LINE ログインのみ (D-021 / D-042)。
"""
import logging

from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.core.errors import ConflictError
from src.core.line import verify_id_token
from src.core.security import create_access_token
from src.db.models import User
from src.repositories.user_repository import UserRepository
from src.schemas.auth import (
    LineLoginResponse,
    LineRegisterRequest,
    TokenResponse,
)

logger = logging.getLogger(__name__)


class AuthService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)

    def line_login(self, id_token: str) -> LineLoginResponse:
        """LIFF から受け取った ID トークンでログインする (D-021)。

        未登録なら registered=False を返し、フロントは初回登録画面へ進む。
        """
        profile = verify_id_token(id_token)
        user = self.users.get_by_line_user_id(profile.user_id)
        if user is None or user.is_deleted:
            return LineLoginResponse(registered=False, display_name=profile.display_name)
        return LineLoginResponse(
            registered=True,
            token=self._issue_access_token(user),
            display_name=profile.display_name,
        )

    def line_register(self, data: LineRegisterRequest) -> TokenResponse:
        """初回登録 (D-021)。

        本名・学年・性別は LINE から取得できないため入力させる。
        LINE の表示名はニックネームであることが多く、代表が結果を確認できないため。
        """
        profile = verify_id_token(data.id_token)
        if self.users.get_by_line_user_id(profile.user_id):
            raise ConflictError("すでに登録されています")
        user = self.users.create(
            line_user_id=profile.user_id,
            name=data.name,
            grade=data.grade,
            gender=data.gender,
            is_manager=data.is_manager,
        )
        return self._issue_access_token(user)

    def _issue_access_token(self, user: User) -> TokenResponse:
        return TokenResponse(
            access_token=create_access_token(user.id, user.role, user.gender),
            expires_in=get_settings().jwt_expires_minutes * 60,
        )
