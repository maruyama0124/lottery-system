"""2026-10 を男女とも用意するワンオフスクリプト。

9月と同じ構成 (通常3日 + 2・3年限定2日 + 1年限定1日) で練習日を作成し、
ランダム投票 → 枠保存 (提案値) → 抽選 → 公開 まで一括で行う。
"""
import random
from datetime import date, time, timedelta

from src.core.datetime_utils import utcnow
from src.core.ids import generate_id
from src.db.models import Practice, PracticeMonth, User, Vote
from src.db.session import SessionLocal
from src.schemas.lottery import GradeQuotaInput, PracticeQuotaInput, QuotaUpdateRequest
from src.services.lottery_service import LotteryService

# (日, 参加できる学年 (None は全学年))
DAYS = [
    (5, None),
    (12, None),
    (19, None),
    (24, [2, 3]),
    (28, [2, 3]),
    (31, [1]),
]
CAPACITY = {"male": 30, "female": 20}
SEED = 20261001


def main() -> None:
    db = SessionLocal()
    try:
        for gender in ("male", "female"):
            rng = random.Random(SEED + (0 if gender == "male" else 1))
            assert (
                db.query(PracticeMonth)
                .filter_by(year_month="2026-10", gender=gender, is_deleted=False)
                .first()
                is None
            ), f"{gender} の 2026-10 は既に存在します"

            now = utcnow()
            pm = PracticeMonth(
                id=generate_id("pmn"),
                year_month="2026-10",
                gender=gender,
                vote_starts_at=now - timedelta(days=14),
                vote_ends_at=now - timedelta(hours=1),
            )
            db.add(pm)
            db.flush()

            practices = []
            for day, allowed in DAYS:
                p = Practice(
                    id=generate_id("prc"),
                    practice_month_id=pm.id,
                    practice_date=date(2026, 10, day),
                    starts_at=time(18, 30),
                    ends_at=time(21, 30),
                    location="第二体育館" if gender == "female" else "第一体育館",
                    capacity=CAPACITY[gender],
                    allowed_grades=allowed,
                )
                db.add(p)
                practices.append(p)
            db.flush()

            members = db.query(User).filter_by(gender=gender, is_deleted=False).all()
            total = 0
            for m in members:
                # 学年限定の日 (D-037) には対象学年しか投票しない (マネージャーは制限なし)
                votable = [
                    p
                    for p in practices
                    if m.is_manager or p.allowed_grades is None or m.grade in p.allowed_grades
                ]
                if not votable:
                    continue
                n = rng.randint(1, len(votable))
                for p in rng.sample(votable, n):
                    db.add(Vote(id=generate_id("vot"), user_id=m.id, practice_id=p.id))
                    total += 1
            db.flush()

            rep = (
                db.query(User)
                .filter_by(role="representative", gender=gender, is_deleted=False)
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
            label = "男子" if gender == "male" else "女子"
            print(f"{label} 2026-10: 練習{len(practices)}日 / 投票{total}票 / 抽選→公開 完了 / 警告{len(result.warnings)}件")
            for w in result.warnings:
                print(f"  警告: {w}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
