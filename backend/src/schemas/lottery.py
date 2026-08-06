"""抽選・結果・設定スキーマ (openapi.yaml 準拠)"""
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from src.schemas.auth import Gender
from src.schemas.practices import PracticeResponse

AssignedVia = Literal["manager", "grade3", "guaranteed", "distribution", "overflow", "manual"]


class LotteryExecuteRequest(BaseModel):
    seed: int | None = None  # 省略時はサーバーが生成 (再現実行用)
    confirm_rerun: bool = False  # 再実行時は true 必須 (REQ-005.12)


class LotteryExecutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    practice_month_id: str
    executed_by: str
    random_seed: int
    grade2_ratio: Decimal | None  # D-015 以前の実行のみ値を持つ
    is_active: bool
    warnings: list[str] = []
    created_at: datetime

    @field_serializer("grade2_ratio")
    def _ratio_to_float(self, value: Decimal | None) -> float | None:
        return float(value) if value is not None else None


class GradeVoteSummary(BaseModel):
    """ある練習日の、ある学年の投票状況と枠 (D-015)"""

    grade: int
    voters: int  # その日に投票した人数
    quota: int | None  # 代表が設定した参加人数枠。未設定なら null
    suggested_quota: int  # 投票数の比率で按分した提案値


class PracticeVoteSummary(BaseModel):
    practice_id: str
    practice_date: date
    starts_at: str
    ends_at: str
    location: str
    capacity: int
    grades: list[GradeVoteSummary]  # 3年 → 1年の順

    @property
    def total_quota(self) -> int:
        return sum(g.quota or 0 for g in self.grades)


class VoteSummaryResponse(BaseModel):
    """抽選前の調整画面に出す、その月の投票状況 (REQ-005.5 / D-015)"""

    practice_month_id: str
    quotas_ready: bool  # 全練習日の全学年に枠が設定済みか（抽選できるか）
    practices: list[PracticeVoteSummary]


class GradeQuotaInput(BaseModel):
    grade: int = Field(ge=1, le=3)
    quota: int = Field(ge=0)


class PracticeQuotaInput(BaseModel):
    practice_id: str
    grades: list[GradeQuotaInput]


class QuotaUpdateRequest(BaseModel):
    """日別・学年別の参加人数枠をまとめて保存する (D-015)"""

    practices: list[PracticeQuotaInput]


class MyResultItem(BaseModel):
    practice: PracticeResponse


class MyResults(BaseModel):
    practice_month_id: str
    assignments: list[MyResultItem]


class Participant(BaseModel):
    assignment_id: str
    user_id: str
    name: str
    grade: int
    is_manager: bool
    assigned_via: AssignedVia


class PracticeResults(BaseModel):
    practice: PracticeResponse
    participants: list[Participant]


class MemberResult(BaseModel):
    user_id: str
    name: str
    grade: int
    is_manager: bool
    votes_count: int
    wins_count: int
    practice_ids: list[str]


class FullResults(BaseModel):
    by_practice: list[PracticeResults]
    by_member: list[MemberResult]


class AssignmentCreateRequest(BaseModel):
    user_id: str


class AssignmentCreated(BaseModel):
    assignment_id: str
    capacity_exceeded: bool  # 定員超過の警告 (REQ-006.3)


class LotterySettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    gender: Gender
    rescue_alpha: Decimal

    @field_serializer("rescue_alpha")
    def _alpha_to_float(self, value: Decimal) -> float:
        return float(value)


class LotterySettingsUpdateRequest(BaseModel):
    rescue_alpha: Decimal = Field(ge=0)


class ParticipationRow(BaseModel):
    """参加表の1行 — メンバー1人ぶん (REQ-006.5 / D-025)"""

    user_id: str
    name: str
    is_manager: bool
    practice_ids: list[str]  # 参加する練習日


class ParticipationGradeSection(BaseModel):
    """学年ごとの区切り。1年が最大45人程度になるため学年で分ける"""

    grade: int
    rows: list[ParticipationRow]


class ParticipationTable(BaseModel):
    """月の練習参加表。縦にメンバー・横に練習日の表を組むためのデータ"""

    practice_month_id: str
    year_month: str
    practices: list[PracticeResponse]
    grades: list[ParticipationGradeSection]
