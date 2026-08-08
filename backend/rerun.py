"""半年分を新アルゴリズム (D-034〜D-036) で再抽選する。

投票・枠・シードは前回と同一のまま、抽選と公開だけをやり直す。
月次実績は公開時に上書きされるため、8月→…→1月の順で連鎖させる。
"""
from src.db.models import PracticeMonth, User
from src.db.session import SessionLocal
from src.services.lottery_service import LotteryService

MONTHS = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]

db = SessionLocal()
rep = (
    db.query(User)
    .filter(User.role == "representative", User.gender == "male", User.line_user_id.isnot(None))
    .first()
)
for i, ym in enumerate(MONTHS):
    pm = db.query(PracticeMonth).filter_by(year_month=ym, gender="male", is_deleted=False).first()
    svc = LotteryService(db)
    execution = svc.execute(rep, pm.id, seed=20260900 + i, confirm_rerun=True)
    db.commit()
    svc.publish(rep, pm.id)
    db.commit()
    internal = [w for w in execution.warnings if w.startswith("内部検証")]
    print(f"{ym}: 再抽選→公開 完了 / 警告{len(execution.warnings)}件 / 内部検証 {len(internal)}件")
    for w in internal[:3]:
        print("  !!", w)
print("全月完了")
