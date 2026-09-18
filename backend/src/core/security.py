"""JWT の発行と検証 (REQ-001)"""
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from src.core.config import get_settings
from src.core.errors import UnauthorizedError

ALGORITHM = "HS256"


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


def decode_token(token: str, purpose: str = "access") -> dict[str, Any]:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("トークンが無効または期限切れです") from exc
    if payload.get("purpose") != purpose:
        raise UnauthorizedError("トークンの用途が不正です")
    return payload
