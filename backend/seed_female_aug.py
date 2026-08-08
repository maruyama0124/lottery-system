"""女子 2026-08 を男子と同様に用意するワンオフスクリプト。

練習日の作成 → ランダム投票 → 枠保存 (提案値) → 抽選 → 公開 まで一括で行う。
締切は過去に設定する (抽選を実行できる状態にするため)。
"""
import random
from datetime import date, time, timedelta

from src.core.datetime_utils import utcnow
from src.core.ids import generate_id
from src.db.models import Practice, PracticeMonth, User, Vote
from src.db.session import SessionLocal
from src.schemas.lottery import GradeQuotaInput, PracticeQuotaInput, QuotaUpdateRequest
from src.services.lottery_service import LotteryService

DAYS = [5, 10, 12, 17, 19, 24]  # 男子8月と同じ日取り
SEED = 20260810


def main() -> None:
    rng = random.Random(SEED)
    db = SessionLocal()
    try:
        assert (
            db.query(PracticeMonth)
            .filter_by(year_month="2026-08", gender="female", is_deleted=False)
            .first()
            is None
        ), "女子 2026-08 は既に存在します"

        now = utcnow()
        pm = PracticeMonth(
            id=generate_id("pmn"),
            year_month="2026-08",
            gender="female",
            vote_starts_at=now - timedelta(days=14),
            vote_ends_at=now - timedelta(hours=1),
        )
        db.add(pm)
        db.flush()

        practices = []
        for day in DAYS:
            p = Practice(
                id=generate_id("prc"),
                practice_month_id=pm.id,
                practice_date=date(2026, 8, day),
                starts_at=time(18, 30),
                ends_at=time(21, 30),
                location="第二体育館",
                capacity=20,
            )
            db.add(p)
            practices.append(p)
        db.flush()

        members = db.query(User).filter_by(gender="female", is_deleted=False).all()
        total = 0
        for m in members:
            n = rng.randint(1, len(practices))
            for p in rng.sample(practices, n):
                db.add(Vote(id=generate_id("vot"), user_id=m.id, practice_id=p.id))
                total += 1
        db.flush()
        print(f"女子 2026-08 を作成: 練習{len(practices)}日 / 投票{total}票")

        rep = (
            db.query(User)
            .filter_by(role="representative", gender="female", is_deleted=False)
            .first()
        )
        svc = LotteryService(db)
        summary = svc.vote_summary(rep, pm.id)
        svc.update_quotas(
            rep,
            pm.id,
            QuotaUpdateRequest(
                practices=[
                    PracticeQuotaInput(
                        practice_id=p.practice_id,
                        grades=[
                            GradeQuotaInput(grade=g.grade, quota=g.suggested_quota)
                            for g in p.grades
                        ],
                    )
                    for p in summary.practices
                ]
            ),
        )
        result = svc.execute(rep, pm.id, seed=SEED, confirm_rerun=True)
        svc.publish(rep, pm.id)
        db.commit()
        print(f"抽選→公開 完了 / 警告{len(result.warnings)}件")
        for w in result.warnings:
            print(f"  警告: {w}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
