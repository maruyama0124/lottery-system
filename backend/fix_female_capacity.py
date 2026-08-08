"""女子 2026-08/09/10 の定員を 20 → 30 に上げ、枠再設定 → 再抽選 → 再公開するワンオフ。"""
from src.db.models import Practice, PracticeMonth, User
from src.db.session import SessionLocal
from src.schemas.lottery import GradeQuotaInput, PracticeQuotaInput, QuotaUpdateRequest
from src.services.lottery_service import LotteryService

SEED = 20261002


def main() -> None:
    db = SessionLocal()
    try:
        rep = (
            db.query(User)
            .filter_by(role="representative", gender="female", is_deleted=False)
            .first()
        )
        for ym in ("2026-08", "2026-09", "2026-10"):
            pm = (
                db.query(PracticeMonth)
                .filter_by(year_month=ym, gender="female", is_deleted=False)
                .first()
            )
            assert pm is not None, ym
            for p in db.query(Practice).filter_by(practice_month_id=pm.id, is_deleted=False):
                p.capacity = 30
            db.flush()

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
            print(f"女子 {ym}: 定員30で再抽選→公開 / 警告{len(result.warnings)}件")
            for w in result.warnings:
                print(f"  警告: {w}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
