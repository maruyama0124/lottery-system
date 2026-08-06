"""メンバー・名簿スキーマ (openapi.yaml: UserUpdateRequest / RosterPage / RoleUpdateRequest)"""
from typing import Literal

from pydantic import BaseModel, Field

from src.schemas.auth import UserProfile


class UserUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    grade: int | None = Field(default=None, ge=1, le=3)
    is_manager: bool | None = None


class RosterPage(BaseModel):
    items: list[UserProfile]
    total: int
    page: int
    per_page: int


class RoleUpdateRequest(BaseModel):
    role: Literal["member", "representative"]
