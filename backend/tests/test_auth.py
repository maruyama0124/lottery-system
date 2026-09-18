"""認証テスト (REQ-001)

ログイン手段は LINE ログインのみ (D-021 / D-042)。
LINE の検証エンドポイントは叩かず、verify_id_token を差し替えて検証する。
"""
import pytest

from src.core.line import LineProfile
from src.db.models import User
from tests.conftest import auth_header

LINE_USER_ID = "U0123456789abcdef0123456789abcdef"


@pytest.fixture()
def fake_line(monkeypatch):
    """ID トークンをそのまま LINE ユーザーIDとして扱うスタブ"""

    def _install(user_id: str = LINE_USER_ID, display_name: str | None = "たろう"):
        def _verify(id_token: str) -> LineProfile:
            if id_token == "invalid":
                from src.core.errors import UnauthorizedError

                raise UnauthorizedError("LINE の認証に失敗しました")
            return LineProfile(user_id=user_id, display_name=display_name)

        monkeypatch.setattr("src.services.auth_service.verify_id_token", _verify)

    return _install


def test_line_login_unregistered_returns_registered_false(client, fake_line) -> None:
    fake_line()
    res = client.post("/api/v1/auth/line/login", json={"id_token": "dummy"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["registered"] is False
    assert body["token"] is None
    assert body["display_name"] == "たろう"


def test_line_register_creates_user_and_returns_token(client, fake_line) -> None:
    fake_line()
    res = client.post(
        "/api/v1/auth/line/register",
        json={
            "id_token": "dummy",
            "name": "山田 太郎",
            "grade": 2,
            "gender": "male",
            "is_manager": False,
        },
    )
    assert res.status_code == 201, res.text
    token = res.json()["access_token"]

    me = client.get("/api/v1/users/me", headers=auth_header(token))
    assert me.status_code == 200
    assert me.json()["name"] == "山田 太郎"
    # 初期状態は一般メンバー。代表権限は後から付与する (D-040)
    assert me.json()["role"] == "member"


def test_line_login_after_register_returns_token(client, fake_line) -> None:
    fake_line()
    client.post(
        "/api/v1/auth/line/register",
        json={
            "id_token": "dummy",
            "name": "山田 太郎",
            "grade": 2,
            "gender": "male",
            "is_manager": False,
        },
    )
    res = client.post("/api/v1/auth/line/login", json={"id_token": "dummy"})
    assert res.status_code == 200, res.text
    assert res.json()["registered"] is True
    assert res.json()["token"]["access_token"]


def test_line_register_twice_returns_409(client, fake_line) -> None:
    fake_line()
    body = {
        "id_token": "dummy",
        "name": "山田 太郎",
        "grade": 2,
        "gender": "male",
        "is_manager": False,
    }
    assert client.post("/api/v1/auth/line/register", json=body).status_code == 201
    res = client.post("/api/v1/auth/line/register", json=body)
    assert res.status_code == 409, res.text


def test_line_login_with_invalid_token_returns_401(client, fake_line) -> None:
    fake_line()
    res = client.post("/api/v1/auth/line/login", json={"id_token": "invalid"})
    assert res.status_code == 401, res.text
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_line_register_validation_error_returns_400(client, fake_line) -> None:
    fake_line()
    res = client.post(
        "/api/v1/auth/line/register",
        json={"id_token": "dummy", "name": "", "grade": 9, "gender": "male"},
    )
    assert res.status_code == 400, res.text
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_deleted_user_is_treated_as_unregistered(client, fake_line, db_session) -> None:
    fake_line()
    res = client.post(
        "/api/v1/auth/line/register",
        json={
            "id_token": "dummy",
            "name": "山田 太郎",
            "grade": 2,
            "gender": "male",
            "is_manager": False,
        },
    )
    user_id = None
    me = client.get("/api/v1/users/me", headers=auth_header(res.json()["access_token"]))
    user_id = me.json()["id"]

    db_session.get(User, user_id).is_deleted = True
    db_session.flush()

    res = client.post("/api/v1/auth/line/login", json={"id_token": "dummy"})
    assert res.json()["registered"] is False


def test_logout_requires_token(client, make_user) -> None:
    assert client.post("/api/v1/auth/logout").status_code == 401
    _user_id, token = make_user()
    assert client.post("/api/v1/auth/logout", headers=auth_header(token)).status_code == 204


def test_protected_endpoint_rejects_invalid_token(client) -> None:
    res = client.get("/api/v1/users/me", headers=auth_header("not-a-jwt"))
    assert res.status_code == 401
