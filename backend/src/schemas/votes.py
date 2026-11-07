"""本人の投票状況・投票保存の入出力スキーマ。"""
from pydantic import BaseModel, Field


class VoteStatus(BaseModel):
    practice_month_id: str
    voted_practice_ids: list[str]
    locked_practice_ids: list[str] = Field(default_factory=list)
    editable: bool  # 受付期間・本人・対象日・公開状態を確認した変更可否


class VoteUpdateRequest(BaseModel):
    practice_ids: list[str]  # 投票する練習日IDの全量 (全置換)
