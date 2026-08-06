"""初期データ投入 (DB設計書 §5)

- lottery_settings: 男女2行 (rescue_alpha = 0.2)
- 初期代表アカウント: 男子代表・女子代表 各1名 (開発用)

冪等: 既存データがあればスキップする。
実行: docker compose -f backend/docker-compose.yaml exec api python -m src.db.seed
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
                rescue_alpha=Decimal("0.2"),
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
    db = SessionLocal()
    try:
        seed_lottery_settings(db)
        seed_representatives(db)
        db.commit()
        print("シード完了")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
