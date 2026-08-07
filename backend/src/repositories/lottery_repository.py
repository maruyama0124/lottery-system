"""lottery_executions / assignments / monthly_member_results / lottery_settings へのアクセス層"""
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.ids import generate_id
from src.db.models import (
    Assignment,
    LotteryExecution,
    LotterySettings,
    MonthlyMemberResult,
    User,
    Vote,
)


class LotteryRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---------- 実行履歴 ----------

    def list_executions(self, pm_id: str) -> list[LotteryExecution]:
        stmt = (
            select(LotteryExecution)
            .where(
                LotteryExecution.practice_month_id == pm_id,
                LotteryExecution.is_deleted.is_(False),
            )
            .order_by(LotteryExecution.created_at.desc())
        )
        return list(self.db.scalars(stmt))

    def get_active_execution(self, pm_id: str) -> LotteryExecution | None:
        stmt = select(LotteryExecution).where(
            LotteryExecution.practice_month_id == pm_id,
            LotteryExecution.is_active.is_(True),
            LotteryExecution.is_deleted.is_(False),
        )
        return self.db.scalar(stmt)

    def deactivate_executions(self, pm_id: str) -> None:
        for ex in self.list_executions(pm_id):
            ex.is_active = False
        self.db.flush()

    def create_execution(
        self,
        *,
        pm_id: str,
        executed_by: str,
        random_seed: int,
        snapshot: dict[str, Any],
    ) -> LotteryExecution:
        ex = LotteryExecution(
            id=generate_id("lot"),
            practice_month_id=pm_id,
            executed_by=executed_by,
            random_seed=random_seed,
            # grade2_ratio は D-015 で廃止。枠は settings_snapshot に記録する
            settings_snapshot=snapshot,
            is_active=True,
        )
        self.db.add(ex)
        self.db.flush()
        return ex

    # ---------- 割当 ----------

    def get_assignment(self, assignment_id: str) -> Assignment | None:
        a = self.db.get(Assignment, assignment_id)
        return a if a and not a.is_deleted else None

    def list_assignments(self, practice_ids: list[str]) -> list[Assignment]:
        if not practice_ids:
            return []
        stmt = select(Assignment).where(
            Assignment.practice_id.in_(practice_ids), Assignment.is_deleted.is_(False)
        )
        return list(self.db.scalars(stmt))

    def delete_assignments_for_practices(self, practice_ids: list[str]) -> None:
        """再実行時の前回結果破棄 (REQ-005.12)。手動調整分も含めて破棄する"""
        for a in self.list_assignments(practice_ids):
            a.is_deleted = True
        self.db.flush()

    def create_assignment(
        self, *, practice_id: str, user_id: str, via: str, execution_id: str | None
    ) -> Assignment:
        # 過去に削除された同一 (practice, user) の行があれば再利用する (部分一意インデックス対応)
        stmt = select(Assignment).where(
            Assignment.practice_id == practice_id, Assignment.user_id == user_id
        )
        for existing in self.db.scalars(stmt):
            if existing.is_deleted:
                existing.is_deleted = False
                existing.assigned_via = via
                existing.lottery_execution_id = execution_id
                self.db.flush()
                return existing
        a = Assignment(
            id=generate_id("asg"),
            practice_id=practice_id,
            user_id=user_id,
            lottery_execution_id=execution_id,
            assigned_via=via,
        )
        self.db.add(a)
        self.db.flush()
        return a

    # ---------- 投票・メンバー (抽選入力) ----------

    def list_votes_for_practices(self, practice_ids: list[str]) -> list[Vote]:
        if not practice_ids:
            return []
        stmt = select(Vote).where(
            Vote.practice_id.in_(practice_ids), Vote.is_deleted.is_(False)
        )
        return list(self.db.scalars(stmt))

    def list_members(self, gender: str) -> list[User]:
        stmt = select(User).where(User.gender == gender, User.is_deleted.is_(False))
        return list(self.db.scalars(stmt))

    # ---------- 月次実績 (落選救済の入力: REQ-005.9) ----------

    def get_prev_stats_by_month(self, pm_id: str) -> dict[str, tuple[int, int]]:
        """user_id -> (前月の投票数, 前月の落選数) (REQ-005.9 / D-034)"""
        stmt = select(MonthlyMemberResult).where(
            MonthlyMemberResult.practice_month_id == pm_id,
            MonthlyMemberResult.is_deleted.is_(False),
        )
        return {r.user_id: (r.votes_count, r.losses_count) for r in self.db.scalars(stmt)}

    def upsert_monthly_results(
        self, pm_id: str, results: dict[str, tuple[int, int, int]]
    ) -> None:
        """user_id -> (votes, wins, losses) を保存 (結果公開時に確定)"""
        stmt = select(MonthlyMemberResult).where(
            MonthlyMemberResult.practice_month_id == pm_id
        )
        existing = {r.user_id: r for r in self.db.scalars(stmt)}
        for user_id, (votes, wins, losses) in results.items():
            row = existing.get(user_id)
            if row is None:
                self.db.add(
                    MonthlyMemberResult(
                        id=generate_id("mmr"),
                        practice_month_id=pm_id,
                        user_id=user_id,
                        votes_count=votes,
                        wins_count=wins,
                        losses_count=losses,
                    )
                )
            else:
                row.votes_count, row.wins_count, row.losses_count = votes, wins, losses
                row.is_deleted = False
        self.db.flush()

    # ---------- 設定 ----------

    def get_settings(self, gender: str) -> LotterySettings | None:
        stmt = select(LotterySettings).where(
            LotterySettings.gender == gender, LotterySettings.is_deleted.is_(False)
        )
        return self.db.scalar(stmt)

    def get_or_create_settings(self, gender: str) -> LotterySettings:
        settings = self.get_settings(gender)
        if settings is None:
            settings = LotterySettings(
                id=generate_id("set"), gender=gender, rescue_alpha=Decimal("0.5")
            )
            self.db.add(settings)
            self.db.flush()
        return settings
