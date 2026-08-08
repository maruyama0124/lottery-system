"""練習日程・投票 API のテスト (REQ-003, REQ-004)"""
from datetime import datetime, timedelta, timezone

from tests.conftest import auth_header


def month_body(year_month: str = "2026-08", *, open_window: bool = True, practices: int = 2):
    now = datetime.now(timezone.utc)
    if open_window:
        starts, ends = now - timedelta(days=1), now + timedelta(days=7)
    else:
        starts, ends = now - timedelta(days=14), now - timedelta(days=7)  # 締切済み
    return {
        "year_month": year_month,
        "vote_starts_at": starts.isoformat(),
        "vote_ends_at": ends.isoformat(),
        "practices": [
            {
                "practice_date": f"{year_month}-{10 + i:02d}",
                "starts_at": "18:00",
                "ends_at": "21:00",
                "location": "第一体育館",
                "capacity": 30,
            }
            for i in range(practices)
        ],
    }


def create_month(client, rep_token: str, **kwargs):
    res = client.post(
        "/api/v1/practice-months", json=month_body(**kwargs), headers=auth_header(rep_token)
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_create_month_with_practices(client, make_user) -> None:
    _rep, rep_token = make_user(role="representative", gender="male")
    pm = create_month(client, rep_token)
    assert pm["gender"] == "male"
    assert pm["year_month"] == "2026-08"
    assert len(pm["practices"]) == 2
    assert pm["practices"][0]["capacity"] == 30


def test_create_month_duplicate_409_and_member_403(client, make_user) -> None:
    _rep, rep_token = make_user(role="representative", gender="male")
    create_month(client, rep_token)
    dup = client.post(
        "/api/v1/practice-months", json=month_body(), headers=auth_header(rep_token)
    )
    assert dup.status_code == 409

    _member, member_token = make_user(gender="male")
    ng = client.post(
        "/api/v1/practice-months",
        json=month_body("2026-09"),
        headers=auth_header(member_token),
    )
    assert ng.status_code == 403


def test_member_sees_only_own_gender(client, make_user) -> None:
    """REQ-004.1: 自分の性別グループの練習のみ表示"""
    _mrep, male_rep_token = make_user(role="representative", gender="male")
    pm_male = create_month(client, male_rep_token)

    _member_f, female_token = make_user(gender="female")
    listing = client.get("/api/v1/practice-months", headers=auth_header(female_token))
    assert listing.status_code == 200
    assert listing.json() == []  # 女子には男子の月が見えない

    detail = client.get(
        f"/api/v1/practice-months/{pm_male['id']}", headers=auth_header(female_token)
    )
    assert detail.status_code == 404


def test_rep_gender_scope_on_update(client, make_user) -> None:
    """NFR-002.4: 女子代表は男子の月を操作できない"""
    _mrep, male_rep_token = make_user(role="representative", gender="male")
    pm = create_month(client, male_rep_token)

    _frep, female_rep_token = make_user(role="representative", gender="female")
    res = client.put(
        f"/api/v1/practice-months/{pm['id']}",
        json={"grade2_ratio": 0.6},
        headers=auth_header(female_rep_token),
    )
    assert res.status_code == 403


def test_update_month_ratio_and_practice_crud(client, make_user) -> None:
    _rep, rep_token = make_user(role="representative", gender="male")
    pm = create_month(client, rep_token)

    assert (
        client.put(
            f"/api/v1/practice-months/{pm['id']}",
            json={"grade2_ratio": 0.5},
            headers=auth_header(rep_token),
        ).status_code
        == 204
    )

    added = client.post(
        f"/api/v1/practice-months/{pm['id']}/practices",
        json={
            "practice_date": "2026-08-24",
            "starts_at": "18:00",
            "ends_at": "21:00",
            "location": "市民体育館",
            "capacity": 25,
        },
        headers=auth_header(rep_token),
    )
    assert added.status_code == 201
    prc_id = added.json()["id"]

    assert (
        client.put(
            f"/api/v1/practices/{prc_id}",
            json={
                "practice_date": "2026-08-24",
                "starts_at": "19:00",
                "ends_at": "21:00",
                "location": "市民体育館",
                "capacity": 28,
            },
            headers=auth_header(rep_token),
        ).status_code
        == 204
    )

    assert (
        client.delete(f"/api/v1/practices/{prc_id}", headers=auth_header(rep_token)).status_code
        == 204
    )
    detail = client.get(
        f"/api/v1/practice-months/{pm['id']}", headers=auth_header(rep_token)
    ).json()
    assert prc_id not in {p["id"] for p in detail["practices"]}


def test_delete_practice_after_lottery_requires_force(client, make_user, db_session) -> None:
    """REQ-003.4: 抽選実行後の削除は force が必要"""
    _rep, rep_token = make_user(role="representative", gender="male")
    rep_id = client.get("/api/v1/users/me", headers=auth_header(rep_token)).json()["id"]
    pm = create_month(client, rep_token)
    prc_id = pm["practices"][0]["id"]

    from src.core.ids import generate_id
    from src.db.models import LotteryExecution

    db_session.add(
        LotteryExecution(
            id=generate_id("lot"),
            practice_month_id=pm["id"],
            executed_by=rep_id,
            random_seed=42,
            grade2_ratio=0.5,
            settings_snapshot={"rescue_alpha": 0.2},
        )
    )
    db_session.flush()

    ng = client.delete(f"/api/v1/practices/{prc_id}", headers=auth_header(rep_token))
    assert ng.status_code == 409

    ok = client.delete(
        f"/api/v1/practices/{prc_id}?force=true", headers=auth_header(rep_token)
    )
    assert ok.status_code == 204


def test_vote_flow(client, make_user) -> None:
    """REQ-004: 投票 → 確認 → 変更 (全置換)"""
    _rep, rep_token = make_user(role="representative", gender="male")
    pm = create_month(client, rep_token)
    ids = [p["id"] for p in pm["practices"]]

    _member, token = make_user(gender="male")

    status0 = client.get(
        f"/api/v1/practice-months/{pm['id']}/votes/me", headers=auth_header(token)
    ).json()
    assert status0["voted_practice_ids"] == []
    assert status0["editable"] is True

    assert (
        client.put(
            f"/api/v1/practice-months/{pm['id']}/votes/me",
            json={"practice_ids": ids},
            headers=auth_header(token),
        ).status_code
        == 204
    )

    # 全置換で1件に減らす
    assert (
        client.put(
            f"/api/v1/practice-months/{pm['id']}/votes/me",
            json={"practice_ids": [ids[0]]},
            headers=auth_header(token),
        ).status_code
        == 204
    )
    status1 = client.get(
        f"/api/v1/practice-months/{pm['id']}/votes/me", headers=auth_header(token)
    ).json()
    assert status1["voted_practice_ids"] == [ids[0]]

    # 投票数が detail に反映される
    detail = client.get(
        f"/api/v1/practice-months/{pm['id']}", headers=auth_header(token)
    ).json()
    counts = {p["id"]: p["vote_count"] for p in detail["practices"]}
    assert counts[ids[0]] == 1
    assert counts[ids[1]] == 0


def test_vote_after_deadline_returns_409(client, make_user) -> None:
    """REQ-004.3: 締切後は変更不可"""
    _rep, rep_token = make_user(role="representative", gender="male")
    pm = create_month(client, rep_token, open_window=False)
    ids = [p["id"] for p in pm["practices"]]

    _member, token = make_user(gender="male")
    res = client.put(
        f"/api/v1/practice-months/{pm['id']}/votes/me",
        json={"practice_ids": [ids[0]]},
        headers=auth_header(token),
    )
    assert res.status_code == 409

    status = client.get(
        f"/api/v1/practice-months/{pm['id']}/votes/me", headers=auth_header(token)
    ).json()
    assert status["editable"] is False


def test_vote_unknown_practice_returns_400(client, make_user) -> None:
    _rep, rep_token = make_user(role="representative", gender="male")
    pm = create_month(client, rep_token)

    _member, token = make_user(gender="male")
    res = client.put(
        f"/api/v1/practice-months/{pm['id']}/votes/me",
        json={"practice_ids": ["prc_unknown"]},
        headers=auth_header(token),
    )
    assert res.status_code == 400


def test_practice_time_must_be_half_hour(client, make_user) -> None:
    """練習時刻は30分単位のみ受け付ける (D-014)"""
    _rep, rep_token = make_user(role="representative", gender="male")
    pm = create_month(client, rep_token)

    def add(starts_at: str, ends_at: str):
        return client.post(
            f"/api/v1/practice-months/{pm['id']}/practices",
            json={
                "practice_date": "2026-08-20",
                "starts_at": starts_at,
                "ends_at": ends_at,
                "location": "第一体育館",
                "capacity": 30,
            },
            headers=auth_header(rep_token),
        )

    assert add("18:30", "21:00").status_code == 201
    assert add("18:15", "21:00").status_code == 400
    assert add("18:00", "20:45").status_code == 400


def test_practice_suggestions_ordered_by_use_count(client, make_user) -> None:
    """よく使う練習の組み合わせを利用回数の多い順に返す (D-014)"""
    _rep, rep_token = make_user(role="representative", gender="male")
    # month_body は「第一体育館 18:00-21:00」を練習数ぶん作る
    create_month(client, rep_token, year_month="2026-08", practices=2)
    pm2 = create_month(client, rep_token, year_month="2026-09", practices=1)
    client.post(
        f"/api/v1/practice-months/{pm2['id']}/practices",
        json={
            "practice_date": "2026-09-20",
            "starts_at": "19:30",
            "ends_at": "21:30",
            "location": "第二体育館",
            "capacity": 24,
        },
        headers=auth_header(rep_token),
    )

    res = client.get("/api/v1/practices/suggestions", headers=auth_header(rep_token))
    assert res.status_code == 200
    items = res.json()
    assert items[0]["location"] == "第一体育館"
    assert items[0]["starts_at"] == "18:00" and items[0]["ends_at"] == "21:00"
    assert items[0]["use_count"] == 3
    assert {i["location"] for i in items} == {"第一体育館", "第二体育館"}


def test_practice_suggestions_are_scoped_by_gender(client, make_user) -> None:
    _male_rep, male_token = make_user(role="representative", gender="male")
    create_month(client, male_token)

    _female_rep, female_token = make_user(role="representative", gender="female")
    res = client.get("/api/v1/practices/suggestions", headers=auth_header(female_token))
    assert res.status_code == 200
    assert res.json() == []


def test_practice_suggestions_require_representative(client, make_user) -> None:
    _member, token = make_user(gender="male")
    res = client.get("/api/v1/practices/suggestions", headers=auth_header(token))
    assert res.status_code == 403


def test_practice_date_must_be_inside_the_month(client, make_user) -> None:
    """練習日は対象月の日付に限る (D-033)。月ずれ登録のミスを防ぐ"""
    _rep_id, rep_token = make_user(role="representative", gender="male")
    pm = create_month(client, rep_token, practices=1)

    # 追加: 対象月の翌月の日付は 400
    res = client.post(
        f"/api/v1/practice-months/{pm['id']}/practices",
        json={
            "practice_date": "2026-10-05",
            "starts_at": "18:00",
            "ends_at": "21:00",
            "location": "第一体育館",
            "capacity": 20,
        },
        headers=auth_header(rep_token),
    )
    assert res.status_code == 400

    # 更新: 既存の練習日を月外に動かすのも 400
    practice_id = pm["practices"][0]["id"]
    res = client.put(
        f"/api/v1/practices/{practice_id}",
        json={
            "practice_date": "2026-10-05",
            "starts_at": "18:00",
            "ends_at": "21:00",
            "location": "第一体育館",
            "capacity": 20,
        },
        headers=auth_header(rep_token),
    )
    assert res.status_code == 400


def test_grade_restricted_practice_blocks_votes(client, make_user) -> None:
    """学年限定の練習日 (D-037): 対象外の学年は投票できず、マネージャーは制限されない"""
    _rep, rep_token = make_user(role="representative", gender="male")
    pm = create_month(client, rep_token, practices=1)

    # 1年限定の練習日を追加
    res = client.post(
        f"/api/v1/practice-months/{pm['id']}/practices",
        json={
            "practice_date": "2026-08-20",
            "starts_at": "18:00",
            "ends_at": "21:00",
            "location": "第一体育館",
            "capacity": 30,
            "allowed_grades": [1],
        },
        headers=auth_header(rep_token),
    )
    assert res.status_code == 201, res.text
    restricted_id = res.json()["id"]
    assert res.json()["allowed_grades"] == [1]

    # 2年生は投票できない
    _u2, token2 = make_user(grade=2, gender="male")
    res = client.put(
        f"/api/v1/practice-months/{pm['id']}/votes/me",
        json={"practice_ids": [restricted_id]},
        headers=auth_header(token2),
    )
    assert res.status_code == 400
    assert res.json()["error"]["details"][0]["reason"] == "grade_not_allowed"

    # 1年生は投票できる
    _u1, token1 = make_user(grade=1, gender="male")
    res = client.put(
        f"/api/v1/practice-months/{pm['id']}/votes/me",
        json={"practice_ids": [restricted_id]},
        headers=auth_header(token1),
    )
    assert res.status_code == 204

    # マネージャーは学年に関係なく投票できる (定員外の別枠)
    _mgr, token_mgr = make_user(grade=3, gender="male", is_manager=True)
    res = client.put(
        f"/api/v1/practice-months/{pm['id']}/votes/me",
        json={"practice_ids": [restricted_id]},
        headers=auth_header(token_mgr),
    )
    assert res.status_code == 204

    # 全学年 [1,2,3] を指定した場合は制限なし (None に正規化)
    res = client.post(
        f"/api/v1/practice-months/{pm['id']}/practices",
        json={
            "practice_date": "2026-08-21",
            "starts_at": "18:00",
            "ends_at": "21:00",
            "location": "第一体育館",
            "capacity": 30,
            "allowed_grades": [3, 2, 1],
        },
        headers=auth_header(rep_token),
    )
    assert res.status_code == 201
    assert res.json()["allowed_grades"] is None
