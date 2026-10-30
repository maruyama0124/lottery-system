"""一括微調整の原子性・公開状態・競合と、専用DBでのSQL/保存時間比較。"""
from collections import Counter
from time import perf_counter

import pytest
from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session

from src.core.datetime_utils import utcnow
from src.core.ids import generate_id
from src.db.models import Assignment, LotteryExecution, PracticeMonth
from src.db.session import get_db
from src.repositories.lottery_repository import LotteryRepository
from tests.conftest import auth_header
from tests.test_practices import create_month


@pytest.fixture
def batch_setup(client, make_user, db_session):
    rep_id, token = make_user(role="representative")
    members = [make_user()[0] for _ in range(5)]
    pm = create_month(client, token)
    month = db_session.get(PracticeMonth, pm["id"])
    month.status, month.published_at = "published", utcnow()
    pid = pm["practices"][0]["id"]
    rows = []
    for uid, state, deleted in zip(members, ["published", "pending", "removing", "pending"], [False, False, False, True]):
        row = Assignment(id=generate_id("asg"), practice_id=pid, user_id=uid,
                         publish_state=state, is_deleted=deleted, assigned_via="grade3")
        db_session.add(row)
        rows.append(row)
    db_session.add(LotteryExecution(id=generate_id("lot"), practice_month_id=pm["id"],
                                   executed_by=rep_id, random_seed=1, settings_snapshot={}, is_active=True))
    db_session.flush()
    pm = client.get(f"/api/v1/practice-months/{pm['id']}", headers=auth_header(token)).json()
    return token, pm, members, [row.id for row in rows]


def change(pid, uid, participating, aid=None, state=None):
    return dict(practice_id=pid, user_id=uid, participating=participating,
                expected_assignment_id=aid, expected_publish_state=state)


def body(pm, changes):
    return dict(changes=changes, expected_month_status=pm["status"], expected_published_at=pm["published_at"])


def save(client, token, pm, changes):
    return client.put(f"/api/v1/practice-months/{pm['id']}/assignments",
                      headers=auth_header(token), json=body(pm, changes))


def all_rows(db, pid):
    return {a.user_id: a for a in db.scalars(select(Assignment).where(Assignment.practice_id == pid)
                                          .execution_options(populate_existing=True))}


def test_batch_states_visibility_reuse_and_republish(client, db_session, batch_setup):
    token, pm, users, ids = batch_setup
    pid = pm["practices"][0]["id"]
    before = client.get(f"/api/v1/practice-months/{pm['id']}/participation", headers=auth_header(token)).json()
    changes = [change(pid, users[0], False, ids[0], "published"),
               change(pid, users[1], False, ids[1], "pending"),
               change(pid, users[2], True, ids[2], "removing"),
               change(pid, users[3], True), change(pid, users[4], True)]
    assert save(client, token, pm, changes).status_code == 204
    rows = all_rows(db_session, pid)
    assert rows[users[0]].publish_state == "removing"
    assert rows[users[1]].is_deleted
    assert rows[users[2]].publish_state == "published" and rows[users[2]].assigned_via == "grade3"
    assert rows[users[3]].id == ids[3] and not rows[users[3]].is_deleted
    assert rows[users[3]].publish_state == rows[users[4]].publish_state == "pending"
    assert rows[users[3]].assigned_via == "manual"
    after = client.get(f"/api/v1/practice-months/{pm['id']}/participation", headers=auth_header(token)).json()
    assert after == before
    # 同じ保存を再送しても割当を重複させない。
    assert save(client, token, pm, changes).status_code == 204
    assert len(all_rows(db_session, pid)) == 5
    assert client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(token)).status_code == 204
    rows = all_rows(db_session, pid)
    assert rows[users[0]].is_deleted
    assert rows[users[3]].publish_state == rows[users[4]].publish_state == "published"


def test_before_publish_add_remove_and_undo(client, db_session, batch_setup):
    token, pm, users, ids = batch_setup
    month = db_session.get(PracticeMonth, pm["id"])
    month.status, month.published_at = "drawn", None
    row = db_session.get(Assignment, ids[0]); row.publish_state = "pending"
    db_session.flush()
    pm["status"], pm["published_at"] = "drawn", None
    pid = pm["practices"][0]["id"]
    assert save(client, token, pm, [change(pid, users[0], False, ids[0], "pending"), change(pid, users[4], True)]).status_code == 204
    rows = all_rows(db_session, pid)
    assert rows[users[0]].is_deleted and rows[users[4]].publish_state == "pending"
    assert save(client, token, pm, [change(pid, users[0], True)]).status_code == 204
    assert all_rows(db_session, pid)[users[0]].id == ids[0]
    assert client.get(f"/api/v1/practice-months/{pm['id']}/participation", headers=auth_header(token)).status_code == 404


