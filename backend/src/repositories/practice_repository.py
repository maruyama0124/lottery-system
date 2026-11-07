"""practice_months / practices テーブルへのアクセス層"""
from collections.abc import Collection
from datetime import date, time, datetime
from typing import Any

from sqlalchemy import func, select, Select
from sqlalchemy.orm import Session

from src.core.ids import generate_id
from src.db.models import LotteryExecution, Practice, PracticeMonth, Vote


class PracticeMonthRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, pm_id: str) -> PracticeMonth | None:
        pm = self.db.get(PracticeMonth, pm_id)
        return pm if pm and not pm.is_deleted else None

    def get_for_update(self, pm_id: str) -> PracticeMonth | None:
        return self.db.scalar(select(PracticeMonth).where(
            PracticeMonth.id == pm_id, PracticeMonth.is_deleted.is_(False)
        ).with_for_update().execution_options(populate_existing=True))

    def list_for_year_month(
        self, year_month: str, genders: list[str] | None = None, *, lock: bool = False,
    ) -> list[PracticeMonth]:
        query = select(PracticeMonth).where(
            PracticeMonth.year_month == year_month, PracticeMonth.is_deleted.is_(False)
        )
        if genders is not None:
            query = query.where(PracticeMonth.gender.in_(genders))
        query = query.order_by(PracticeMonth.id).execution_options(populate_existing=True)
        return list(self.db.scalars(query.with_for_update() if lock else query))

    def lock(self, pm_id: str) -> None:
        self.db.scalar(select(PracticeMonth).where(PracticeMonth.id == pm_id).with_for_update())

    def refresh_for_update(self, month: PracticeMonth) -> None:
        self.db.refresh(month, with_for_update=True)

    def update_fields(self, month: PracticeMonth, **fields: Any) -> None:
        for key, value in fields.items():
            setattr(month, key, value)
        self.db.flush()

    def get_by_ym_gender(self, year_month: str, gender: str) -> PracticeMonth | None:
        stmt = select(PracticeMonth).where(
            PracticeMonth.year_month == year_month,
            PracticeMonth.gender == gender,
            PracticeMonth.is_deleted.is_(False),
        )
        return self.db.scalar(stmt)

    def list_by_gender(self, gender: str, year_month: str | None = None) -> list[PracticeMonth]:
        stmt = select(PracticeMonth).where(
            PracticeMonth.gender == gender, PracticeMonth.is_deleted.is_(False)
        )
        if year_month:
            stmt = stmt.where(PracticeMonth.year_month == year_month)
        return list(self.db.scalars(stmt.order_by(PracticeMonth.year_month.desc())))

    def create(self, **fields: object) -> PracticeMonth:
        pm = PracticeMonth(id=generate_id("pmn"), **fields)
        self.db.add(pm)
        self.db.flush()
        return pm

    def has_active_execution(self, pm_id: str) -> bool:
        stmt = select(LotteryExecution.id).where(
            LotteryExecution.practice_month_id == pm_id,
            LotteryExecution.is_active.is_(True),
            LotteryExecution.is_deleted.is_(False),
        )
        return self.db.scalar(stmt) is not None


class PracticeRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, practice_id: str) -> Practice | None:
        p = self.db.get(Practice, practice_id)
        return p if p and not p.is_deleted else None

    def list_by_month_for_update(self, pm_id: str, practice_ids: list[str] | None = None) -> list[Practice]:
        query = select(Practice).where(
            Practice.practice_month_id == pm_id, Practice.is_deleted.is_(False)
        )
        if practice_ids is not None:
            query = query.where(Practice.id.in_(practice_ids))
        return list(self.db.scalars(query.order_by(Practice.id).with_for_update()
            .execution_options(populate_existing=True)))

    def list_by_dates_for_update(self, pm_id: str, dates: Collection[date]) -> list[Practice]:
        if not dates:
            return []
        return list(self.db.scalars(select(Practice).where(
            Practice.practice_month_id == pm_id, Practice.is_deleted.is_(False),
            Practice.practice_date.in_(dates),
        ).order_by(Practice.id).with_for_update().execution_options(populate_existing=True)))

    def list_on_date(self, month_ids: list[str], practice_date: date, *, lock: bool = False) -> list[Practice]:
        query = select(Practice).where(
            Practice.practice_month_id.in_(month_ids), Practice.practice_date == practice_date,
            Practice.is_deleted.is_(False),
        ).order_by(Practice.id).execution_options(populate_existing=True)
        return list(self.db.scalars(query.with_for_update() if lock else query))

    def has_date_collision(self, month_ids: list[str], practice_date: date, excluded_ids: list[str]) -> bool:
        return self.db.scalar(select(Practice.id).where(
            Practice.practice_month_id.in_(month_ids), Practice.practice_date == practice_date,
            Practice.id.not_in(excluded_ids), Practice.is_deleted.is_(False),
        ).limit(1)) is not None

    def refresh_for_update(self, practice: Practice) -> None:
        self.db.refresh(practice, with_for_update=True)

    def update_fields(self, practice: Practice, **fields: Any) -> None:
        """ORM変更を登録する。flushは既存の処理単位の終わりに明示する。"""
        for key, value in fields.items():
            setattr(practice, key, value)

    def flush(self) -> None:
        self.db.flush()

    def list_by_month(self, pm_id: str) -> list[Practice]:
        stmt = (
            select(Practice)
            .where(Practice.practice_month_id == pm_id, Practice.is_deleted.is_(False))
            .order_by(Practice.practice_date, Practice.starts_at)
        )
        return list(self.db.scalars(stmt))

    def create(self, pm_id: str, **fields: object) -> Practice:
        p = Practice(id=generate_id("prc"), practice_month_id=pm_id, **fields)
        self.db.add(p)
        self.db.flush()
        return p

    def suggestions(self, gender: str, limit: int = 3) -> list[tuple[str, time, time, int | None, int]]:
        """過去に登録した (場所, 開始, 終了) の組み合わせを利用回数の多い順に返す。

        代表が毎月同じ体育館・同じ時間帯を登録する運用のため、
        入力を省けるよう履歴から候補を出す (D-014)。

        定員は施設の空き状況で毎回変わるためグルーピングには使わず、
        同じ組み合わせの中で最後に登録した値を初期値として返す。
        """
        stmt: Select[tuple[str, time, time, int | None, datetime]] = (
            select(
                Practice.location,
                Practice.starts_at,
                Practice.ends_at,
                Practice.capacity,
                Practice.created_at,
            )
            .join(PracticeMonth, PracticeMonth.id == Practice.practice_month_id)
            .where(
                PracticeMonth.gender == gender,
                Practice.is_deleted.is_(False),
                PracticeMonth.is_deleted.is_(False),
            )
            .order_by(Practice.created_at)
        )

        # 件数が小さい (月あたり数件 × 数ヶ月) ため Python 側で集計する
        grouped: dict[tuple[str, time, time], dict[str, object]] = {}
        for location, starts_at, ends_at, capacity, _created_at in self.db.execute(stmt).all():
            key = (location, starts_at, ends_at)
            entry = grouped.setdefault(key, {"capacity": capacity, "use_count": 0})
            entry["capacity"] = capacity  # created_at 昇順なので最後の値が残る
            entry["use_count"] = int(entry["use_count"]) + 1

        ordered = sorted(
            grouped.items(), key=lambda kv: (-int(kv[1]["use_count"]), kv[0][0], kv[0][1])
        )
        return [
            (location, starts_at, ends_at, int(v["capacity"]) if v["capacity"] is not None else None, int(v["use_count"]))
            for (location, starts_at, ends_at), v in ordered[:limit]
        ]

    def vote_counts(self, pm_id: str) -> dict[str, int]:
        """練習日ID -> 有効投票数"""
        stmt = (
            select(Vote.practice_id, func.count())
            .join(Practice, Practice.id == Vote.practice_id)
            .where(
                Practice.practice_month_id == pm_id,
                Vote.is_deleted.is_(False),
                Practice.is_deleted.is_(False),
            )
            .group_by(Vote.practice_id)
        )
        return dict(self.db.execute(stmt).all())
