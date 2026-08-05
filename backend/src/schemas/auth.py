"""認証系スキーマ (openapi.yaml: RegisterRequest / LoginRequest / TokenResponse 等)"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

Gender = Literal["male", "female"]


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=255)
    phone_number: str = Field(min_length=1, max_length=20)
    grade: int = Field(ge=1, le=3)
    gender: Gender
    faculty_department: str = Field(min_length=1, max_length=100)
    student_number: str = Field(min_length=1, max_length=30)
    is_manager: bool


class UserProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    name: str
    address: str
    phone_number: str
    grade: int
    gender: str
    faculty_department: str
    student_number: str
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
