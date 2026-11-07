"""微調整の差分保存・公開／再公開を行う業務処理。"""
import logging
from collections import defaultdict
from time import perf_counter

from sqlalchemy.orm import Session

from src.core.datetime_utils import utcnow
from src.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from src.core.ids import generate_id
from src.db.models import User
from src.repositories.lottery_repository import LotteryRepository
from src.repositories.practice_repository import PracticeMonthRepository, PracticeRepository
from src.repositories.user_repository import UserRepository
from src.schemas.results import AssignmentBatchRequest
from src.services.practice_service import PracticeService

logger = logging.getLogger(__name__)


class ResultCommandService:
    def __init__(self, db: Session) -> None:
        self.repo = LotteryRepository(db)
        self.months = PracticeMonthRepository(db)
        self.practices = PracticeRepository(db)
        self.users = UserRepository(db)
        self.practice_service = PracticeService(db)

    def save_assignments(self, rep: User, pm_id: str, data: AssignmentBatchRequest) -> None:
        started_at = perf_counter()
        try:
            pm = self.practice_service.lock_month_for_rep(rep, pm_id)
            if pm.status != data.expected_month_status or pm.published_at != data.expected_published_at:
                raise ConflictError("月の公開状態が変更されました。月を選び直して確認してください")
            pairs = [(c.practice_id, c.user_id) for c in data.changes]
            if len(set(pairs)) != len(pairs):
                raise ValidationError("同じ練習日・メンバーの変更が重複しています")
            practice_ids = sorted({pid for pid, _ in pairs})
            user_ids = sorted({uid for _, uid in pairs})
            practices = {p.id: p for p in self.practices.list_by_month_for_update(pm.id, practice_ids)}
            if len(practices) != len(practice_ids):
                raise NotFoundError("この月に存在しない練習日が含まれています")
            if any(p.is_assignment_locked for p in practices.values()):
                raise ConflictError("参加者が固定された練習日は変更できません")
            users = {u.id: u for u in self.users.list_for_update(user_ids)}
            if len(users) != len(user_ids):
                raise NotFoundError("メンバーが見つかりません")
            for user in users.values():
                if user.gender != pm.gender or user.is_observer:
                    raise ForbiddenError("対象月と同じ性別の参加対象メンバーのみ割当できます")
            rows = self.repo.list_assignments_for_update(practice_ids)
            active = {(a.practice_id, a.user_id): a for a in rows if not a.is_deleted}
            deleted = {(a.practice_id, a.user_id): a for a in rows if a.is_deleted}
            updates, additions = [], []
            # 全件の検証と更新計画を先に完成させる。途中で一部だけ保存しない。
            for change in data.changes:
                pair = (change.practice_id, change.user_id)
                current = active.get(pair)
                expected = (change.expected_assignment_id, change.expected_publish_state)
                actual = (current.id, current.publish_state) if current else (None, None)
                if (expected[0] is None) != (expected[1] is None):
                    raise ValidationError("変更前の割当IDと公開状態を両方指定してください")
                joined = current is not None and current.publish_state != "removing"
                if actual != expected:
                    # 応答が届かなかった保存の再送は同じ意図なら成功扱いにする。
                    retry = joined == change.participating and (
                        current is None or current.id == change.expected_assignment_id or
                        (expected == (None, None) and current.publish_state == "pending")
                    )
                    if retry:
                        continue
                    raise ConflictError("割当が変更されました。月を選び直して確認してください")
                if joined == change.participating:
                    continue
                if change.participating:
                    row = current or deleted.get(pair)
                    if row:
                        restore = current is not None
                        updates.append(dict(key_id=row.id, new_deleted=False,
                            new_state="published" if restore else "pending",
                            new_via=row.assigned_via if restore else "manual",
                            new_execution=row.lottery_execution_id if restore else None))
                    else:
                        additions.append(dict(id=generate_id("asg"), practice_id=pair[0], user_id=pair[1],
                            is_deleted=False, publish_state="pending", assigned_via="manual", lottery_execution_id=None))
                elif current:
                    removing = pm.status == "published" and current.publish_state == "published"
                    updates.append(dict(key_id=current.id, new_deleted=not removing,
                        new_state="removing" if removing else current.publish_state,
                        new_via=current.assigned_via, new_execution=current.lottery_execution_id))
            self.repo.apply_assignment_batch(updates, additions)
        finally:
            logger.info("[timing] save_assignments changes=%d %.1f ms", len(data.changes),
                        (perf_counter() - started_at) * 1000)

    # ---------- 公開 (REQ-006.4) ----------

    def publish(self, rep: User, pm_id: str) -> None:
        pm = self.practice_service.lock_month_for_rep(rep, pm_id)
        if self.repo.get_active_execution(pm.id) is None:
            raise ConflictError("抽選が未実行のため公開できません")

        practices = self.practices.list_by_month(pm.id)
        practice_ids = [p.id for p in practices]

        votes: dict[str, set[str]] = defaultdict(set)
        for v in self.repo.list_votes_for_practices(practice_ids):
            votes[v.user_id].add(v.practice_id)
        # 保留中の微調整をここで確定する (D-044)。
        # 追加予定 (pending) はメンバーに見える状態にし、削除予定 (removing) は消す
        locked_ids = {p.id for p in practices if p.is_assignment_locked}
        assignments = self.repo.list_assignments(practice_ids)
        if any(a.practice_id in locked_ids and a.publish_state != "published" for a in assignments):
            raise ConflictError("固定日に未確定の割当があります。管理者に確認してください")
        for a in assignments:
            if a.practice_id in locked_ids:
                continue
            if a.publish_state == "removing":
                self.repo.update_assignment_fields(a, is_deleted=True)
            else:
                self.repo.update_assignment_fields(a, publish_state="published")
        self.repo.flush()

        wins: dict[str, int] = defaultdict(int)
        published_assignments = self.repo.list_assignments(practice_ids)
        managers = {u.id for u in self.repo.list_result_members(pm.gender, published_assignments) if u.is_manager}
        for a in published_assignments:
            if a.user_id not in managers:
                wins[a.user_id] += 1

        # 月次実績の確定 (翌月の落選救済の入力: REQ-005.9)
        results = {
            uid: (
                len(votes[uid]),
                wins.get(uid, 0),
                max(0, len(votes[uid]) - wins.get(uid, 0)),
            )
            for uid in votes
            if uid not in managers
        }
        self.repo.upsert_monthly_results(pm.id, results)

        self.months.update_fields(pm, status="published", published_at=utcnow())
