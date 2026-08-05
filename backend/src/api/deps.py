"""FastAPI 共通依存関係 — 認証・認可 (NFR-002.3, NFR-002.4)"""
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from src.core.errors import ForbiddenError, UnauthorizedError
from src.core.security import decode_token
from src.db.models import User
from src.db.session import get_db

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if credentials is None:
        raise UnauthorizedError()
    payload = decode_token(credentials.credentials)
    user = db.get(User, payload["sub"])
    if user is None or user.is_deleted:
        raise UnauthorizedError("ユーザーが存在しません")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_representative(user: CurrentUser) -> User:
    if user.role != "representative":
        raise ForbiddenError("代表権限が必要です")
    return user


Representative = Annotated[User, Depends(require_representative)]
