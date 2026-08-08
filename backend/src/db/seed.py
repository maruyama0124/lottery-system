"""初期データ投入 (DB設計書 §5)

- lottery_settings: 男女2行 (rescue_alpha = 0.5)
- 初期代表アカウント (開発用): `--with-dev-reps` を付けたときだけ作成する。
  本番はダミーの代表を作らず、最初の代表は LINE 登録後に SQL で
  role を付与する運用 (D-040)

冪等: 既存データがあればスキップする。
実行: docker compose -f backend/docker-compose.yaml exec api python -m src.db.seed [--with-dev-reps]
"""
from decimal import Decimal

import bcrypt
from sqlalchemy.orm import Session

from src.core.datetime_utils import utcnow
from src.core.ids import generate_id
from src.db.models import LotterySettings, User
from src.db.session import SessionLocal

INITIAL_REPRESENTATIVES = [
    {
        "email": "rep-male@example.com",
        "name": "男子代表 (初期)",
        "gender": "male",
    },
    {
        "email": "rep-female@example.com",
        "name": "女子代表 (初期)",
        "gender": "female",
    },
]
INITIAL_PASSWORD = "change-me-1234"  # 初回ログイン後に変更する運用


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
    password_hash = bcrypt.hashpw(INITIAL_PASSWORD.encode(), bcrypt.gensalt()).decode()
    for rep in INITIAL_REPRESENTATIVES:
        exists = db.query(User).filter_by(email=rep["email"]).first()
        if exists:
            print(f"代表 ({rep['email']}): スキップ (既存)")
            continue
        db.add(
            User(
                id=generate_id("usr"),
                email=rep["email"],
                password_hash=password_hash,
                name=rep["name"],
                grade=3,
                gender=rep["gender"],
                is_manager=False,
                role="representative",
                # 開発用アカウントは確認メールを受け取れないため確認済みで作る。
                # NULL のままだとログイン時に 403 EMAIL_NOT_VERIFIED になる (D-011)
                email_verified_at=utcnow(),
            )
        )
        print(f"代表 ({rep['email']}): 作成")


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