@pytest.mark.parametrize("invalid", ["practice", "member", "gender", "observer", "duplicate", "conflict", "month"])
def test_invalid_batch_does_not_save_any_change(client, db_session, make_user, batch_setup, invalid):
    token, pm, users, ids = batch_setup
    pid = pm["practices"][0]["id"]
    changes = [change(pid, users[4], True)]
    bad = change(pid, users[0], False, ids[0], "published")
    expected = 400
    if invalid == "practice": bad["practice_id"] = "missing"; expected = 404
    if invalid == "member": bad["user_id"] = "missing"; expected = 404
    if invalid in ("gender", "observer"):
        bad = change(pid, make_user(gender="female" if invalid == "gender" else "male", is_observer=invalid == "observer")[0], True)
        expected = 403
    if invalid == "duplicate": bad = changes[0]
    if invalid == "conflict": bad["expected_assignment_id"] = "stale"; expected = 409
    request = body(pm, changes + [bad])
    if invalid == "month": request["expected_published_at"] = None; expected = 409
    response = client.put(f"/api/v1/practice-months/{pm['id']}/assignments", json=request, headers=auth_header(token))
    assert response.status_code == expected, response.text
    rows = all_rows(db_session, pid)
    assert users[4] not in rows and rows[users[0]].publish_state == "published"


def test_batch_auth_scope_and_empty_payload(client, make_user, batch_setup):
    token, pm, users, _ = batch_setup
    changes = [change(pm["practices"][0]["id"], users[4], True)]
    _, member_token = make_user()
    _, foreign_token = make_user(role="representative", gender="female")
    assert save(client, member_token, pm, changes).status_code == 403
    assert save(client, foreign_token, pm, changes).status_code == 204
    assert client.put(f"/api/v1/practice-months/{pm['id']}/assignments", json=body(pm, changes)).status_code == 401
    assert save(client, token, pm, []).status_code == 400


def transactional_override(client, engine):
    def dependency():
        with Session(engine, autoflush=False, expire_on_commit=False) as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise
    client.app.dependency_overrides[get_db] = dependency


def test_database_failure_rolls_back_all_writes(client, db_session, test_engine, monkeypatch, batch_setup):
    token, pm, users, ids = batch_setup
    db_session.commit()
    transactional_override(client, test_engine)
    original = LotteryRepository.apply_assignment_batch
    def fail(self, updates, additions):
        original(self, updates, additions)
        raise RuntimeError("test failure after writes")
    monkeypatch.setattr(LotteryRepository, "apply_assignment_batch", fail)
    pid = pm["practices"][0]["id"]
    with pytest.raises(RuntimeError):
        save(client, token, pm, [change(pid, users[0], False, ids[0], "published"), change(pid, users[4], True)])
    with Session(test_engine) as check:
        rows = all_rows(check, pid)
        assert users[4] not in rows and rows[users[0]].publish_state == "published"


def test_commit_failure_is_not_reported_as_success(client, db_session, test_engine, monkeypatch, batch_setup):
    token, pm, users, ids = batch_setup
    db_session.commit()
    transactional_override(client, test_engine)
    def fail_commit(self):
        raise RuntimeError("test commit failure")
    monkeypatch.setattr(Session, "commit", fail_commit)
    pid = pm["practices"][0]["id"]
    with pytest.raises(RuntimeError, match="test commit failure"):
        save(client, token, pm, [change(pid, users[0], False, ids[0], "published"), change(pid, users[4], True)])
    with Session(test_engine) as check:
        rows = all_rows(check, pid)
        assert users[4] not in rows and rows[users[0]].publish_state == "published"


def test_measure_individual_vs_batch(client, db_session, test_engine, make_user, batch_setup):
    """5追加+5削除。認証・commit込み。SQL論理回数とDBAPI呼出を分ける。"""
    token, pm, _, _ = batch_setup
    pid = pm["practices"][1]["id"]
    users = [make_user()[0] for _ in range(10)]
    ids = [generate_id("asg") for _ in range(5)]
    def reset():
        with Session(test_engine) as session:
            session.execute(delete(Assignment).where(Assignment.practice_id == pid))
            session.add_all([Assignment(id=aid, practice_id=pid, user_id=uid, assigned_via="grade3", publish_state="published")
                             for aid, uid in zip(ids, users)])
            session.commit()
    db_session.commit()
    transactional_override(client, test_engine)
    count = Counter()
    def record(conn, cursor, statement, parameters, context, executemany):
        operation = statement.lstrip().split()[0].upper()
        if operation in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            count["calls"] += 1
            count[operation] += len(parameters) if executemany else 1
    samples = {"individual": [], "batch": []}
    for _ in range(3):
        for mode in samples:
            reset(); count.clear()
            event.listen(test_engine, "before_cursor_execute", record)
            started = perf_counter()
            try:
                if mode == "individual":
                    for aid in ids:
                        assert client.delete(f"/api/v1/assignments/{aid}", headers=auth_header(token)).status_code == 204
                    for uid in users[5:]:
                        assert client.post(f"/api/v1/practices/{pid}/assignments", json={"user_id": uid}, headers=auth_header(token)).status_code == 201
                else:
                    changes = [change(pid, uid, False, aid, "published") for uid, aid in zip(users, ids)]
                    changes += [change(pid, uid, True) for uid in users[5:]]
                    assert save(client, token, pm, changes).status_code == 204
            finally:
                elapsed = (perf_counter() - started) * 1000
                event.remove(test_engine, "before_cursor_execute", record)
            samples[mode].append({**count, "ms": round(elapsed, 1)})
    print("\nBATCH_BENCHMARK", samples)
    assert samples["batch"][0]["SELECT"] == 5  # 認証1 + 月/日/会員/割当
    assert samples["batch"][0]["calls"] < samples["individual"][0]["calls"]
