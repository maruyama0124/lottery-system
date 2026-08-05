"""votes テーブルへのアクセス層"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.ids import generate_id
from src.db.models import Vote


class VoteRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_user_votes(self, user_id: str, practice_ids: list[str]) -> list[Vote]:
        """指定練習日群に対するユーザーの投票 (削除済み含む — 全置換で再利用するため)"""
        if not practice_ids:
            return []
        stmt = select(Vote).where(
            Vote.user_id == user_id, Vote.practice_id.in_(practice_ids)
        )
        return list(self.db.scalars(stmt))

    def replace_user_votes(
        self, user_id: str, month_practice_ids: list[str], selected_ids: set[str]
    ) -> None:
        """月内の投票を selected_ids に全置換する (REQ-004.3)

        既存行は is_deleted の切替で再利用する (unique 制約対応)。
        """
        existing = {v.practice_id: v for v in self.list_user_votes(user_id, month_practice_ids)}
        for pid in month_practice_ids:
            vote = existing.get(pid)
            if pid in selected_ids:
                if vote is None:
                    self.db.add(Vote(id=generate_id("vot"), user_id=user_id, practice_id=pid))
                else:
                    vote.is_deleted = False
            elif vote is not None:
                vote.is_deleted = True
        self.db.flush()
