"""月別練習・練習日・投票スキーマ (openapi.yaml 準拠)"""
from datetime import date, datetime, time
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from src.schemas.auth import Gender

# 練習時刻は30分刻みで足りるため、入力できる分を限定する (D-014)
ALLOWED_MINUTES = (0, 30)


class PracticeCreateRequest(BaseModel):
    practice_date: date
    starts_at: time
    ends_at: time
    location: str = Field(min_length=1, max_length=255)
    capacity: int = Field(ge=1)

    @field_validator("starts_at", "ends_at")
    @classmethod
    def _half_hour_only(cls, value: time) -> time:
        if value.minute not in ALLOWED_MINUTES or value.second or value.microsecond:
            raise ValueError("練習時刻は30分単位で指定してください (例: 18:00, 18:30)")
        return value


class PracticeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    practice_date: date
    starts_at: time
    ends_at: time
    location: str
    capacity: int
    vote_count: int = 0  # 現在の投票数 (一覧表示用)

    @field_serializer("starts_at", "ends_at")
    def _format_time(self, value: time) -> str:
        return value.strftime("%H:%M")  # 秒を落として HH:MM 表示にする


class PracticeMonthCreateRequest(BaseModel):
    year_month: str = Field(pattern=r"^\d{4}-\d{2}$")
    vote_starts_at: datetime
    vote_ends_at: datetime
    practices: list[PracticeCreateRequest] = []


class PracticeMonthUpdateRequest(BaseModel):
    vote_starts_at: datetime | None = None
    vote_ends_at: datetime | None = None
    grade2_ratio: Decimal | None = Field(default=None, ge=0, le=1)


class PracticeMonthResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    year_month: str
    gender: Gender
    vote_starts_at: datetime
    vote_ends_at: datetime
    grade2_ratio: Decimal | None
    status: str
    published_at: datetime | None

    @field_serializer("grade2_ratio")
    def _ratio_to_float(self, value: Decimal | None) -> float | None:
        return float(value) if value is not None else None


class PracticeMonthDetailResponse(PracticeMonthResponse):
    practices: list[PracticeResponse] = []


class PracticeSuggestion(BaseModel):
    """過去に登録した練習の組み合わせ (D-014)"""

    location: str
    starts_at: time
    ends_at: time
    capacity: int
    use_count: int  # 過去に使われた回数。多い順に並べる

    @field_serializer("starts_at", "ends_at")
    def _format_time(self, value: time) -> str:
        return value.strftime("%H:%M")


class VoteStatus(BaseModel):
    practice_month_id: str
    voted_practice_ids: list[str]
    editable: bool  # 締切前かどうか


class VoteUpdateRequest(BaseModel):
    practice_ids: list[str]  # 投票する練習日IDの全量 (全置換)
