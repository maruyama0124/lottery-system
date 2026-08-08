"""抽選・結果サービス (REQ-005, REQ-006) — 抽選エンジンと DB を接続する"""
import secrets
from collections import defaultdict

from sqlalchemy.orm import Session

from src.core.datetime_utils import utcnow
from src.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from src.db.models import PracticeMonth, User
from src.domain.lottery import GRADES, Member, PracticeDay, run_lottery
from src.repositories.lottery_repository import LotteryRepository
from src.repositories.practice_repository import PracticeMonthRepository, PracticeRepository
from src.repositories.user_repository import UserRepository
from src.schemas.lottery import (
    AssignmentCreated,
    FullResults,
    GradeVoteSummary,
    LotteryExecutionResponse,
    MemberResult,
    MyResultItem,
    MyResults,
    Participant,
    ParticipationGradeSection,
    ParticipationRow,
    ParticipationTable,
    PracticeResults,
    PracticeVoteSummary,
    QuotaUpdateRequest,
    VoteSummaryResponse,
)
from src.schemas.practices import PracticeResponse
from src.services.practice_service import PracticeService


# 枠の提案値: この順に優先して残枠を配る (D-015)
PRIORITY_GRADES = (3, 2, 1)


def previous_year_month(year_month: str) -> str:
    year, month = map(int, year_month.split("-"))
    if month == 1:
        return f"{year - 1}-12"
    return f"{year}-{month - 1:02d}"


