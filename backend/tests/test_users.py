"""メンバー・名簿 API のテスト (REQ-002, REQ-007)"""
from tests.conftest import auth_header


def test_get_and_update_me(client, make_user) -> None:
    _uid, token = make_user(grade=1)
    me = client.get("/api/v1/users/me", headers=auth_header(token))
    assert me.status_code == 200
    assert me.json()["grade"] == 1

    res = client.put(
        "/api/v1/users/me",
        json={"grade": 2, "name": "テスト 花子"},
        headers=auth_header(token),
    )
    assert res.status_code == 204
    me2 = client.get("/api/v1/users/me", headers=auth_header(token)).json()
    assert me2["grade"] == 2
    assert me2["name"] == "テスト 花子"


def test_roster_requires_representative(client, make_user) -> None:
    _uid, member_token = make_user()
    assert client.get("/api/v1/users", headers=auth_header(member_token)).status_code == 403


def test_roster_covers_both_genders_and_filters(client, make_user) -> None:
    """名簿は男女全体 (D-008)。学年・検索の絞り込み (REQ-007.1.1)"""
    _rep_id, rep_token = make_user(role="representative", gender="male")
    make_user(gender="female", grade=1)
    make_user(gender="male", grade=3)

    res = client.get("/api/v1/users", headers=auth_header(rep_token))
    assert res.status_code == 200
    body = res.json()
    genders = {u["gender"] for u in body["items"]}
    assert genders == {"male", "female"}  # 男子代表でも女子が見える
    assert body["total"] == 3

    g1 = client.get("/api/v1/users?grade=1", headers=auth_header(rep_token)).json()
    assert g1["total"] == 1
    assert g1["items"][0]["grade"] == 1

    # 検索は氏名のみを対象とする (D-021 で学籍番号を廃止)
    q = client.get("/api/v1/users?q=太郎3", headers=auth_header(rep_token)).json()
    assert q["total"] == 1


def test_roster_csv_export(client, make_user) -> None:
    _rep_id, rep_token = make_user(role="representative")
    make_user(gender="female", grade=1)

    res = client.get("/api/v1/users/export", headers=auth_header(rep_token))
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    body = res.text
    assert "名前" in body and "学年" in body  # ヘッダー (D-021 で個人情報の列は廃止)
    # 個人情報は Google フォームで管理するため、CSV には出力しない (D-021)
    assert "住所" not in body and "電話番号" not in body and "学籍番号" not in body
    assert body.count("\n") >= 3  # ヘッダー + 2名

    filtered = client.get(
        "/api/v1/users/export?grade=1", headers=auth_header(rep_token)
    ).text
    assert filtered.count("1年") == 1


def test_role_update_works_across_genders(client, make_user) -> None:
    """権限移譲 (REQ-007.2)。D-040: 立ち上げのため男女全体に付与できる"""
    _rep_id, rep_token = make_user(role="representative", gender="male")
    male_id, _ = make_user(gender="male")
    female_id, _ = make_user(gender="female")

    ok = client.put(
        f"/api/v1/users/{male_id}/role",
        json={"role": "representative"},
        headers=auth_header(rep_token),
    )
    assert ok.status_code == 204

    ok2 = client.put(
        f"/api/v1/users/{female_id}/role",
        json={"role": "representative"},
        headers=auth_header(rep_token),
    )
    assert ok2.status_code == 204  # 女子代表の任命も可能 (D-040)


def test_deactivate_user(client, make_user) -> None:
    """退会 (REQ-007.3): 論理削除され、名簿から消えログインも不可"""
    _rep_id, rep_token = make_user(role="representative", gender="male")
    target_id, _target_token = make_user(gender="male")

    res = client.delete(f"/api/v1/users/{target_id}", headers=auth_header(rep_token))
    assert res.status_code == 204

    roster = client.get("/api/v1/users", headers=auth_header(rep_token)).json()
    assert target_id not in {u["id"] for u in roster["items"]}

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "user2@example.com", "password": "password123"},
    )
    assert login.status_code == 401
