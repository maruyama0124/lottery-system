"""JWT の発行と検証 (REQ-001)"""
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from src.core.config import get_settings
from src.core.errors import UnauthorizedError

ALGORITHM = "HS256"


def create_access_token(user_id: str, role: str, gender: str) -> str:
    settings = get_settings()
    payload = {
        "sub": user_id,
        "role": role,
        "gender": gender,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expires_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("トークンが無効または期限切れです") from exc
