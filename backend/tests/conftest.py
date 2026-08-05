"""テスト共通フィクスチャ — 専用DB (lottery_test) を使用し、テストごとに全テーブルを空にする"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from src.core.config import get_settings
from src.db import models  # noqa: F401  (Base.metadata へ登録)
from src.db.base import Base
from src.db.session import get_db
from src.main import create_app

TEST_DB_NAME = "lottery_test"


@pytest.fixture(scope="session")
def test_engine():
    settings = get_settings()
    admin_engine = create_engine(settings.database_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": TEST_DB_NAME}
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
    admin_engine.dispose()

    test_url = settings.database_url.rsplit("/", 1)[0] + f"/{TEST_DB_NAME}"
    engine = create_engine(test_url)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def db_session(test_engine) -> Session:
    with test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(text(f'TRUNCATE TABLE "{table.name}" CASCADE'))
    session_factory = sessionmaker(bind=test_engine, expire_on_commit=False)
    session = session_factory()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def _no_outbound_mail(monkeypatch):
    """テストから実際にメールを送らない。

    RESEND_API_KEY を設定した環境では、登録のたびに外部APIを叩いてしまうため
    送信関数そのものを無効化する（確認コードの検証は test_auth.py で個別に差し替える）。
    """
    monkeypatch.setattr("src.core.mailer.send_email", lambda **_kwargs: None)


@pytest.fixture()
def client(db_session: Session) -> TestClient:
    app = create_app()

    def override_get_db():
        yield db_session
        db_session.flush()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


@pytest.fixture()
def make_user(client: TestClient, db_session: Session):
    """テスト用ユーザー作成ヘルパー。(user_id, token) を返す"""
    counter = {"n": 0}

    def _make(
        *,
        role: str = "member",
        gender: str = "male",
        grade: int = 2,
        is_manager: bool = False,
        password: str = "password123",
    ) -> tuple[str, str]:
        counter["n"] += 1
        email = f"user{counter['n']}@example.com"
        res = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": password,
                "name": f"テスト 太郎{counter['n']}",
                "address": "東京都八王子市1-2-3",
                "phone_number": "090-0000-0000",
                "grade": grade,
                "gender": gender,
                "faculty_department": "経済学部",
                "student_number": f"26E{counter['n']:04d}",
                "is_manager": is_manager,
            },
        )
        assert res.status_code == 201, res.text
        user_id = res.json()["id"]

        from src.core.datetime_utils import utcnow
        from src.db.models import User

        user = db_session.get(User, user_id)
        # 登録直後は未確認でログインできない (D-011)。
        # 確認フロー自体は test_auth.py で検証するため、ここでは直接確認済みにする
        user.email_verified_at = utcnow()
        if role != "member":
            user.role = role
        db_session.flush()
        token = client.post(
            "/api/v1/auth/login", json={"email": email, "password": password}
        ).json()["access_token"]
        return user_id, token

    return _make


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
