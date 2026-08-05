"""メンバー・名簿スキーマ (openapi.yaml: UserUpdateRequest / RosterPage / RoleUpdateRequest)"""
from typing import Literal

from pydantic import BaseModel, Field

from src.schemas.auth import UserProfile


class UserUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    address: str | None = Field(default=None, min_length=1, max_length=255)
    phone_number: str | None = Field(default=None, min_length=1, max_length=20)
    grade: int | None = Field(default=None, ge=1, le=3)
    faculty_department: str | None = Field(default=None, min_length=1, max_length=100)
    student_number: str | None = Field(default=None, min_length=1, max_length=30)
    is_manager: bool | None = None


class RosterPage(BaseModel):
    items: list[UserProfile]
    total: int
    page: int
    per_page: int


class RoleUpdateRequest(BaseModel):
    role: Literal["member", "representative"]
