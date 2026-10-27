"""月別練習・練習日・投票スキーマ (openapi.yaml 準拠)"""
from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from src.schemas.auth import Gender

# 練習時刻は30分刻みで足りるため、入力できる分を限定する (D-014)
ALLOWED_MINUTES = (0, 30)


class PracticeCreateRequest(BaseModel):
    practice_date: date
    starts_at: time
    ends_at: time
    location: str = Field(min_length=1, max_length=255)
    capacity: int | None = Field(default=None, ge=1)  # 旧クライアント互換。新画面は送信しない
    # 参加できる学年 (D-037)。省略・全学年指定は None に正規化する
    allowed_grades: list[int] | None = None
    # 備考 (D-041)。空文字は None に正規化する
    note: str | None = Field(default=None, max_length=255)

    @field_validator("note")
    @classmethod
    def _strip_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("starts_at", "ends_at")
    @classmethod
    def _half_hour_only(cls, value: time) -> time:
        if value.minute not in ALLOWED_MINUTES or value.second or value.microsecond:
            raise ValueError("練習時刻は30分単位で指定してください (例: 18:00, 18:30)")
        return value

    @field_validator("allowed_grades")
    @classmethod
    def _valid_grades(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return None
        grades = sorted(set(value))
        if not grades:
            raise ValueError("参加できる学年を1つ以上指定してください")
        if any(g not in (1, 2, 3) for g in grades):
            raise ValueError("学年は 1〜3 で指定してください")
        return None if grades == [1, 2, 3] else grades


class PracticeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    practice_date: date
    starts_at: time
    ends_at: time
    location: str
    capacity: int | None
    allowed_grades: list[int] | None = None  # None は全学年 (D-037)
    note: str | None = None  # 備考 (D-041)
    vote_count: int = 0  # 現在の投票数 (一覧表示用)

    @field_serializer("starts_at", "ends_at")
    def _format_time(self, value: time) -> str:
        return value.strftime("%H:%M")  # 秒を落として HH:MM 表示にする


class PracticeMonthCreateRequest(BaseModel):
    year_month: str = Field(pattern=r"^\d{4}-\d{2}$")
    vote_starts_at: datetime
    vote_ends_at: datetime
    practices: list[PracticeCreateRequest] = []


class PracticeCreatedResponse(PracticeResponse):
    practice_month_id: str


class GenderTargets(BaseModel):
    genders: list[Gender] = Field(min_length=1, max_length=2)

    @field_validator("genders")
    @classmethod
    def _unique_genders(cls, value: list[Gender]) -> list[Gender]:
        if len(set(value)) != len(value):
            raise ValueError("対象の性別が重複しています")
        return sorted(value)


class TargetedPracticeCreateRequest(PracticeCreateRequest):
    # 省略時は月の対象性別を引き継ぐ（旧クライアント互換）。
    genders: list[Gender] | None = Field(default=None, min_length=1, max_length=2)

    @field_validator("genders")
    @classmethod
    def _unique_targets(cls, value: list[Gender] | None) -> list[Gender] | None:
        return None if value is None else GenderTargets(genders=value).genders


class PracticeMonthBatchCreateRequest(PracticeMonthCreateRequest, GenderTargets):
    practices: list[TargetedPracticeCreateRequest] = Field(default_factory=list)


class PracticeBatchCreateRequest(GenderTargets):
    year_month: str = Field(pattern=r"^\d{4}-\d{2}$")
    practice: PracticeCreateRequest


class PracticeEditVersion(BaseModel):
    id: str
    updated_at: datetime


class PracticeGenderEditResponse(BaseModel):
    practice: PracticeResponse
    genders: list[Gender]
    available_genders: list[Gender]
    versions: dict[Gender, PracticeEditVersion]


class PracticeGenderUpdateRequest(GenderTargets):
    practice: PracticeCreateRequest
    expected_versions: dict[Gender, PracticeEditVersion] = Field(min_length=1, max_length=2)


class PracticeMonthUpdateRequest(BaseModel):
    vote_starts_at: datetime | None = None
    vote_ends_at: datetime | None = None


class PracticeMonthResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    year_month: str
    gender: Gender
    vote_starts_at: datetime
    vote_ends_at: datetime
    status: str
    published_at: datetime | None


class PracticeMonthDetailResponse(PracticeMonthResponse):
    practices: list[PracticeResponse] = []


class PracticeSuggestion(BaseModel):
    """過去に登録した練習の組み合わせ (D-014)"""

    location: str
    starts_at: time
    ends_at: time
    capacity: int | None
    use_count: int  # 過去に使われた回数。多い順に並べる

    @field_serializer("starts_at", "ends_at")
    def _format_time(self, value: time) -> str:
        return value.strftime("%H:%M")


class VoteStatus(BaseModel):
    practice_month_id: str
    voted_practice_ids: list[str]
    locked_practice_ids: list[str] = Field(default_factory=list)
    editable: bool  # 受付期間・本人・対象日・公開状態を確認した変更可否


class VoteUpdateRequest(BaseModel):
    practice_ids: list[str]  # 投票する練習日IDの全量 (全置換)
