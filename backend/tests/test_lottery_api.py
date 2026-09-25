"""抽選・結果・設定 API のテスト (REQ-005, REQ-006, NFR-004.1)

投票 → 締切 → プレビュー → 抽選 → 微調整 → 公開 → 翌月の落選救済までの
月次運用フロー全体を API 経由で検証する。
"""
from datetime import datetime, timedelta, timezone

from tests.conftest import auth_header
from tests.test_practices import create_month


def close_voting(client, rep_token: str, pm_id: str) -> None:
    """投票締切を過去にして抽選可能な状態にする"""
    now = datetime.now(timezone.utc)
    res = client.put(
        f"/api/v1/practice-months/{pm_id}",
        json={
            "vote_starts_at": (now - timedelta(days=14)).isoformat(),
            "vote_ends_at": (now - timedelta(days=1)).isoformat(),
        },
        headers=auth_header(rep_token),
    )
    assert res.status_code == 204


def setup_month_with_votes(client, make_user, *, n_members: int = 6, practices: int = 2):
    """代表 + メンバー数名が投票済みの月を作る。(rep_token, pm, member_tokens)"""
    _rep_id, rep_token = make_user(role="representative", gender="male", grade=3)
    pm = create_month(client, rep_token, practices=practices)
    ids = [p["id"] for p in pm["practices"]]

    member_tokens = []
    for i in range(n_members):
        grade = [1, 1, 1, 2, 2, 3][i % 6]
        _uid, token = make_user(gender="male", grade=grade)
        # 全員が全練習日に投票 (満員シナリオ)
        res = client.put(
            f"/api/v1/practice-months/{pm['id']}/votes/me",
            json={"practice_ids": ids},
            headers=auth_header(token),
        )
        assert res.status_code == 204
        member_tokens.append(token)

    close_voting(client, rep_token, pm["id"])
    set_quotas(client, rep_token, pm)
    return rep_token, pm, member_tokens