class LotteryService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = LotteryRepository(db)
        self.months = PracticeMonthRepository(db)
        self.practices = PracticeRepository(db)
        self.users = UserRepository(db)
        self.practice_service = PracticeService(db)

    # ---------- 抽選入力の収集 ----------

    def _collect_inputs(
        self, pm: PracticeMonth
    ) -> tuple[list[PracticeDay], list[Member], dict[str, set[str]]]:
        practices = self.practices.list_by_month(pm.id)
        practice_days = [
            PracticeDay(
                id=p.id,
                capacity=p.capacity,
                quotas={3: p.quota_grade3 or 0, 2: p.quota_grade2 or 0, 1: p.quota_grade1 or 0},
            )
            for p in practices
        ]

        votes: dict[str, set[str]] = defaultdict(set)
        for v in self.repo.list_votes_for_practices([p.id for p in practices]):
            votes[v.user_id].add(v.practice_id)

        # 前月の落選数 (REQ-005.9)
        prev_pm = self.months.get_by_ym_gender(previous_year_month(pm.year_month), pm.gender)
        prev_stats = self.repo.get_prev_stats_by_month(prev_pm.id) if prev_pm else {}

        members = [
            Member(
                id=u.id,
                grade=u.grade,
                is_manager=u.is_manager,
                prev_votes=prev_stats.get(u.id, (0, 0))[0],
                prev_losses=prev_stats.get(u.id, (0, 0))[1],
            )
            for u in self.repo.list_members(pm.gender)
            if votes.get(u.id)
        ]
        return practice_days, members, dict(votes)

    # ---------- 抽選前の投票状況と枠 (REQ-005.5 / D-015) ----------

    def vote_summary(self, rep: User, pm_id: str) -> VoteSummaryResponse:
        """日ごと・学年ごとの投票数と、代表が設定した枠を返す。

        枠が未設定の日は、その日の学年別投票数で定員を按分した提案値を出す。
        """
        pm = self.practice_service.get_month_for_rep(rep, pm_id)
        practices = self.practices.list_by_month(pm.id)
        _days, members, votes = self._collect_inputs(pm)
        grade_of = {m.id: m.grade for m in members if not m.is_manager}

        # 日ごとの学年別投票者数
        voters_per_day: list[dict[int, int]] = []
        for p in practices:
            counts = {g: 0 for g in GRADES}
            for member_id, voted in votes.items():
                grade = grade_of.get(member_id)
                if grade is not None and p.id in voted:
                    counts[grade] += 1
            voters_per_day.append(counts)

        # 月内に1回でも投票した人数（学年別）
        month_voters = {g: 0 for g in GRADES}
        for member_id, voted in votes.items():
            grade = grade_of.get(member_id)
            if grade is not None and voted:
                month_voters[grade] += 1

        suggestions = self._suggest_quotas(
            [
                (p.capacity, v, set(p.allowed_grades or GRADES))
                for p, v in zip(practices, voters_per_day)
            ],
            month_voters,
        )

        summaries: list[PracticeVoteSummary] = []
        ready = True
        for p, voters_by_grade, suggested in zip(practices, voters_per_day, suggestions):
            quotas = {3: p.quota_grade3, 2: p.quota_grade2, 1: p.quota_grade1}
            if any(quotas[g] is None for g in GRADES):
                ready = False

            summaries.append(
                PracticeVoteSummary(
                    practice_id=p.id,
                    practice_date=p.practice_date,
                    starts_at=p.starts_at.strftime("%H:%M"),
                    ends_at=p.ends_at.strftime("%H:%M"),
                    location=p.location,
                    capacity=p.capacity,
                    allowed_grades=p.allowed_grades,
                    grades=[
                        GradeVoteSummary(
                            grade=g,
                            voters=voters_by_grade[g],
                            quota=quotas[g],
                            suggested_quota=suggested[g],
                        )
                        for g in GRADES
                    ],
                )
            )
        return VoteSummaryResponse(
            practice_month_id=pm.id, quotas_ready=ready, practices=summaries
        )

    @staticmethod
    def base_shares(capacity: int) -> dict[int, int]:
        """定員を学年数で等分した「基準」。端数は 3年 → 2年 → 1年 の順に1ずつ足す"""
        base, extra = divmod(capacity, len(GRADES))
        shares = {g: base for g in GRADES}
        for g in PRIORITY_GRADES[:extra]:
            shares[g] += 1
        return shares

    @staticmethod
    def _suggest_quotas(
        days: list[tuple[int, dict[int, int], set[int]]],  # (定員, 学年->投票者数, 参加できる学年)
        month_voters: dict[int, int],  # 学年 -> 月内に1回でも投票した人数 (現在は未使用)
    ) -> list[dict[int, int]]:
        """日ごとの枠の初期値を提案する (D-031)。日ごとに完結し、月をまたぐ按分はしない。

        1. 基準は定員の等分（定員30なら各学年10）
        2. 各学年に「その日の投票者数」と「基準」の少ないほうを割り当てる
           — 投票が基準に満たない学年の枠は、書いても埋まらないため
        3. 余った席は 3年 → 2年 → 1年 の順に、投票者数を上限として配る
           — 上級生優先の方針 (D-015) をここでも踏襲する
        4. それでも余る席（全学年の投票者が定員未満の日）は1年に載せる
           — 保存時に合計＝定員が要求されるため。埋まらない席は抽選側が
             他学年へ回すので (D-027)、どの学年に置いても結果は変わらない

        一度 D-028 で「常に 10/10/10」の固定値にしたが、投票が足りない日にも
        10 と表示されるのは逆に分かりにくいという指摘で本方式に戻した。
        代表は画面で自由に増減できる。
        """
        result: list[dict[int, int]] = []
        for capacity, voters, allowed in days:
            # 学年限定の日 (D-037) は、参加できる学年の中だけで等分・配分する
            in_play = [g for g in PRIORITY_GRADES if g in allowed] or list(PRIORITY_GRADES)
            base, extra = divmod(capacity, len(in_play))
            shares = {g: 0 for g in GRADES}
            for i, g in enumerate(in_play):
                shares[g] = base + (1 if i < extra else 0)
            quotas = {g: min(voters.get(g, 0), shares[g]) for g in GRADES}
            free = capacity - sum(quotas.values())
            for g in in_play:
                take = min(max(0, voters.get(g, 0) - quotas[g]), free)
                quotas[g] += take
                free -= take
            quotas[in_play[-1]] += free  # 誰も埋められない席
            result.append(quotas)
        return result

    # ---------- 枠の保存 (D-015) ----------

    def update_quotas(self, rep: User, pm_id: str, data: QuotaUpdateRequest) -> None:
        pm = self.practice_service.get_month_for_rep(rep, pm_id)
        practices = {p.id: p for p in self.practices.list_by_month(pm.id)}

        for item in data.practices:
            practice = practices.get(item.practice_id)
            if practice is None:
                raise NotFoundError(f"練習日が見つかりません: {item.practice_id}")
            quotas = {q.grade: q.quota for q in item.grades}
            if set(quotas) != set(GRADES):
                raise ValidationError("1〜3年すべての枠を指定してください")
            total = sum(quotas.values())
            if total != practice.capacity:
                raise ValidationError(
                    f"{practice.practice_date} の学年別枠の合計 ({total}名) が"
                    f"定員 ({practice.capacity}名) と一致しません"
                )
            practice.quota_grade1 = quotas[1]
            practice.quota_grade2 = quotas[2]
            practice.quota_grade3 = quotas[3]
        self.db.flush()

    # ---------- 抽選実行 (REQ-005) ----------

    def execute(
        self,
        rep: User,
        pm_id: str,
        *,
        seed: int | None,
        confirm_rerun: bool,
    ) -> LotteryExecutionResponse:
        pm = self.practice_service.get_month_for_rep(rep, pm_id)

        if utcnow() <= pm.vote_ends_at:
            raise ConflictError("投票期間中は抽選を実行できません (締切後に実行してください)")

        # 枠が未設定のまま抽選すると全員落選になるため、先に設定させる (D-015)
        for p in self.practices.list_by_month(pm.id):
            if p.quota_grade1 is None or p.quota_grade2 is None or p.quota_grade3 is None:
                raise ConflictError(
                    "学年別の参加人数枠が未設定の練習日があります。"
                    "投票状況を確認して枠を設定してから抽選を実行してください"
                )

        active = self.repo.get_active_execution(pm.id)
        if active is not None and not confirm_rerun:
            raise ConflictError(
                "抽選は実行済みです。再実行する場合は confirm_rerun=true を指定してください "
                "(前回の結果は破棄されます)"
            )

        practice_days, members, votes = self._collect_inputs(pm)
        settings = self.repo.get_or_create_settings(pm.gender)
        rescue_alpha = float(settings.rescue_alpha)
        random_seed = seed if seed is not None else secrets.randbelow(2**62)

        result = run_lottery(
            practices=practice_days,
            members=members,
            votes=votes,
            rescue_alpha=rescue_alpha,
            seed=random_seed,
        )

        # 再実行: 前回結果を破棄 (REQ-005.12)
        if active is not None:
            self.repo.deactivate_executions(pm.id)
            self.repo.delete_assignments_for_practices([p.id for p in practice_days])

        execution = self.repo.create_execution(
            pm_id=pm.id,
            executed_by=rep.id,
            random_seed=random_seed,
            snapshot={
                "rescue_alpha": rescue_alpha,
                "warnings": result.warnings,
                # 実行時の枠を記録し、後から再現・検証できるようにする (REQ-005.11 / D-015)
                "quotas": {p.id: p.quotas for p in practice_days},
            },
        )
        for practice_id, member_id, via in result.assignments:
            self.repo.create_assignment(
                practice_id=practice_id, user_id=member_id, via=via, execution_id=execution.id
            )

        pm.status = "drawn"
        pm.published_at = None  # 再実行時は非公開に戻す (REQ-006.4)
        self.db.flush()

        return self._execution_response(execution)

    def list_executions(self, rep: User, pm_id: str) -> list[LotteryExecutionResponse]:
        self.practice_service.get_month_for_rep(rep, pm_id)
        return [self._execution_response(ex) for ex in self.repo.list_executions(pm_id)]

    @staticmethod
    def _execution_response(execution) -> LotteryExecutionResponse:
        res = LotteryExecutionResponse.model_validate(execution)
        res.warnings = execution.settings_snapshot.get("warnings", [])
        return res

    # ---------- 結果 (REQ-006) ----------

    def my_results(self, user: User, pm_id: str) -> MyResults:
        pm = self.practice_service.get_month_for(user, pm_id)
        if pm.status != "published":
            raise NotFoundError("抽選結果はまだ公開されていません")
        practices = {p.id: p for p in self.practices.list_by_month(pm.id)}
        items = [
            MyResultItem(practice=PracticeResponse.model_validate(practices[a.practice_id]))
            for a in self.repo.list_assignments(list(practices))
            if a.user_id == user.id
        ]
        items.sort(key=lambda i: (i.practice.practice_date, i.practice.starts_at))
        return MyResults(practice_month_id=pm.id, assignments=items)

    def participation_table(self, user: User, pm_id: str) -> ParticipationTable:
        """月の練習参加表 (REQ-006.5 / D-025)

        メンバーも閲覧できる。誰がどの日に来るかを一覧するためのもので、
        氏名・学年・マネージャー区分のみを返す（本システムはそれ以外を持たない）。
        微調整中の結果が見えると混乱するため、公開後のみ取得できる。
        """
        pm = self.practice_service.get_month_for(user, pm_id)
        if pm.status != "published":
            raise NotFoundError("抽選結果はまだ公開されていません")

        practices = self.practices.list_by_month(pm.id)
        users = {u.id: u for u in self.repo.list_members(pm.gender)}

        joined: dict[str, list[str]] = defaultdict(list)
        for a in self.repo.list_assignments([p.id for p in practices]):
            joined[a.user_id].append(a.practice_id)

        sections = []
        for grade in GRADES:
            rows = [
                ParticipationRow(
                    user_id=uid,
                    name=users[uid].name,
                    is_manager=users[uid].is_manager,
                    practice_ids=sorted(pids),
                )
                for uid, pids in joined.items()
                if uid in users and users[uid].grade == grade
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
        pm = self.practice_service.get_month_for_rep(rep, pm_id)
        practices = self.practices.list_by_month(pm.id)
        assignments = self.repo.list_assignments([p.id for p in practices])
        users = {u.id: u for u in self.repo.list_members(pm.gender)}

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

        votes: dict[str, set[str]] = defaultdict(set)
        for v in self.repo.list_votes_for_practices([p.id for p in practices]):
            votes[v.user_id].add(v.practice_id)
        wins: dict[str, list[str]] = defaultdict(list)
        for a in assignments:
            wins[a.user_id].append(a.practice_id)

        # 前月の当選/投票。微調整で誰を動かすかの判断材料 (公開済みの実績のみ)
        prev_pm = self.months.get_by_ym_gender(
            previous_year_month(pm.year_month), pm.gender
        )
        prev = self.repo.get_month_wins_votes(prev_pm.id) if prev_pm else {}

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
            for uid in sorted(votes, key=lambda u: (-users[u].grade, users[u].name))
            if uid in users
        ]
        return FullResults(by_practice=by_practice, by_member=by_member)

    # ---------- 微調整 (REQ-006.3) ----------

    def add_assignment(self, rep: User, practice_id: str, user_id: str) -> AssignmentCreated:
        practice = self.practices.get(practice_id)
        if practice is None:
            raise NotFoundError("練習日が見つかりません")
        self.practice_service.get_month_for_rep(rep, practice.practice_month_id)

        target = self.users.get_by_id(user_id)
        if target is None:
            raise NotFoundError("メンバーが見つかりません")
        if target.gender != rep.gender:
            raise ForbiddenError("担当性別以外のメンバーは割当できません")

        existing = self.repo.list_assignments([practice_id])
        if any(a.user_id == user_id for a in existing):
            raise ConflictError("このメンバーは既にこの練習日に割当済みです")

        assignment = self.repo.create_assignment(
            practice_id=practice_id, user_id=user_id, via="manual", execution_id=None
        )
        player_count = sum(
            1
            for a in self.repo.list_assignments([practice_id])
            if a.assigned_via != "manager"
        )
        return AssignmentCreated(
            assignment_id=assignment.id,
            capacity_exceeded=player_count > practice.capacity,
        )

    def remove_assignment(self, rep: User, assignment_id: str) -> None:
        assignment = self.repo.get_assignment(assignment_id)
        if assignment is None:
            raise NotFoundError("割当が見つかりません")
        practice = self.practices.get(assignment.practice_id)
        if practice is None:
            raise NotFoundError("練習日が見つかりません")
        self.practice_service.get_month_for_rep(rep, practice.practice_month_id)
        assignment.is_deleted = True
        self.db.flush()

    # ---------- 公開 (REQ-006.4) ----------

    def publish(self, rep: User, pm_id: str) -> None:
        pm = self.practice_service.get_month_for_rep(rep, pm_id)
        if self.repo.get_active_execution(pm.id) is None:
            raise ConflictError("抽選が未実行のため公開できません")

        practices = self.practices.list_by_month(pm.id)
        practice_ids = [p.id for p in practices]

        votes: dict[str, set[str]] = defaultdict(set)
        for v in self.repo.list_votes_for_practices(practice_ids):
            votes[v.user_id].add(v.practice_id)
        wins: dict[str, int] = defaultdict(int)
        managers = {u.id for u in self.repo.list_members(pm.gender) if u.is_manager}
        for a in self.repo.list_assignments(practice_ids):
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

        pm.status = "published"
        pm.published_at = utcnow()
        self.db.flush()
