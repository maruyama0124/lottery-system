"""練習日程管理サービス (REQ-003)"""
from sqlalchemy.orm import Session

from src.core.datetime_utils import to_utc
from src.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from src.db.models import Practice, PracticeMonth, User
from src.repositories.practice_repository import PracticeMonthRepository, PracticeRepository
from src.schemas.practices import (
    PracticeCreateRequest,
    PracticeMonthCreateRequest,
    PracticeMonthUpdateRequest,
)


class PracticeService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.months = PracticeMonthRepository(db)
        self.practices = PracticeRepository(db)

    # ---------- 取得 ----------

    def get_month_for(self, user: User, pm_id: str) -> PracticeMonth:
        """閲覧は性別を問わず可 (D-038)。投票などの書き込みは呼び出し側で性別を確認する"""
        pm = self.months.get(pm_id)
        if pm is None:
            raise NotFoundError("月別練習が見つかりません")
        return pm

    def get_month_for_rep(self, rep: User, pm_id: str) -> PracticeMonth:
        """代表の操作系: 担当性別のみ (NFR-002.4)"""
        pm = self.months.get(pm_id)
        if pm is None:
            raise NotFoundError("月別練習が見つかりません")
        if pm.gender != rep.gender:
            raise ForbiddenError("担当性別以外の月別練習は操作できません")
        return pm

    def list_months(
        self, user: User, year_month: str | None, gender: str | None = None
    ) -> list[PracticeMonth]:
        """既定は自分の性別。gender を指定すると他方の月も閲覧できる (D-038)"""
        return self.months.list_by_gender(gender or user.gender, year_month)

    # ---------- 作成・更新 (代表) ----------

    def create_month(self, rep: User, data: PracticeMonthCreateRequest) -> PracticeMonth:
        if self.months.get_by_ym_gender(data.year_month, rep.gender):
            raise ConflictError(f"{data.year_month} の月別練習は既に存在します")
        pm = self.months.create(
            year_month=data.year_month,
            gender=rep.gender,
            vote_starts_at=to_utc(data.vote_starts_at),
            vote_ends_at=to_utc(data.vote_ends_at),
        )
        for p in data.practices:
            self._ensure_date_in_month(pm, p.practice_date)
            self._create_practice(pm.id, p)
        return pm

    def update_month(self, rep: User, pm_id: str, data: PracticeMonthUpdateRequest) -> None:
        pm = self.get_month_for_rep(rep, pm_id)
        if data.vote_starts_at is not None:
            pm.vote_starts_at = to_utc(data.vote_starts_at)
        if data.vote_ends_at is not None:
            pm.vote_ends_at = to_utc(data.vote_ends_at)
        self.db.flush()

    @staticmethod
    def _ensure_date_in_month(pm, practice_date) -> None:
        """練習日は対象月の中に限る (D-033)。

        月と練習日がずれたまま登録すると、画面の表記（9月の欄に8月の日付）も
        前月参照（落選救済の月送り）も狂う。フロントの min/max と二重に守る。
        """
        if practice_date.strftime("%Y-%m") != pm.year_month:
            raise ValidationError(
                f"練習日は {pm.year_month.replace('-', '年')}月 の日付を指定してください"
            )

    def _create_practice(self, pm_id: str, data: PracticeCreateRequest) -> Practice:
        return self.practices.create(
            pm_id,
            practice_date=data.practice_date,
            starts_at=data.starts_at,
            ends_at=data.ends_at,
            location=data.location,
            capacity=data.capacity,
            allowed_grades=data.allowed_grades,
            note=data.note,
        )

    def add_practice(self, rep: User, pm_id: str, data: PracticeCreateRequest) -> Practice:
        pm = self.get_month_for_rep(rep, pm_id)
        self._ensure_date_in_month(pm, data.practice_date)
        return self._create_practice(pm_id, data)

    def _get_practice_for_rep(self, rep: User, practice_id: str) -> Practice:
        practice = self.practices.get(practice_id)
        if practice is None:
            raise NotFoundError("練習日が見つかりません")
        self.get_month_for_rep(rep, practice.practice_month_id)
        return practice

    def update_practice(self, rep: User, practice_id: str, data: PracticeCreateRequest) -> None:
        practice = self._get_practice_for_rep(rep, practice_id)
        pm = self.months.get(practice.practice_month_id)
        if pm is not None:
            self._ensure_date_in_month(pm, data.practice_date)
        practice.practice_date = data.practice_date
        practice.starts_at = data.starts_at
        practice.ends_at = data.ends_at
        practice.location = data.location
        practice.capacity = data.capacity
        practice.allowed_grades = data.allowed_grades
        practice.note = data.note
        self.db.flush()

    def delete_practice(self, rep: User, practice_id: str, force: bool) -> None:
        """抽選実行後の削除は force=true が必要 (REQ-003.4 の警告)"""
        practice = self._get_practice_for_rep(rep, practice_id)
        if self.months.has_active_execution(practice.practice_month_id) and not force:
            raise ConflictError(
                "抽選実行済みの月の練習日です。削除する場合は force=true を指定してください"
            )
        practice.is_deleted = True
        self.db.flush()
