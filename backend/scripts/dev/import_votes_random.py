"""指定した月の練習に、全メンバーをランダムに投票させるテスト用スクリプト。

各メンバーが「その月の練習日数」の範囲でランダムな日数を選ぶ。
再実行時は既存投票を消してから入れ直す (冪等)。

実行:
    docker compose -f backend/docker-compose.yaml run --rm api \
        python -m scripts.dev.import_votes_random 2026-08 male [seed]
"""
import random
import sys

from src.core.ids import generate_id
from src.db.models import Practice, PracticeMonth, User, Vote
from src.db.session import SessionLocal

YEAR_MONTH = sys.argv[1] if len(sys.argv) > 1 else "2026-08"
GENDER = sys.argv[2] if len(sys.argv) > 2 else "male"
SEED = int(sys.argv[3]) if len(sys.argv) > 3 else 20260801  # 再現性のため固定


def main() -> None:
    rng = random.Random(SEED)
    db = SessionLocal()
    try:
        pm = (
            db.query(PracticeMonth)
            .filter_by(year_month=YEAR_MONTH, gender=GENDER, is_deleted=False)
            .first()
        )
        practices = (
            db.query(Practice).filter_by(practice_month_id=pm.id, is_deleted=False).all()
        )
        practice_ids = [p.id for p in practices]
        members = db.query(User).filter_by(gender=GENDER, is_deleted=False).all()

        db.query(Vote).filter(Vote.practice_id.in_(practice_ids)).delete(
            synchronize_session=False
        )

        total = 0
        for m in members:
            # 学年限定の日 (D-037) には対象学年しか投票しない (マネージャーは制限なし)
            votable = [
                p.id
                for p in practices
                if m.is_manager or p.allowed_grades is None or m.grade in p.allowed_grades
            ]
            if not votable:
                continue
            n = rng.randint(1, len(votable))
            chosen = rng.sample(votable, n)
            for pid in chosen:
                db.add(Vote(id=generate_id("vot"), user_id=m.id, practice_id=pid))
                total += 1
        db.commit()
        print(f"投票を生成: {total}票 / メンバー{len(members)}名 × 練習{len(practice_ids)}日")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
