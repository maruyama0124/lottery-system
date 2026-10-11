"""メンバー・名簿スキーマ (openapi.yaml: RosterPage / RoleUpdateRequest)"""
from typing import Literal

from pydantic import BaseModel

from src.schemas.auth import UserProfile


class RosterPage(BaseModel):
    items: list[UserProfile]
    total: int
    page: int
    per_page: int


class RoleUpdateRequest(BaseModel):
    role: Literal["member", "representative"]
