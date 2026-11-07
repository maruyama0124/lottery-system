"""抽選準備・実行・実行履歴の入出力スキーマ。"""
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class LotteryExecuteRequest(BaseModel):
    seed: int | None = None  # 省略時はサーバーが生成 (再現実行用)
    confirm_rerun: bool = False  # 再実行時は true 必須 (REQ-005.12)


class LotteryExecutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    practice_month_id: str
    executed_by: str
    random_seed: int
    is_active: bool
    warnings: list[str] = []
    created_at: datetime


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
    capacity: int | None
    allowed_grades: list[int] | None = None  # None は全学年 (D-037)
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
