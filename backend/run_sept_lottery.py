"""2026-09 の男女両方を 締切→枠保存(提案値)→抽選→公開 まで進めるワンオフスクリプト。

投票期間が未来のままだと実行できないため、締切を過去に動かしてから抽選する。
枠は画面と同じ提案値 (D-031 / D-037) をそのまま保存する。
"""
from datetime import timedelta

from src.core.datetime_utils import utcnow
from src.db.models import PracticeMonth, User
from src.db.session import SessionLocal
from src.schemas.lottery import (
    GradeQuotaInput,
    PracticeQuotaInput,
    QuotaUpdateRequest,
)
from src.services.lottery_service import LotteryService

SEED = 20260910


def main() -> None:
    db = SessionLocal()
    try:
        for gender in ("male", "female"):
            rep = (
                db.query(User)
                .filter_by(role="representative", gender=gender, is_deleted=False)
                .first()
            )
            pm = (
                db.query(PracticeMonth)
                .filter_by(year_month="2026-09", gender=gender, is_deleted=False)
                .first()
            )
            assert rep is not None and pm is not None, gender

            # 締切を過去に動かす (投票期間中は抽選できないため)
            now = utcnow()
            pm.vote_starts_at = now - timedelta(days=14)
            pm.vote_ends_at = now - timedelta(hours=1)
            db.flush()

            svc = LotteryService(db)
            summary = svc.vote_summary(rep, pm.id)
            payload = QuotaUpdateRequest(
                practices=[
                    PracticeQuotaInput(
                        practice_id=p.practice_id,
                        grades=[
                            GradeQuotaInput(
                                grade=g.grade,
                                quota=g.quota if g.quota is not None else g.suggested_quota,
                            )
                            for g in p.grades
                        ],
                    )
                    for p in summary.practices
                ]
            )
            svc.update_quotas(rep, pm.id, payload)

            result = svc.execute(rep, pm.id, seed=SEED, confirm_rerun=True)
            svc.publish(rep, pm.id)
            db.commit()
            label = "男子" if gender == "male" else "女子"
            print(f"{label}: 抽選→公開 完了 / 警告{len(result.warnings)}件")
            for w in result.warnings:
                print(f"  警告: {w}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
