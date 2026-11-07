"""公開結果・参加表・管理用結果の取得とレスポンス組み立て。"""
import logging
from collections import defaultdict
from time import perf_counter

from sqlalchemy.orm import Session

from src.core.datetime_utils import previous_year_month
from src.core.errors import NotFoundError
from src.db.models import User
from src.domain.lottery import GRADES
from src.repositories.lottery_repository import LotteryRepository
from src.repositories.practice_repository import PracticeMonthRepository, PracticeRepository
from src.schemas.practices import PracticeResponse
from src.schemas.results import (
    FullResults, MemberResult, MyResultItem, MyResults, Participant,
    ParticipationGradeSection, ParticipationRow, ParticipationTable, PracticeResults,
)
from src.services.practice_service import PracticeService

logger = logging.getLogger(__name__)


class ResultQueryService:
    def __init__(self, db: Session) -> None:
        self.repo = LotteryRepository(db)
        self.months = PracticeMonthRepository(db)
        self.practices = PracticeRepository(db)
        self.practice_service = PracticeService(db)

    # ---------- 結果 (REQ-006) ----------

    def my_results(self, user: User, pm_id: str) -> MyResults:
        pm = self.practice_service.get_month_for(user, pm_id)
        if pm.status != "published":
            raise NotFoundError("抽選結果はまだ公開されていません")
        practices = {p.id: p for p in self.practices.list_by_month(pm.id)}
        items = [
            MyResultItem(practice=PracticeResponse.model_validate(practices[a.practice_id]))
            for a in self.repo.list_assignments(list(practices), visible_only=True)
            if a.user_id == user.id
        ]
        items.sort(key=lambda i: (i.practice.practice_date, i.practice.starts_at))
        return MyResults(practice_month_id=pm.id, assignments=items)

    def participation_table(self, user: User, pm_id: str) -> ParticipationTable:
        """月の練習参加表 (REQ-006.5 / D-025)

        メンバーも閲覧できる。誰がどの日に来るかを一覧するためのもので、
        氏名・学年・マネージャー区分・投票有無のみを返す（本システムはそれ以外を持たない）。
        微調整中の結果が見えると混乱するため、公開後のみ取得できる。
        """
        pm = self.practice_service.get_month_for(user, pm_id)
        if pm.status != "published":
            raise NotFoundError("抽選結果はまだ公開されていません")

        practices = self.practices.list_by_month(pm.id)
        practice_ids = [p.id for p in practices]
        assignments = self.repo.list_assignments(practice_ids, visible_only=True)
        users = {u.id: u for u in self.repo.list_result_members(pm.gender, assignments)}
        joined: dict[str, list[str]] = defaultdict(list)
        # 公開後の微調整は再公開までメンバーに見せない (D-044)
        for a in assignments:
            joined[a.user_id].append(a.practice_id)
        voters = {v.user_id for v in self.repo.list_votes_for_practices(practice_ids)}

        # かつての Excel の参加表と同じく、参加しない人・投票しなかった人も含めて
        # 全メンバーを並べる (D-043)。参加しない人は practice_ids が空になる
        sections = []
        for grade in GRADES:
            rows = [
                ParticipationRow(
                    user_id=uid,
                    name=u.name,
                    is_manager=u.is_manager,
                    has_voted=uid in voters,
                    practice_ids=sorted(joined.get(uid, [])),
                )
                for uid, u in users.items()
                if u.grade == grade
            ]
            # マネージャーは全日参加のため先頭に固め、あとは氏名順
            rows.sort(key=lambda r: (not r.is_manager, r.name))
            if rows:
                sections.append(ParticipationGradeSection(grade=grade, rows=rows))

        return ParticipationTable(
            practice_month_id=pm.id,
            year_month=pm.year_month,
            practices=[PracticeResponse.model_validate(p) for p in practices],
            grades=sections,
        )

    def full_results(self, rep: User, pm_id: str) -> FullResults:
        started_at = perf_counter()
        try:
            step_started = perf_counter()
            pm = self.practice_service.get_month_for_rep(rep, pm_id)
            logger.info(
                "[timing] full_results get_month %.1f ms",
                (perf_counter() - step_started) * 1000,
            )

            step_started = perf_counter()
            practices = self.practices.list_by_month(pm.id)
            logger.info(
                "[timing] full_results list_practices %.1f ms",
                (perf_counter() - step_started) * 1000,
            )

            step_started = perf_counter()
            assignments = self.repo.list_assignments([p.id for p in practices])
            logger.info(
                "[timing] full_results list_assignments %.1f ms",
                (perf_counter() - step_started) * 1000,
            )

            step_started = perf_counter()
            members = self.repo.list_result_members(pm.gender, assignments)
            logger.info(
                "[timing] full_results list_members %.1f ms",
                (perf_counter() - step_started) * 1000,
            )
            users = {u.id: u for u in members}

            by_practice = []
            for p in practices:
                participants = [
                    Participant(
                        assignment_id=a.id,
                        user_id=a.user_id,
                        name=users[a.user_id].name,
                        grade=users[a.user_id].grade,
                        is_manager=users[a.user_id].is_manager,
                        assigned_via=a.assigned_via,
                        publish_state=a.publish_state,
                    )
                    for a in assignments
                    if a.practice_id == p.id and a.user_id in users
                ]
                participants.sort(key=lambda x: (-x.grade, x.name))
                by_practice.append(
                    PracticeResults(
                        practice=PracticeResponse.model_validate(p), participants=participants
                    )
                )

            step_started = perf_counter()
            practice_votes = self.repo.list_votes_for_practices([p.id for p in practices])
            logger.info(
                "[timing] full_results list_votes %.1f ms",
                (perf_counter() - step_started) * 1000,
            )
            votes: dict[str, set[str]] = defaultdict(set)
            for v in practice_votes:
                votes[v.user_id].add(v.practice_id)
            wins: dict[str, list[str]] = defaultdict(list)
            for a in assignments:
                wins[a.user_id].append(a.practice_id)

            # 前月の当選/投票。微調整で誰を動かすかの判断材料 (公開済みの実績のみ)
            step_started = perf_counter()
            prev_pm = self.months.get_by_ym_gender(
                previous_year_month(pm.year_month), pm.gender
            )
            logger.info(
                "[timing] full_results get_previous_month %.1f ms",
                (perf_counter() - step_started) * 1000,
            )
            if prev_pm:
                step_started = perf_counter()
                prev = self.repo.get_month_wins_votes(prev_pm.id)
                logger.info(
                    "[timing] full_results get_previous_results %.1f ms",
                    (perf_counter() - step_started) * 1000,
                )
            else:
                prev = {}

            # 未投票のメンバーも含めて全員を並べる (D-043)。未投票者は votes_count = 0 で並び、
            # 代表が「誰が投票していないか」を結果画面で把握できる
            by_member = [
                MemberResult(
                    user_id=uid,
                    name=users[uid].name,
                    grade=users[uid].grade,
                    is_manager=users[uid].is_manager,
                    votes_count=len(votes[uid]),
                    wins_count=len(wins.get(uid, [])),
                    prev_wins_count=prev.get(uid, (0, 0))[0],
                    prev_votes_count=prev.get(uid, (0, 0))[1],
                    practice_ids=sorted(wins.get(uid, [])),
                    voted_practice_ids=sorted(votes[uid]),
                )
                for uid in sorted(users, key=lambda u: (-users[u].grade, users[u].name))
            ]
            return FullResults(by_practice=by_practice, by_member=by_member)
        finally:
            logger.info(
                "[timing] full_results %.1f ms",
                (perf_counter() - started_at) * 1000,
            )
