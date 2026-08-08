"""女子 2026-09 を作り直すワンオフスクリプト。

(year_month, gender) の一意制約があるため月の行は使い回し、
旧練習日 (8月の日付になっている D-033 以前のもの) を論理削除して
男子9月と同じ構成 (通常3日 + 2・3年限定2日 + 1年限定1日) を登録し直す。
"""
from datetime import date, datetime, time, timedelta, timezone

from src.core.ids import generate_id
from src.db.models import Practice, PracticeMonth
from src.db.session import SessionLocal

# (日, 参加できる学年 (None は全学年))
DAYS = [
    (3, None),
    (10, None),
    (17, None),
    (24, [2, 3]),
    (26, [2, 3]),
    (29, [1]),
]


def main() -> None:
    db = SessionLocal()
    try:
        pm = (
            db.query(PracticeMonth)
            .filter_by(year_month="2026-09", gender="female", is_deleted=False)
            .first()
        )
        assert pm is not None, "女子 2026-09 が見つかりません"

        old = db.query(Practice).filter_by(practice_month_id=pm.id, is_deleted=False).all()
        for p in old:
            p.is_deleted = True
        print(f"旧練習日を論理削除: {len(old)}件")

        now = datetime.now(timezone.utc)
        pm.vote_starts_at = now - timedelta(days=1)
        pm.vote_ends_at = now + timedelta(days=7)
        pm.status = "draft"
        pm.published_at = None

        for day, allowed in DAYS:
            db.add(
                Practice(
                    id=generate_id("prc"),
                    practice_month_id=pm.id,
                    practice_date=date(2026, 9, day),
                    starts_at=time(18, 30),
                    ends_at=time(21, 30),
                    location="第二体育館",
                    capacity=20,
                    allowed_grades=allowed,
                )
            )
        db.commit()
        print(f"女子 2026-09 を作り直し: {pm.id} / 練習{len(DAYS)}日")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
