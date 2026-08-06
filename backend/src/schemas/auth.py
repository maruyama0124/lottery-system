"""認証系スキーマ (openapi.yaml: RegisterRequest / LoginRequest / TokenResponse 等)"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

Gender = Literal["male", "female"]


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=100)
    grade: int = Field(ge=1, le=3)
    gender: Gender
    is_manager: bool


class UserProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str | None
    name: str
    grade: int
    gender: str
    is_manager: bool
    role: str
    created_at: datetime
    updated_at: datetime


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # 秒


class LineLoginRequest(BaseModel):
    """LIFF から受け取った ID トークンでログインする (D-021)"""

    id_token: str


class LineLoginResponse(BaseModel):
    """未登録の場合は registered=False を返し、フロントは初回登録画面へ遷移する"""

    registered: bool
    token: TokenResponse | None = None
    display_name: str | None = None  # LINE の表示名 (初回登録画面の初期値に使う)


class LineRegisterRequest(BaseModel):
    """初回登録。本名・学年・性別は LINE から取得できないため入力させる (D-021)"""

    id_token: str
    name: str = Field(min_length=1, max_length=100)
    grade: int = Field(ge=1, le=3)
    gender: Gender
    is_manager: bool = False


class VerifyEmailRequest(BaseModel):
    """メールアドレス確認 (REQ-001.5)"""

    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ResendVerificationRequest(BaseModel):
    """確認コードの再送 (REQ-001.6)"""

    email: EmailStr


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=8)