def set_quotas(client, rep_token: str, pm, *, quotas=(("3", 10), ("2", 10), ("1", 10))) -> None:
    """全練習日に学年別枠を設定する (D-015: 未設定だと抽選できない)"""
    detail = client.get(
        f"/api/v1/practice-months/{pm['id']}", headers=auth_header(rep_token)
    ).json()
    body = {
        "practices": [
            {
                "practice_id": p["id"],
                # 合計は定員と一致させる必要がある
                "grades": [
                    {"grade": 3, "quota": p["capacity"] // 3},
                    {"grade": 2, "quota": p["capacity"] // 3},
                    {"grade": 1, "quota": p["capacity"] - 2 * (p["capacity"] // 3)},
                ],
            }
            for p in detail["practices"]
        ]
    }
    res = client.put(
        f"/api/v1/practice-months/{pm['id']}/quotas",
        json=body,
        headers=auth_header(rep_token),
    )
    assert res.status_code == 204, res.text


def run_lottery(client, rep_token: str, pm_id: str, **body):
    return client.post(
        f"/api/v1/practice-months/{pm_id}/lottery",
        json=body,
        headers=auth_header(rep_token),
    )


def test_lottery_blocked_during_voting(client, make_user) -> None:
    _rep_id, rep_token = make_user(role="representative", gender="male")
    pm = create_month(client, rep_token)  # 投票期間中
    res = run_lottery(client, rep_token, pm["id"])
    assert res.status_code == 409


def test_vote_summary_returns_votes_and_quotas(client, make_user) -> None:
    """抽選前の調整画面用データ (D-015)"""
    rep_token, pm, _tokens = setup_month_with_votes(client, make_user)
    res = client.get(
        f"/api/v1/practice-months/{pm['id']}/vote-summary", headers=auth_header(rep_token)
    )
    assert res.status_code == 200
    body = res.json()
    assert body["quotas_ready"] is True  # setup で枠を設定済み
    assert len(body["practices"]) == len(pm["practices"])
    for p in body["practices"]:
        assert [g["grade"] for g in p["grades"]] == [3, 2, 1]
        assert sum(g["voters"] for g in p["grades"]) > 0
        assert sum(g["quota"] for g in p["grades"]) == p["capacity"]


def test_quota_sum_must_match_capacity(client, make_user) -> None:
    rep_token, pm, _tokens = setup_month_with_votes(client, make_user)
    practice_id = pm["practices"][0]["id"]
    res = client.put(
        f"/api/v1/practice-months/{pm['id']}/quotas",
        json={
            "practices": [
                {
                    "practice_id": practice_id,
                    "grades": [
                        {"grade": 3, "quota": 1},
                        {"grade": 2, "quota": 1},
                        {"grade": 1, "quota": 1},
                    ],
                }
            ]
        },
        headers=auth_header(rep_token),
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_lottery_requires_quotas(client, make_user) -> None:
    """枠が未設定なら抽選できない (D-015)"""
    _rep_id, rep_token = make_user(role="representative", gender="male", grade=3)
    pm = create_month(client, rep_token)
    close_voting(client, rep_token, pm["id"])

    res = run_lottery(client, rep_token, pm["id"])
    assert res.status_code == 409
    assert "枠" in res.json()["error"]["message"]


def test_lottery_execute_and_results_flow(client, make_user) -> None:
    """抽選実行 → 代表は全結果を見られる / メンバーは公開まで404 → 公開後に見られる"""
    rep_token, pm, member_tokens = setup_month_with_votes(client, make_user)

    res = run_lottery(client, rep_token, pm["id"], seed=42)
    assert res.status_code == 201, res.text
    execution = res.json()
    assert execution["random_seed"] == 42
    assert execution["is_active"] is True

    # 代表: 全結果 (練習日別 + メンバー別)
    full = client.get(
        f"/api/v1/practice-months/{pm['id']}/results", headers=auth_header(rep_token)
    )
    assert full.status_code == 200
    body = full.json()
    assert len(body["by_practice"]) == 2
    total_assigned = sum(len(p["participants"]) for p in body["by_practice"])
    assert total_assigned > 0
    # 全員が全日に投票 + 定員30 > 6名 → 全員が全日当選しているはず
    for member in body["by_member"]:
        assert member["wins_count"] == member["votes_count"]

    # 未投票のメンバーもメンバー別一覧に載る (D-043)。投票0・当選0で並ぶ
    idle_id, _idle_token = make_user(gender="male", grade=1)
    body2 = client.get(
        f"/api/v1/practice-months/{pm['id']}/results", headers=auth_header(rep_token)
    ).json()
    idle = next(m for m in body2["by_member"] if m["user_id"] == idle_id)
    assert idle["votes_count"] == 0 and idle["wins_count"] == 0
    assert idle["voted_practice_ids"] == [] and idle["practice_ids"] == []
    assert len(body2["by_member"]) == len(body["by_member"]) + 1

    # メンバー: 公開前は404 (REQ-006.4)
    me = client.get(
        f"/api/v1/practice-months/{pm['id']}/results/me",
        headers=auth_header(member_tokens[0]),
    )
    assert me.status_code == 404

    # 公開 → メンバーが自分の結果を見られる (REQ-006.1)
    pub = client.post(
        f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(rep_token)
    )
    assert pub.status_code == 204

    me2 = client.get(
        f"/api/v1/practice-months/{pm['id']}/results/me",
        headers=auth_header(member_tokens[0]),
    )
    assert me2.status_code == 200
    assert len(me2.json()["assignments"]) == 2  # 全日当選


def test_publish_without_lottery_returns_409(client, make_user) -> None:
    rep_token, pm, _tokens = setup_month_with_votes(client, make_user)
    res = client.post(
        f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(rep_token)
    )
    assert res.status_code == 409


def test_rerun_requires_confirm_and_resets_publication(client, make_user) -> None:
    """REQ-005.12: 再実行は confirm 必須。再実行すると非公開に戻り旧実行は無効化"""
    rep_token, pm, _tokens = setup_month_with_votes(client, make_user)
    first = run_lottery(client, rep_token, pm["id"], seed=1).json()
    client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(rep_token))

    ng = run_lottery(client, rep_token, pm["id"], seed=2)
    assert ng.status_code == 409

    ok = run_lottery(client, rep_token, pm["id"], seed=2, confirm_rerun=True)
    assert ok.status_code == 201

    executions = client.get(
        f"/api/v1/practice-months/{pm['id']}/executions", headers=auth_header(rep_token)
    ).json()
    assert len(executions) == 2
    active = [e for e in executions if e["is_active"]]
    assert len(active) == 1
    assert active[0]["id"] != first["id"]

    detail = client.get(
        f"/api/v1/practice-months/{pm['id']}", headers=auth_header(rep_token)
    ).json()
    assert detail["status"] == "drawn"  # published から戻る
    assert detail["published_at"] is None


def test_same_seed_reproduces_same_assignments(client, make_user) -> None:
    """REQ-005.11: 同一シードで結果を再現できる"""
    rep_token, pm, _tokens = setup_month_with_votes(client, make_user)
    run_lottery(client, rep_token, pm["id"], seed=99)
    r1 = client.get(
        f"/api/v1/practice-months/{pm['id']}/results", headers=auth_header(rep_token)
    ).json()
    run_lottery(client, rep_token, pm["id"], seed=99, confirm_rerun=True)
    r2 = client.get(
        f"/api/v1/practice-months/{pm['id']}/results", headers=auth_header(rep_token)
    ).json()

    def summary(res):
        return sorted(
            (p["practice"]["id"], pt["user_id"], pt["assigned_via"])
            for p in res["by_practice"]
            for pt in p["participants"]
        )

    assert summary(r1) == summary(r2)


def test_manual_adjustment(client, make_user) -> None:
    """REQ-006.3: 手動追加・削除。定員超過で警告フラグ"""
    rep_token, pm, _tokens = setup_month_with_votes(client, make_user)
    run_lottery(client, rep_token, pm["id"])
    prc_id = pm["practices"][0]["id"]

    # 投票していないメンバーを手動追加
    extra_id, _extra_token = make_user(gender="male", grade=1)
    added = client.post(
        f"/api/v1/practices/{prc_id}/assignments",
        json={"user_id": extra_id},
        headers=auth_header(rep_token),
    )
    assert added.status_code == 201
    assert added.json()["capacity_exceeded"] is False  # 定員30に対して7名

    # 二重追加は409
    dup = client.post(
        f"/api/v1/practices/{prc_id}/assignments",
        json={"user_id": extra_id},
        headers=auth_header(rep_token),
    )
    assert dup.status_code == 409

    # 手動追加分は manual バッジ
    full = client.get(
        f"/api/v1/practice-months/{pm['id']}/results", headers=auth_header(rep_token)
    ).json()
    target = next(p for p in full["by_practice"] if p["practice"]["id"] == prc_id)
    manual = [pt for pt in target["participants"] if pt["assigned_via"] == "manual"]
    assert len(manual) == 1

    # 削除
    removed = client.delete(
        f"/api/v1/assignments/{added.json()['assignment_id']}",
        headers=auth_header(rep_token),
    )
    assert removed.status_code == 204


def test_capacity_exceeded_warning(client, make_user, db_session) -> None:
    """定員1の練習に2人目を手動追加すると capacity_exceeded=true"""
    _rep_id, rep_token = make_user(role="representative", gender="male")
    pm = create_month(client, rep_token, year_month="2026-09", practices=1)
    prc_id = pm["practices"][0]["id"]
    # 定員を1にする
    client.put(
        f"/api/v1/practices/{prc_id}",
        json={
            "practice_date": "2026-09-10",
            "starts_at": "18:00",
            "ends_at": "21:00",
            "location": "第一体育館",
            "capacity": 1,
        },
        headers=auth_header(rep_token),
    )
    m1, _t1 = make_user(gender="male")
    m2, _t2 = make_user(gender="male")
    r1 = client.post(
        f"/api/v1/practices/{prc_id}/assignments",
        json={"user_id": m1},
        headers=auth_header(rep_token),
    )
    assert r1.json()["capacity_exceeded"] is False
    r2 = client.post(
        f"/api/v1/practices/{prc_id}/assignments",
        json={"user_id": m2},
        headers=auth_header(rep_token),
    )
    assert r2.json()["capacity_exceeded"] is True


def test_publish_records_losses_for_next_month(client, make_user, db_session) -> None:
    """公開時に月次実績が確定し、翌月の落選救済の入力になる (REQ-005.9)"""
    rep_token, pm, _tokens = setup_month_with_votes(client, make_user)
    run_lottery(client, rep_token, pm["id"])
    client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(rep_token))

    from src.db.models import MonthlyMemberResult

    rows = (
        db_session.query(MonthlyMemberResult)
        .filter_by(practice_month_id=pm["id"], is_deleted=False)
        .all()
    )
    assert len(rows) == 6  # 投票した6名分 (代表は投票していない)
    for row in rows:
        assert row.losses_count == row.votes_count - row.wins_count


def test_settings_get_and_update(client, make_user) -> None:
    """NFR-004.1: 救済係数αの取得・変更"""
    _rep_id, rep_token = make_user(role="representative", gender="male")
    res = client.get("/api/v1/settings", headers=auth_header(rep_token))
    assert res.status_code == 200
    assert float(res.json()["rescue_alpha"]) == 0.5  # 既定値 (D-032)

    assert (
        client.put(
            "/api/v1/settings", json={"rescue_alpha": 0.8}, headers=auth_header(rep_token)
        ).status_code
        == 204
    )
    assert float(
        client.get("/api/v1/settings", headers=auth_header(rep_token)).json()["rescue_alpha"]
    ) == 0.8

    # member は 403
    _m, member_token = make_user(gender="male")
    assert client.get("/api/v1/settings", headers=auth_header(member_token)).status_code == 403


def test_participation_table_is_visible_to_members_after_publish(client, make_user) -> None:
    """練習参加表 (REQ-006.5 / D-025): 公開前は404、公開後はメンバーも見られる"""
    rep_token, pm, member_tokens = setup_month_with_votes(client, make_user)
    client.post(
        f"/api/v1/practice-months/{pm['id']}/lottery",
        json={"confirm_rerun": False},
        headers=auth_header(rep_token),
    )

    # 公開前は取得できない (微調整中の結果を見せない)
    before = client.get(
        f"/api/v1/practice-months/{pm['id']}/participation",
        headers=auth_header(member_tokens[0]),
    )
    assert before.status_code == 404

    client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(rep_token))

    res = client.get(
        f"/api/v1/practice-months/{pm['id']}/participation",
        headers=auth_header(member_tokens[0]),
    )
    assert res.status_code == 200
    body = res.json()

    assert len(body["practices"]) == 2
    # 1年3名・2年2名・3年1名が投票し、代表(3年)は投票していない。
    # 未投票の代表も行に並ぶ (D-043) ため 3年は2名
    assert {g["grade"] for g in body["grades"]} == {1, 2, 3}
    counts = {g["grade"]: len(g["rows"]) for g in body["grades"]}
    assert counts == {1: 3, 2: 2, 3: 2}

    # 投票した全員が全日当選しているため、各行が2日ぶんの practice_id を持つ。
    # 未投票の行は has_voted=False で practice_ids が空
    for section in body["grades"]:
        for row in section["rows"]:
            if row["has_voted"]:
                assert len(row["practice_ids"]) == 2
                assert set(row["practice_ids"]) <= {p["id"] for p in body["practices"]}
            else:
                assert row["practice_ids"] == []
    assert sum(1 for g in body["grades"] for r in g["rows"] if not r["has_voted"]) == 1


def test_participation_table_visible_to_other_gender_after_publish(client, make_user) -> None:
    """D-038: 公開後の参加表は異性のメンバーも閲覧できる（公開前は 404 のまま）"""
    rep_token, pm, member_tokens = setup_month_with_votes(client, make_user)
    client.post(
        f"/api/v1/practice-months/{pm['id']}/lottery",
        json={"confirm_rerun": False},
        headers=auth_header(rep_token),
    )

    _uid, female_token = make_user(gender="female", grade=1)
    before = client.get(
        f"/api/v1/practice-months/{pm['id']}/participation",
        headers=auth_header(female_token),
    )
    assert before.status_code == 404  # 未公開は誰にも見えない

    client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(rep_token))
    res = client.get(
        f"/api/v1/practice-months/{pm['id']}/participation",
        headers=auth_header(female_token),
    )
    assert res.status_code == 200


def test_adjustments_after_publish_are_held_until_republish(client, make_user) -> None:
    """公開後の微調整は再公開までメンバーに見えない (D-044)"""
    rep_token, pm, member_tokens = setup_month_with_votes(client, make_user)
    run_lottery(client, rep_token, pm["id"])
    client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(rep_token))
    prc_id = pm["practices"][0]["id"]

    def visible_user_ids() -> set[str]:
        body = client.get(
            f"/api/v1/practice-months/{pm['id']}/participation",
            headers=auth_header(member_tokens[0]),
        ).json()
        return {
            r["user_id"] for g in body["grades"] for r in g["rows"] if prc_id in r["practice_ids"]
        }

    def rep_participants() -> dict[str, str]:
        full = client.get(
            f"/api/v1/practice-months/{pm['id']}/results", headers=auth_header(rep_token)
        ).json()
        target = next(p for p in full["by_practice"] if p["practice"]["id"] == prc_id)
        return {pt["user_id"]: pt["publish_state"] for pt in target["participants"]}

    before = visible_user_ids()
    assert before and all(s == "published" for s in rep_participants().values())

    # 公開済みの人を外す → 削除予定になり、メンバーにはまだ見える
    removed_uid, removed_asg = next(
        (pt["user_id"], pt["assignment_id"])
        for pt in client.get(
            f"/api/v1/practice-months/{pm['id']}/results", headers=auth_header(rep_token)
        ).json()["by_practice"][0]["participants"]
    )
    res = client.delete(f"/api/v1/assignments/{removed_asg}", headers=auth_header(rep_token))
    assert res.status_code == 204
    assert rep_participants()[removed_uid] == "removing"
    assert removed_uid in visible_user_ids()

    # 新しい人を追加 → 追加予定になり、メンバーにはまだ見えない
    extra_id, _ = make_user(gender="male", grade=1)
    res = client.post(
        f"/api/v1/practices/{prc_id}/assignments",
        json={"user_id": extra_id},
        headers=auth_header(rep_token),
    )
    assert res.status_code == 201
    assert rep_participants()[extra_id] == "pending"
    assert extra_id not in visible_user_ids()
    assert visible_user_ids() == before

    # 削除予定の人をもう一度追加すると元に戻る (409 にならない)
    res = client.post(
        f"/api/v1/practices/{prc_id}/assignments",
        json={"user_id": removed_uid},
        headers=auth_header(rep_token),
    )
    assert res.status_code == 201
    assert rep_participants()[removed_uid] == "published"

    # 改めて外してから再公開 → 外した人は消え、追加した人が見える
    client.delete(f"/api/v1/assignments/{removed_asg}", headers=auth_header(rep_token))
    res = client.post(
        f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(rep_token)
    )
    assert res.status_code == 204
    after = visible_user_ids()
    assert removed_uid not in after
    assert extra_id in after
    assert after == (before - {removed_uid}) | {extra_id}
    assert all(s == "published" for s in rep_participants().values())
    assert removed_uid not in rep_participants()
