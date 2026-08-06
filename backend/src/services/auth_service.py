"""認証サービス (REQ-001)"""
import logging
from datetime import timedelta

from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.core.datetime_utils import utcnow
from src.core.errors import AppError, ConflictError, UnauthorizedError
from src.core.mailer import send_password_reset, send_verification_code
from src.core.security import (
    create_access_token,
    create_reset_token,
    decode_token,
    generate_verification_code,
    hash_password,
    verify_password,
)
from src.core.line import verify_id_token
from src.db.models import User
from src.repositories.user_repository import UserRepository
from src.schemas.auth import (
    LineLoginResponse,
    LineRegisterRequest,
    RegisterRequest,
    TokenResponse,
)

logger = logging.getLogger(__name__)


class EmailNotVerifiedError(AppError):
    def __init__(self) -> None:
        super().__init__(
            403,
            "EMAIL_NOT_VERIFIED",
            "メールアドレスが未確認です。届いた確認コードを入力してください",
        )


class VerificationCodeError(AppError):
    """コード不一致・期限切れ・試行上限をまとめて扱う (どれも 400)。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(400, code, message)


class AuthService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)

    def register(self, data: RegisterRequest) -> User:
        if self.users.get_by_email(data.email):
            raise ConflictError("このメールアドレスは既に登録されています")
        user = self.users.create(
            email=data.email,
            password_hash=hash_password(data.password),
            name=data.name,
            grade=data.grade,
            gender=data.gender,
            is_manager=data.is_manager,
        )
        # 登録直後は未確認。確認コードの入力まではログインできない (D-011)
        self._issue_verification_code(user)
        return user

    def _issue_verification_code(self, user: User) -> None:
        """確認コードを発行して送信する (REQ-001.5)。

        コードはハッシュ化して保存し、平文は送信するメール本文にしか残さない。
        """
        settings = get_settings()
        code = generate_verification_code()
        expires_at = utcnow() + timedelta(minutes=settings.verification_code_expires_minutes)
        self.users.set_verification_code(
            user, code_hash=hash_password(code), expires_at=expires_at
        )
        send_verification_code(
            to=user.email,
            code=code,
            expires_minutes=settings.verification_code_expires_minutes,
        )

    def verify_email(self, email: str, code: str) -> TokenResponse:
        """確認コードを検証し、確認済みにしてアクセストークンを返す (REQ-001.5)。

        確認直後にログイン画面へ戻して再入力させると手間なので、
        そのままログイン状態にできるようトークンを発行する (D-014)。
        """
        settings = get_settings()
        user = self.users.get_by_email(email)

        # 存在しないメール・確認済み・コード未発行はすべて同じ応答にし、
        # どのメールアドレスが登録済みかを判別できないようにする
        if user is None or user.email_verified_at is not None:
            raise VerificationCodeError("INVALID_CODE", "確認コードが正しくありません")
        if user.verification_code_hash is None or user.verification_expires_at is None:
            raise VerificationCodeError("INVALID_CODE", "確認コードが正しくありません")

        if user.verification_attempts >= settings.verification_max_attempts:
            raise VerificationCodeError(
                "CODE_LOCKED", "入力の失敗が続いたためこのコードは無効です。再送してください"
            )
        if user.verification_expires_at < utcnow():
            raise VerificationCodeError(
                "CODE_EXPIRED", "確認コードの有効期限が切れています。再送してください"
            )

        if not verify_password(code, user.verification_code_hash):
            self.users.increment_verification_attempts(user)
            raise VerificationCodeError("INVALID_CODE", "確認コードが正しくありません")

        self.users.mark_email_verified(user, verified_at=utcnow())
        return self._issue_access_token(user)

    def resend_verification_code(self, email: str) -> None:
        """確認コードを再送する (REQ-001.6)。

        存在しないメール・確認済みでも成功扱い (メールアドレスの存在を漏らさない)。
        """
        user = self.users.get_by_email(email)
        if user is None or user.email_verified_at is not None:
            return
        self._issue_verification_code(user)

    def login(self, email: str, password: str) -> TokenResponse:
        user = self.users.get_by_email(email)
        # LINE ログインのメンバーはパスワードを持たないため、代表のみがここを通る (D-021)
        if user is None or user.password_hash is None:
            raise UnauthorizedError("メールアドレスまたはパスワードが正しくありません")
        if not verify_password(password, user.password_hash):
            raise UnauthorizedError("メールアドレスまたはパスワードが正しくありません")
        if user.email_verified_at is None:
            raise EmailNotVerifiedError()
        return self._issue_access_token(user)

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

    def request_password_reset(self, email: str) -> None:
        """リセットトークンを発行する。

        存在しないメールでも成功扱い (メールアドレスの存在を漏らさない)。
        """
        user = self.users.get_by_email(email)
        if user is None:
            return
        token = create_reset_token(user.id)
        send_password_reset(to=user.email, token=token)

    def confirm_password_reset(self, token: str, new_password: str) -> None:
        payload = decode_token(token, purpose="reset")
        user = self.users.get_by_id(payload["sub"])
        if user is None:
            raise UnauthorizedError("ユーザーが存在しません")
        self.users.update_password(user, hash_password(new_password))
