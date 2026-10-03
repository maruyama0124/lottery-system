"""初期データ投入 (DB設計書 §5)

- lottery_settings: 男女2行 (rescue_alpha = 0.5)
- 初期代表アカウント (開発用): `--with-dev-reps` を付けたときだけ作成する。
  本番はダミーの代表を作らず、最初の代表は LINE 登録後に SQL で
  role を付与する運用 (D-040)。ログイン手段は LINE のみ (D-042) のため、
  開発用代表はダミーの line_user_id で作り、JWT を直接発行して使う。

冪等: 既存データがあればスキップする。
実行: docker compose -f backend/docker-compose.yaml exec api python -m src.db.seed [--with-dev-reps]
"""
from decimal import Decimal

from sqlalchemy.orm import Session

from src.core.ids import generate_id
from src.db.models import LotterySettings, User
from src.db.session import SessionLocal

INITIAL_REPRESENTATIVES = [
    {"line_user_id": "dev_rep_male", "name": "男子代表 (初期)", "gender": "male"},
    {"line_user_id": "dev_rep_female", "name": "女子代表 (初期)", "gender": "female"},
]

def seed_lottery_settings(db: Session) -> None:
    for gender in ("male", "female"):
        exists = db.query(LotterySettings).filter_by(gender=gender).first()
        if exists:
            print(f"lottery_settings ({gender}): スキップ (既存)")
            continue
        db.add(
            LotterySettings(
                id=generate_id("set"),
                gender=gender,
                rescue_alpha=Decimal("0.5"),
            )
        )
        print(f"lottery_settings ({gender}): 作成")


def seed_representatives(db: Session) -> None:
    for rep in INITIAL_REPRESENTATIVES:
        exists = db.query(User).filter_by(line_user_id=rep["line_user_id"]).first()
        if exists:
            print(f"代表 ({rep['line_user_id']}): スキップ (既存)")
            continue
        db.add(
            User(
                id=generate_id("usr"),
                line_user_id=rep["line_user_id"],
                name=rep["name"],
                grade=3,
                gender=rep["gender"],
                is_manager=False,
                role="representative",
            )
        )
        print(f"代表 ({rep['line_user_id']}): 作成")


def main() -> None:
    import sys

    db = SessionLocal()
    try:
        seed_lottery_settings(db)
        # 本番にダミーの代表を作らないよう、明示したときだけ作成する (D-040)
        if "--with-dev-reps" in sys.argv:
            seed_representatives(db)
        else:
            print("初期代表: スキップ (--with-dev-reps 指定時のみ作成)")
        db.commit()
        print("シード完了")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
