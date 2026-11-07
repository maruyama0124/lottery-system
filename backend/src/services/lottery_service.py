"""抽選準備・抽選実行・実行履歴を担当するサービス。"""
import secrets
from collections import defaultdict
import logging

from sqlalchemy.orm import Session

from src.core.datetime_utils import previous_year_month, utcnow
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.db.models import PracticeMonth, User
from src.domain.lottery import GRADES, Member, PracticeDay, run_lottery
from src.repositories.lottery_repository import LotteryRepository
from src.repositories.practice_repository import PracticeMonthRepository, PracticeRepository
from src.schemas.lottery import (
    GradeVoteSummary,
    LotteryExecutionResponse,
    PracticeVoteSummary,
    QuotaUpdateRequest,
    VoteSummaryResponse,
)
from src.services.practice_service import PracticeService


# 枠の提案値: この順に優先して残枠を配る (D-015)
PRIORITY_GRADES = (3, 2, 1)

logger = logging.getLogger(__name__)


class LotteryService:
    def __init__(self, db: Session) -> None:
        self.repo = LotteryRepository(db)
        self.months = PracticeMonthRepository(db)
        self.practices = PracticeRepository(db)
        self.practice_service = PracticeService(db)

    # ---------- 抽選入力の収集 ----------

    def _collect_inputs(
        self, pm: PracticeMonth, *, include_locked: bool = False
    ) -> tuple[list[PracticeDay], list[Member], dict[str, set[str]]]:
        practices = self.practices.list_by_month(pm.id)
        if not include_locked:
            practices = [p for p in practices if not p.is_assignment_locked]
        practice_days = [
            PracticeDay(
                id=p.id,
                capacity=sum(q or 0 for q in (p.quota_grade1, p.quota_grade2, p.quota_grade3)),
                quotas={3: p.quota_grade3 or 0, 2: p.quota_grade2 or 0, 1: p.quota_grade1 or 0},
            )
            for p in practices
        ]

        votes: dict[str, set[str]] = defaultdict(set)
        for v in self.repo.list_votes_for_practices([p.id for p in practices]):
            votes[v.user_id].add(v.practice_id)

        users = self.repo.list_members(pm.gender)

        # 学年限定の日 (D-037) は、対象外学年の既存投票も抽選の入力から除外する。
        # 限定を後付けした月でも「枠より保証が強い」動き (D-029) で対象外学年が
        # 入り込まないようにするための防波堤。マネージャーは制限しない
        restricted = {p.id: set(p.allowed_grades) for p in practices if p.allowed_grades}
        if restricted:
            by_id = {u.id: u for u in users}
            for uid, pids in votes.items():
                u = by_id.get(uid)
                if u is None or u.is_manager:
                    continue
                votes[uid] = {
                    pid
                    for pid in pids
                    if pid not in restricted or u.grade in restricted[pid]
                }

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
            for u in users
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
        _days, members, votes = self._collect_inputs(pm, include_locked=True)
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
                (p.capacity if p.capacity is not None else sum(v[g] for g in (p.allowed_grades or GRADES)),
                 v, set(p.allowed_grades or GRADES))
                for p, v in zip(practices, voters_per_day)
            ],
            month_voters,
        )

        summaries: list[PracticeVoteSummary] = []
        ready = True
        for p, voters_by_grade, suggested in zip(practices, voters_per_day, suggestions):
            quotas = {3: p.quota_grade3, 2: p.quota_grade2, 1: p.quota_grade1}
            if not p.is_assignment_locked and (any(quotas[g] is None for g in GRADES)
                or p.capacity is None or p.capacity != sum(quotas[g] or 0 for g in GRADES)):
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
                            # 既存UIは全日程の提案値を一括保存する。
                            # 固定日には再配分せず、保存済み値（未設定なら0）を返す。
                            suggested_quota=(quotas[g] or 0) if p.is_assignment_locked else suggested[g],
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
           — 提案値の合計を定員にそろえるため。埋まらない席は抽選側が
             他学年へ回すので (D-027)、どの学年に置いても結果は変わらない。
             代表が合計を定員からずらして保存することはできる (D-045)

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
        pm = self.practice_service.lock_month_for_rep(rep, pm_id)
        practices = {p.id: p for p in self.practices.list_by_month_for_update(pm.id)}

        for item in data.practices:
            practice = practices.get(item.practice_id)
            if practice is None:
                raise NotFoundError(f"練習日が見つかりません: {item.practice_id}")
            quotas = {q.grade: q.quota for q in item.grades}
            if set(quotas) != set(GRADES) or len(item.grades) != len(GRADES):
                raise ValidationError("1〜3年すべての枠を指定してください")
            if practice.is_assignment_locked:
                current = {1: practice.quota_grade1 or 0, 2: practice.quota_grade2 or 0, 3: practice.quota_grade3 or 0}
                if quotas != current:
                    raise ConflictError("参加者が固定された練習日の枠は変更できません")
                continue
            # 定員は日程入力から独立させず、確定した学年枠の合計だけを用いる。
            self.practices.update_fields(practice, quota_grade1=quotas[1],
                quota_grade2=quotas[2], quota_grade3=quotas[3], capacity=sum(quotas.values()))
        self.practices.flush()

    # ---------- 抽選実行 (REQ-005) ----------

    def execute(
        self,
        rep: User,
        pm_id: str,
        *,
        seed: int | None,
        confirm_rerun: bool,
    ) -> LotteryExecutionResponse:
        pm = self.practice_service.lock_month_for_rep(rep, pm_id)

        if utcnow() <= pm.vote_ends_at:
            raise ConflictError("投票期間中は抽選を実行できません (締切後に実行してください)")

        # 枠が未設定のまま抽選すると全員落選になるため、先に設定させる (D-015)
        practices = self.practices.list_by_month_for_update(pm.id)
        unlocked = [p for p in practices if not p.is_assignment_locked]
        locked_ids = [p.id for p in practices if p.is_assignment_locked]
        if not unlocked:
            raise ConflictError("抽選対象の練習日がありません（すべて固定済みです）")
        fixed_assignments = self.repo.list_assignments(locked_ids)
        if locked_ids and (pm.status != "published" or any(
            a.publish_state != "published" for a in fixed_assignments
        )):
            raise ConflictError("固定日の割当を公開・確定してから抽選してください")
        for p in unlocked:
            if (p.quota_grade1 is None or p.quota_grade2 is None or p.quota_grade3 is None
                or p.capacity is None or p.capacity != p.quota_grade1 + p.quota_grade2 + p.quota_grade3):
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
        # 初回でも手動の割当が存在し得る。置換するのは未固定日のみ。
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
                "locked_practice_ids": locked_ids,
            },
        )
        for practice_id, member_id, via in result.assignments:
            self.repo.create_assignment(
                practice_id=practice_id, user_id=member_id, via=via, execution_id=execution.id
            )

        # 固定日の公開結果を消さない。未固定日の新結果は pending のため見えない。
        if not locked_ids or pm.status != "published":
            self.months.update_fields(pm, status="drawn", published_at=None)
        else:
            self.repo.flush()

        return self._execution_response(execution)

    def list_executions(self, rep: User, pm_id: str) -> list[LotteryExecutionResponse]:
        self.practice_service.get_month_for_rep(rep, pm_id)
        return [self._execution_response(ex) for ex in self.repo.list_executions(pm_id)]

    @staticmethod
    def _execution_response(execution) -> LotteryExecutionResponse:
        res = LotteryExecutionResponse.model_validate(execution)
        res.warnings = execution.settings_snapshot.get("warnings", [])
        return res
