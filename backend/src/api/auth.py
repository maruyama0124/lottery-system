"""認証エンドポイント (openapi.yaml: /auth/*)

ログイン手段は LINE ログインのみ (D-021 / D-042)。代表もメンバーと同じ経路で入り、
代表権限は後から付与される。
"""
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from src.api.deps import CurrentUser
from src.db.session import get_db
from src.schemas.auth import (
    LineLoginRequest,
    LineLoginResponse,
    LineRegisterRequest,
    TokenResponse,
)
from src.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])

DbDep = Annotated[Session, Depends(get_db)]


@router.post("/line/login", response_model=LineLoginResponse)
def line_login(data: LineLoginRequest, db: DbDep) -> LineLoginResponse:
    """LIFF の ID トークンでログインする (D-021)。未登録なら registered=False を返す"""
    return AuthService(db).line_login(data.id_token)


@router.post("/line/register", status_code=status.HTTP_201_CREATED, response_model=TokenResponse)
def line_register(data: LineRegisterRequest, db: DbDep) -> TokenResponse:
    """初回登録 (D-021)。本名・学年・性別を受け取り、そのままログイン状態にする"""
    return AuthService(db).line_register(data)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(_user: CurrentUser) -> Response:
    # JWT はステートレスのためサーバー側の破棄は不要 (クライアントがトークンを破棄する)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
