"""認証 API のテスト (REQ-001)"""
from datetime import timedelta

import pytest

from src.core.config import get_settings
from src.core.datetime_utils import utcnow
from src.core.security import create_reset_token
from src.db.models import User

REGISTER_BODY = {
    "email": "hanako@example.com",
    "password": "password123",
    "name": "佐藤 花子",
    "grade": 2,
    "gender": "female",
    "is_manager": False,
}
EMAIL = REGISTER_BODY["email"]
PASSWORD = REGISTER_BODY["password"]


@pytest.fixture()
def sent_codes(monkeypatch) -> list[str]:
    """送信された確認コードを捕捉する (コードはハッシュ保存のためDBから読めない)"""
    codes: list[str] = []

    def fake_send(*, to: str, code: str, expires_minutes: int) -> None:
        codes.append(code)

    monkeypatch.setattr("src.services.auth_service.send_verification_code", fake_send)
    return codes


def register(client, **overrides):
    return client.post("/api/v1/auth/register", json={**REGISTER_BODY, **overrides})


def login(client, password: str = PASSWORD, email: str = EMAIL):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def verify(client, code: str, email: str = EMAIL):
    return client.post("/api/v1/auth/verify", json={"email": email, "code": code})


def register_and_verify(client, sent_codes) -> str:
    """登録から確認までを通し、user_id を返す"""
    user_id = register(client).json()["id"]
    assert verify(client, sent_codes[-1]).status_code == 200
    return user_id


def test_register_returns_profile_without_password(client, sent_codes) -> None:
    res = register(client)
    assert res.status_code == 201
    body = res.json()
    assert body["email"] == EMAIL
    assert body["id"].startswith("usr_")
    assert body["role"] == "member"
    assert "password" not in body and "password_hash" not in body


def test_register_duplicate_email_returns_409(client, sent_codes) -> None:
    assert register(client).status_code == 201
    res = register(client)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT"


def test_register_validation_error_returns_400(client) -> None:
    res = register(client, password="short", grade=4)
    assert res.status_code == 400
    body = res.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    fields = {d["field"] for d in body["details"]}
    assert {"password", "grade"} <= fields


def test_register_sends_6digit_code(client, sent_codes) -> None:
    register(client)
    assert len(sent_codes) == 1
    assert sent_codes[0].isdigit() and len(sent_codes[0]) == 6


def test_login_before_verification_returns_403(client, sent_codes) -> None:
    """未確認のうちはログインできない (D-011)"""
    register(client)
    res = login(client)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


def test_verify_returns_token_and_login_succeeds(client, sent_codes) -> None:
    """確認完了と同時にログインできるようトークンを返す (D-014)"""
    register(client)
    verified = verify(client, sent_codes[0])
    assert verified.status_code == 200
    assert verified.json()["token_type"] == "bearer"
    assert verified.json()["access_token"]

    # 発行されたトークンがそのまま使える
    me = client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {verified.json()['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["email"] == EMAIL

    res = login(client)
    assert res.status_code == 200
    assert res.json()["access_token"]


def test_login_wrong_password(client, sent_codes) -> None:
    register_and_verify(client, sent_codes)
    assert login(client, password="wrong-password").status_code == 401


def test_verify_with_wrong_code_returns_400(client, sent_codes, db_session) -> None:
    user_id = register(client).json()["id"]
    wrong = "000000" if sent_codes[0] != "000000" else "111111"

    res = verify(client, wrong)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_CODE"
    assert db_session.get(User, user_id).verification_attempts == 1

    # 正しいコードならまだ確認できる
    assert verify(client, sent_codes[0]).status_code == 200


def test_verify_locks_after_max_attempts(client, sent_codes, db_session) -> None:
    register(client)
    max_attempts = get_settings().verification_max_attempts
    wrong = "000000" if sent_codes[0] != "000000" else "111111"

    for _ in range(max_attempts):
        assert verify(client, wrong).status_code == 400

    # 上限到達後は正しいコードでも受け付けない
    res = verify(client, sent_codes[0])
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "CODE_LOCKED"


def test_verify_expired_code_returns_400(client, sent_codes, db_session) -> None:
    user_id = register(client).json()["id"]
    user = db_session.get(User, user_id)
    user.verification_expires_at = utcnow() - timedelta(minutes=1)
    db_session.flush()

    res = verify(client, sent_codes[0])
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "CODE_EXPIRED"


def test_verify_unknown_email_returns_400(client) -> None:
    res = verify(client, "123456", email="unknown@example.com")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_CODE"


def test_resend_issues_new_code_and_resets_attempts(client, sent_codes, db_session) -> None:
    user_id = register(client).json()["id"]
    verify(client, "000000" if sent_codes[0] != "000000" else "111111")
    assert db_session.get(User, user_id).verification_attempts == 1

    res = client.post("/api/v1/auth/verify/resend", json={"email": EMAIL})
    assert res.status_code == 204
    assert len(sent_codes) == 2
    assert db_session.get(User, user_id).verification_attempts == 0

    # 古いコードは無効になり、新しいコードで確認できる
    assert verify(client, sent_codes[0]).status_code == 400
    assert verify(client, sent_codes[1]).status_code == 200


def test_resend_unknown_email_returns_204(client) -> None:
    """メールアドレスの存在を漏らさない"""
    res = client.post("/api/v1/auth/verify/resend", json={"email": "unknown@example.com"})
    assert res.status_code == 204


def test_logout_requires_token(client, sent_codes) -> None:
    register_and_verify(client, sent_codes)
    token = login(client).json()["access_token"]

    assert client.post("/api/v1/auth/logout").status_code == 401
    res = client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 204


def test_password_reset_flow(client, sent_codes) -> None:
    user_id = register_and_verify(client, sent_codes)

    # request は存在しないメールでも 204 (存在を漏らさない)
    assert (
        client.post(
            "/api/v1/auth/password-reset/request", json={"email": "unknown@example.com"}
        ).status_code
        == 204
    )

    token = create_reset_token(user_id)
    res = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": token, "new_password": "new-password-456"},
    )
    assert res.status_code == 204

    # 新パスワードでログインできる
    assert login(client, password="new-password-456").status_code == 200


def test_password_reset_with_invalid_token(client) -> None:
    res = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": "invalid-token", "new_password": "new-password-456"},
    )
    assert res.status_code == 401


def test_access_token_cannot_be_used_as_reset_token(client, sent_codes) -> None:
    """アクセストークンをリセットに流用できないこと (purpose 検証)"""
    register_and_verify(client, sent_codes)
    access = login(client).json()["access_token"]
    res = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": access, "new_password": "new-password-456"},
    )
    assert res.status_code == 401
