"""パスワードハッシュと JWT (NFR-002.2, REQ-001)"""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from src.core.config import get_settings
from src.core.errors import UnauthorizedError

ALGORITHM = "HS256"
RESET_TOKEN_EXPIRES_MINUTES = 30
VERIFICATION_CODE_DIGITS = 6


def generate_verification_code() -> str:
    """メールアドレス確認用の6桁コード (REQ-001.5)。

    予測可能な乱数だと総当たり以前に推測されるため、secrets (CSPRNG) を使う。
    """
    return f"{secrets.randbelow(10 ** VERIFICATION_CODE_DIGITS):0{VERIFICATION_CODE_DIGITS}d}"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def _encode(payload: dict[str, Any], expires_minutes: int) -> str:
    settings = get_settings()
    payload = {
        **payload,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=expires_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def create_access_token(user_id: str, role: str, gender: str) -> str:
    settings = get_settings()
    return _encode(
        {"sub": user_id, "role": role, "gender": gender, "purpose": "access"},
        settings.jwt_expires_minutes,
    )


def create_reset_token(user_id: str) -> str:
    return _encode({"sub": user_id, "purpose": "reset"}, RESET_TOKEN_EXPIRES_MINUTES)


def decode_token(token: str, purpose: str = "access") -> dict[str, Any]:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("トークンが無効または期限切れです") from exc
    if payload.get("purpose") != purpose:
        raise UnauthorizedError("トークンの用途が不正です")
    return payload
