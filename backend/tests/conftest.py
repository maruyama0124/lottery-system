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


@pytest.fixture()
def client(db_session: Session) -> TestClient:
    app = create_app()

    def override_get_db():
        yield db_session
        db_session.flush()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


@pytest.fixture()
def make_user(db_session: Session):
    """テスト用ユーザー作成ヘルパー。(user_id, token) を返す

    ログイン経路は LINE のみ (D-042) のため、ユーザーは直接作成し
    アクセストークンも直接発行する。LINE ログイン自体は test_auth.py で検証する。
    """
    counter = {"n": 0}

    def _make(
        *,
        role: str = "member",
        gender: str = "male",
        grade: int = 2,
        is_manager: bool = False,
        is_observer: bool = False,
    ) -> tuple[str, str]:
        from src.core.ids import generate_id
        from src.core.security import create_access_token
        from src.db.models import User

        counter["n"] += 1
        user = User(
            id=generate_id("usr"),
            line_user_id=f"U{counter['n']:032d}",
            name=f"テスト 太郎{counter['n']}",
            grade=grade,
            gender=gender,
            is_manager=is_manager,
            is_observer=is_observer,
            role=role,
        )
        db_session.add(user)
        db_session.flush()
        return user.id, create_access_token(user.id, user.role, user.gender)

    return _make


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
