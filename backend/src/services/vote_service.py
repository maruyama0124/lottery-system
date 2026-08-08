"""投票サービス (REQ-004)"""
from sqlalchemy.orm import Session

from src.core.datetime_utils import utcnow
from src.core.errors import AppError, ConflictError
from src.db.models import User
from src.repositories.practice_repository import PracticeRepository
from src.repositories.vote_repository import VoteRepository
from src.schemas.practices import VoteStatus
from src.services.practice_service import PracticeService


class VoteService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.practice_service = PracticeService(db)
        self.practices = PracticeRepository(db)
        self.votes = VoteRepository(db)

    def get_my_votes(self, user: User, pm_id: str) -> VoteStatus:
        pm = self.practice_service.get_month_for(user, pm_id)
        practice_ids = [p.id for p in self.practices.list_by_month(pm.id)]
        voted = [
            v.practice_id
            for v in self.votes.list_user_votes(user.id, practice_ids)
            if not v.is_deleted
        ]
        editable = pm.vote_starts_at <= utcnow() <= pm.vote_ends_at
        return VoteStatus(
            practice_month_id=pm.id, voted_practice_ids=sorted(voted), editable=editable
        )

    def update_my_votes(self, user: User, pm_id: str, practice_ids: list[str]) -> None:
        """投票の全置換 (REQ-004.2)。受付期間外は 409 (REQ-004.3)"""
        pm = self.practice_service.get_month_for(user, pm_id)
        now = utcnow()
        if now < pm.vote_starts_at:
            raise ConflictError("投票受付はまだ開始されていません")
        if now > pm.vote_ends_at:
            raise ConflictError("投票は締め切られました")

        month_practices = {p.id: p for p in self.practices.list_by_month(pm.id)}
        selected = set(practice_ids)
        unknown = selected - set(month_practices)
        if unknown:
            raise AppError(
                400,
                "VALIDATION_ERROR",
                "この月に存在しない練習日が含まれています",
                details=[{"field": "practice_ids", "reason": "unknown_practice"}],
            )

        # 学年限定の練習日 (D-037)。対象外の学年は投票できない。
        # マネージャーは定員外の別枠のため制限しない
        if not user.is_manager:
            blocked = [
                pid
                for pid in selected
                if month_practices[pid].allowed_grades is not None
                and user.grade not in month_practices[pid].allowed_grades
            ]
            if blocked:
                raise AppError(
                    400,
                    "VALIDATION_ERROR",
                    "参加対象外の練習日が含まれています",
                    details=[{"field": "practice_ids", "reason": "grade_not_allowed"}],
                )

        self.votes.replace_user_votes(user.id, list(month_practices), selected)
