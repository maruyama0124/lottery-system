"""10月練習参加予定表(男子) の練習日程を登録する一回限りのスクリプト。冪等。
定員(capacity)は Excel に記載がないため仮に 30 で登録する(後で要調整)。
"""
from datetime import datetime, date, time
from src.core.ids import generate_id
from src.db.models import Practice, PracticeMonth
from src.db.session import SessionLocal

YEAR = 2024
YEAR_MONTH = "2024-10"
GENDER = "male"
DEFAULT_CAPACITY = 30

# (日, 場所, 開始, 終了)  ※Excel の男子表の通り。21:31/21:32 は誤記として 21:30 に揃える
PRACTICES = [
    (2,  "目白小",       time(18, 0),  time(21, 30)),
    (4,  "桐ヶ丘",       time(18, 30), time(21, 30)),
    (7,  "雑司ヶ谷",     time(18, 30), time(21, 30)),
    (9,  "目白小",       time(18, 0),  time(21, 30)),
    (16, "目白小",       time(18, 0),  time(21, 30)),
    (21, "文京区スポセ", time(18, 30), time(21, 30)),
    (23, "目白小",       time(18, 0),  time(21, 30)),
    (30, "目白小",       time(18, 0),  time(21, 30)),
]


def main() -> None:
    db = SessionLocal()
    try:
        pm = (
            db.query(PracticeMonth)
            .filter_by(year_month=YEAR_MONTH, gender=GENDER, is_deleted=False)
            .first()
        )
        if pm is None:
            pm = PracticeMonth(
                id=generate_id("pmn"),
                year_month=YEAR_MONTH,
                gender=GENDER,
                # 投票期間は過去(締切済み) — 実データを流し込んで抽選できる状態にする
                vote_starts_at=datetime(YEAR, 9, 16, 0, 0),
                vote_ends_at=datetime(YEAR, 9, 30, 23, 59),
                status="closed",
            )
            db.add(pm)
            db.flush()
            print(f"月別練習を作成: {YEAR_MONTH} {GENDER} ({pm.id})")
        else:
            print(f"月別練習は既存: {pm.id}")

        existing = {(p.practice_date, p.starts_at) for p in
                    db.query(Practice).filter_by(practice_month_id=pm.id, is_deleted=False)}
        created = 0
        for day, loc, st, et in PRACTICES:
            d = date(YEAR, 10, day)
            if (d, st) in existing:
                continue
            db.add(Practice(
                id=generate_id("prc"),
                practice_month_id=pm.id,
                practice_date=d,
                starts_at=st,
                ends_at=et,
                location=loc,
                capacity=DEFAULT_CAPACITY,
            ))
            created += 1
        db.commit()
        print(f"練習日を登録: {created}件 / 定員(仮): {DEFAULT_CAPACITY}名")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
