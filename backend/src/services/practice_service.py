"""練習日程管理サービス (REQ-003)"""
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from src.core.datetime_utils import to_utc
from src.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from src.db.models import Assignment, Practice, PracticeMonth, User, Vote
from src.repositories.practice_repository import PracticeMonthRepository, PracticeRepository
from src.schemas.practices import (
    PracticeCreateRequest,
    PracticeMonthCreateRequest,
    PracticeMonthUpdateRequest,
    PracticeMonthBatchCreateRequest,
    PracticeBatchCreateRequest,
    PracticeGenderEditResponse,
    PracticeGenderUpdateRequest,
    PracticeEditVersion,
    PracticeResponse,
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
        """代表は男女双方の月を管理できる (D-068)。"""
        if rep.role != "representative":
            raise ForbiddenError("代表権限が必要です")
        pm = self.months.get(pm_id)
        if pm is None:
            raise NotFoundError("月別練習が見つかりません")
        return pm

    def list_months(
        self, user: User, year_month: str | None, gender: str | None = None
    ) -> list[PracticeMonth]:
        """既定は自分の性別。gender を指定すると他方の月も閲覧できる (D-038)"""
        return self.months.list_by_gender(gender or user.gender, year_month)

    # ---------- 作成・更新 (代表) ----------

    def create_month(self, rep: User, data: PracticeMonthCreateRequest) -> PracticeMonth:
        return self.create_months(rep, PracticeMonthBatchCreateRequest(
            **data.model_dump(), genders=[rep.gender]
        ), allow_existing=False)[0]

    def _lock_existing_months(self, year_month, genders) -> dict[str, PracticeMonth]:
        return {pm.gender: pm for pm in self.db.scalars(select(PracticeMonth).where(
            PracticeMonth.year_month == year_month,
            PracticeMonth.gender.in_(genders), PracticeMonth.is_deleted.is_(False),
        ).order_by(PracticeMonth.id).with_for_update().execution_options(populate_existing=True))}

    def create_months(self, rep: User, data: PracticeMonthBatchCreateRequest,
                      *, allow_existing: bool = True) -> list[PracticeMonth]:
        """既存月の受付期間を維持し、同日を更新・未登録日を追加する。"""
        if rep.role != "representative":
            raise ForbiddenError("代表権限が必要です")
        for p in data.practices:
            self._ensure_date_in_month(data, p.practice_date)
            if p.genders is not None and not set(p.genders).issubset(data.genders):
                raise ValidationError("練習日の登録対象が作成する月の性別に含まれていません")
        existing = self._lock_existing_months(data.year_month, data.genders)
        if existing and not allow_existing:
            raise ConflictError(f"{data.year_month} の月別練習は既に存在します")
        try:
            with self.db.begin_nested():
                months = []
                for gender in data.genders:
                    pm = existing.get(gender) or self.months.create(
                        year_month=data.year_month, gender=gender,
                        vote_starts_at=to_utc(data.vote_starts_at),
                        vote_ends_at=to_utc(data.vote_ends_at),
                    )
                    candidates = [p for p in data.practices if gender in (p.genders or data.genders)]
                    if allow_existing:
                        self._save_day_candidates(pm.id, candidates)
                    else:
                        for candidate in candidates:
                            self._create_practice(pm.id, candidate)
                    months.append(pm)
            return months
        except IntegrityError as exc:
            if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_practice_months_ym_gender":
                raise ConflictError("対象月が他の操作で作成されました。一覧を更新してください") from exc
            raise

    def add_practices(self, rep: User, data: PracticeBatchCreateRequest) -> list[Practice]:
        """既存の月へ男女別の日程を追加・同日更新する。個別編集・抽選の権限は変更しない。"""
        if rep.role != "representative":
            raise ForbiddenError("代表権限が必要です")
        months = list(self.db.scalars(select(PracticeMonth).where(
            PracticeMonth.year_month == data.year_month,
            PracticeMonth.gender.in_(data.genders), PracticeMonth.is_deleted.is_(False),
        ).order_by(PracticeMonth.id).with_for_update().execution_options(populate_existing=True)))
        if len(months) != len(data.genders):
            raise NotFoundError("選択した性別の月が未作成です。先に対象月を作成してください")
        self._ensure_date_in_month(data, data.practice.practice_date)
        with self.db.begin_nested():
            return [self._save_day_candidates(pm.id, [data.practice])[0] for pm in months]

    def _save_day_candidates(self, pm_id, candidates) -> list[Practice]:
        # 入力内で同日が重なった場合は最後の候補を採用する（性別ごと）。
        latest = {p.practice_date: p for p in candidates}
        existing = list(self.db.scalars(select(Practice).where(
            Practice.practice_month_id == pm_id, Practice.is_deleted.is_(False),
            Practice.practice_date.in_(latest),
        ).order_by(Practice.id).with_for_update().execution_options(populate_existing=True))) if latest else []
        by_date = {}
        for practice in existing:
            if practice.practice_date in by_date:
                raise ConflictError(f"{practice.practice_date} に複数の練習があります。既存日程の編集で対象を指定してください")
            by_date[practice.practice_date] = practice
        saved = []
        for day, candidate in latest.items():
            practice = by_date.get(day)
            if practice is None:
                practice = self._create_practice(pm_id, candidate)
            else:
                values = candidate.model_dump(exclude={"genders", "capacity"})
                changed = any(getattr(practice, key) != value for key, value in values.items())
                if changed and practice.is_assignment_locked:
                    raise ConflictError(f"{day} は参加者が固定された練習日のため更新できません")
                if changed:
                    for key, value in values.items():
                        setattr(practice, key, value)
            saved.append(practice)
        self.db.flush()
        return saved

    def update_month(self, rep: User, pm_id: str, data: PracticeMonthUpdateRequest) -> None:
        pm = self.get_month_for_rep(rep, pm_id)
        if data.vote_starts_at is not None:
            pm.vote_starts_at = to_utc(data.vote_starts_at)
        if data.vote_ends_at is not None:
            pm.vote_ends_at = to_utc(data.vote_ends_at)
        self.db.flush()

    def _gender_edit_context(self, rep: User, practice_id: str, *, lock=False):
        if rep.role != "representative":
            raise ForbiddenError("代表権限が必要です")
        source = self.practices.get(practice_id)
        if source is None:
            raise NotFoundError("練習日が見つかりません")
        pm = self.months.get(source.practice_month_id)
        if pm is None:
            raise NotFoundError("月別練習が見つかりません")
        query = select(PracticeMonth).where(
            PracticeMonth.year_month == pm.year_month, PracticeMonth.is_deleted.is_(False),
        ).order_by(PracticeMonth.id).execution_options(populate_existing=True)
        months = {m.gender: m for m in self.db.scalars(query.with_for_update() if lock else query)}
        gender_by_month = {m.id: g for g, m in months.items()}
        query = select(Practice).where(
            Practice.practice_month_id.in_(gender_by_month),
            Practice.practice_date == source.practice_date, Practice.is_deleted.is_(False),
        ).order_by(Practice.id).execution_options(populate_existing=True)
        rows = {}
        for practice in self.db.scalars(query.with_for_update() if lock else query):
            gender = gender_by_month[practice.practice_month_id]
            if gender in rows:
                raise ConflictError("同じ性別・日付に複数の練習があるため、男女の変更はできません")
            rows[gender] = practice
        if source.id not in {p.id for p in rows.values()}:
            raise ConflictError("練習日が変更されました。編集画面を開き直してください")
        return pm, months, rows

    def get_practice_gender_edit(self, rep: User, practice_id: str) -> PracticeGenderEditResponse:
        _, months, rows = self._gender_edit_context(rep, practice_id)
        source = next(p for p in rows.values() if p.id == practice_id)
        return PracticeGenderEditResponse(
            practice=PracticeResponse.model_validate(source), genders=sorted(rows),
            available_genders=sorted(months), versions={
                g: PracticeEditVersion(id=p.id, updated_at=p.updated_at) for g, p in rows.items()
            },
        )

    def update_practice_genders(self, rep: User, practice_id: str, data: PracticeGenderUpdateRequest) -> None:
        pm, months, rows = self._gender_edit_context(rep, practice_id, lock=True)
        if set(rows) != set(data.expected_versions) or any(
            rows[g].id != version.id or rows[g].updated_at != to_utc(version.updated_at)
            for g, version in data.expected_versions.items()
        ):
            raise ConflictError("練習日が変更されました。編集画面を開き直してください")
        if not set(data.genders).issubset(months):
            raise NotFoundError("選択した性別の月が未作成です。先に対象月を作成してください")
        self._ensure_date_in_month(pm, data.practice.practice_date)
        values = data.practice.model_dump(exclude={"capacity"})
        for gender, practice in rows.items():
            changed = gender not in data.genders or any(getattr(practice,k) != v for k,v in values.items())
            if practice.is_assignment_locked and (changed or set(rows) != set(data.genders)):
                raise ConflictError("参加者が固定された練習日は男女の変更・更新ができません")
            if gender not in data.genders:
                for model in (Vote, Assignment):
                    if self.db.scalar(select(model.id).where(
                        model.practice_id == practice.id, model.is_deleted.is_(False),
                    ).limit(1)) is not None:
                        raise ConflictError("選択を外した性別の練習に投票・参加割当があるため削除できません")
        # 日付変更先に別の日程がある場合は上書きしない。
        collision = self.db.scalar(select(Practice.id).where(
            Practice.practice_month_id.in_([months[g].id for g in data.genders]),
            Practice.practice_date == data.practice.practice_date,
            Practice.id.not_in([p.id for p in rows.values()]), Practice.is_deleted.is_(False),
        ).limit(1))
        if collision:
            raise ConflictError("変更先の日付に別の練習があります。日付を確認してください")
        with self.db.begin_nested():
            for gender, practice in rows.items():
                if gender not in data.genders:
                    practice.is_deleted = True
                else:
                    for key, value in values.items():
                        if getattr(practice,key) != value:
                            setattr(practice,key,value)
            for gender in data.genders:
                if gender not in rows:
                    self._create_practice(months[gender].id, data.practice)
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
        # 月→練習日の順にロックし、抽選・公開・管理者の固定操作と直列化する。
        self.db.scalar(select(PracticeMonth).where(
            PracticeMonth.id == practice.practice_month_id
        ).with_for_update())
        self.db.refresh(practice, with_for_update=True)
        if practice.is_assignment_locked:
            raise ConflictError("参加者が固定された練習日は変更・削除できません")
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
