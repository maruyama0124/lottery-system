"""結果取得・微調整保存・参加表の入出力スキーマ。"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from src.schemas.practices import PracticeResponse

AssignedVia = Literal["manager", "grade3", "guaranteed", "distribution", "overflow", "manual"]


class MyResultItem(BaseModel):
    practice: PracticeResponse


class MyResults(BaseModel):
    practice_month_id: str
    assignments: list[MyResultItem]


PublishState = Literal["pending", "published", "removing"]


class Participant(BaseModel):
    assignment_id: str
    user_id: str
    name: str
    grade: int
    is_manager: bool
    assigned_via: AssignedVia
    # 公開後の微調整は再公開までメンバーに見えない (D-044)。
    # pending = 追加予定 / published = 公開済み / removing = 削除予定
    publish_state: PublishState


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
    prev_wins_count: int = 0  # 前月の当選数 (前月の公開実績が無ければ 0)
    prev_votes_count: int = 0  # 前月の投票数
    practice_ids: list[str]  # 当選した練習日
    voted_practice_ids: list[str]  # 投票した練習日 (微調整時の判断材料)


class FullResults(BaseModel):
    by_practice: list[PracticeResults]
    by_member: list[MemberResult]


class AssignmentChange(BaseModel):
    practice_id: str
    user_id: str
    participating: bool
    expected_assignment_id: str | None
    expected_publish_state: PublishState | None


class AssignmentBatchRequest(BaseModel):
    changes: list[AssignmentChange] = Field(min_length=1, max_length=5000)
    expected_month_status: Literal["draft", "voting", "closed", "drawn", "published"]
    expected_published_at: datetime | None


class ParticipationRow(BaseModel):
    """参加表の1行 — メンバー1人ぶん (REQ-006.5 / D-025)"""

    user_id: str
    name: str
    is_manager: bool
    has_voted: bool  # 月内に1日でも投票したか。未投票者も行に並ぶため (D-043)
    practice_ids: list[str]  # 参加する練習日。参加しない人は空


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
