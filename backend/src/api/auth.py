"""認証エンドポイント (openapi.yaml: /auth/*)"""
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from src.api.deps import CurrentUser
from src.db.session import get_db
from src.schemas.auth import (
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    RegisterRequest,
    ResendVerificationRequest,
    TokenResponse,
    UserProfile,
    VerifyEmailRequest,
)
from src.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])

DbDep = Annotated[Session, Depends(get_db)]


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=UserProfile)
def register(data: RegisterRequest, db: DbDep) -> UserProfile:
    user = AuthService(db).register(data)
    return UserProfile.model_validate(user)


@router.post("/verify", response_model=TokenResponse)
def verify_email(data: VerifyEmailRequest, db: DbDep) -> TokenResponse:
    # 確認完了と同時にログイン状態にするためトークンを返す (D-014)
    return AuthService(db).verify_email(data.email, data.code)


@router.post("/verify/resend", status_code=status.HTTP_204_NO_CONTENT)
def resend_verification(data: ResendVerificationRequest, db: DbDep) -> Response:
    AuthService(db).resend_verification_code(data.email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: DbDep) -> TokenResponse:
    return AuthService(db).login(data.email, data.password)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(_user: CurrentUser) -> Response:
    # JWT はステートレスのためサーバー側の破棄は不要 (クライアントがトークンを破棄する)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password-reset/request", status_code=status.HTTP_204_NO_CONTENT)
def password_reset_request(data: PasswordResetRequest, db: DbDep) -> Response:
    AuthService(db).request_password_reset(data.email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT)
def password_reset_confirm(data: PasswordResetConfirm, db: DbDep) -> Response:
    AuthService(db).confirm_password_reset(data.token, data.new_password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
