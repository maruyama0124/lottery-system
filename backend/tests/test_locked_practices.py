"""D-053: date-independent fixed practices and independent remaining draws."""
from unittest.mock import patch

import pytest
from sqlalchemy import select, text

from src.db.models import Assignment, LotteryExecution, MonthlyMemberResult, Practice, PracticeMonth, Vote
from src.domain.lottery import run_lottery as engine_run
from src.services.lottery_service import LotteryService
from tests.conftest import auth_header
from tests.test_assignment_batch import body, change
from tests.test_lottery_api import setup_month_with_votes, run_lottery


@pytest.fixture
def locked_setup(client, make_user, db_session):
    token, pm, _ = setup_month_with_votes(client, make_user)
    assert run_lottery(client, token, pm['id'], seed=42).status_code == 201
    assert client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(token)).status_code == 204
    fixed = db_session.get(Practice, pm['practices'][0]['id'])
    fixed.is_assignment_locked = True
    db_session.flush()
    pm = client.get(f"/api/v1/practice-months/{pm['id']}", headers=auth_header(token)).json()
    return token, pm, fixed, pm['practices'][1]['id']


def snapshot(db, pid):
    return sorted((a.id, a.user_id, a.publish_state, a.is_deleted, a.assigned_via,
                   a.lottery_execution_id, a.updated_at) for a in db.scalars(
        select(Assignment).where(Assignment.practice_id == pid)))


def test_rerun_only_remaining_days_and_keeps_fixed_public(client, db_session, locked_setup):
    token, pm, fixed, other = locked_setup
    before = snapshot(db_session, fixed.id)
    fixed.quota_grade1 = fixed.quota_grade2 = fixed.quota_grade3 = None
    db_session.flush()  # 固定日の未設定枠は抽選の妨げにならない
    summary = client.get(f"/api/v1/practice-months/{pm['id']}/vote-summary", headers=auth_header(token)).json()
    assert summary['quotas_ready']
    # UIは固定日も含めた全日程を保存する。提案値適用でも固定枠は変えない。
    request = {'practices': [{'practice_id':p['practice_id'], 'grades':[
        {'grade':g['grade'],'quota':g['suggested_quota']} for g in p['grades']
    ]} for p in summary['practices']]}
    assert client.put(f"/api/v1/practice-months/{pm['id']}/quotas", json=request, headers=auth_header(token)).status_code == 204
    assert fixed.quota_grade1 is None
    for seed in (10, 20):
        with patch('src.services.lottery_service.run_lottery', wraps=engine_run) as draw:
            res = run_lottery(client, token, pm['id'], seed=seed, confirm_rerun=True)
        assert res.status_code == 201, res.text
        args = draw.call_args.kwargs
        assert [p.id for p in args['practices']] == [other]
        assert all(pids == {other} for pids in args['votes'].values())
        assert snapshot(db_session, fixed.id) == before
        month = db_session.get(PracticeMonth, pm['id'])
        assert month.status == 'published' and month.published_at.isoformat().replace('+00:00','Z') == pm['published_at']
        visible = client.get(f"/api/v1/practice-months/{pm['id']}/participation", headers=auth_header(token))
        assert visible.status_code == 200
        assert all(set(r['practice_ids']) <= {fixed.id} for g in visible.json()['grades'] for r in g['rows'])
        ex = db_session.get(LotteryExecution, res.json()['id'])
        assert ex.settings_snapshot['locked_practice_ids'] == [fixed.id]
        assert set(ex.settings_snapshot['quotas']) == {other}
    assert client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(token)).status_code == 204
    assert snapshot(db_session, fixed.id) == before
    stats = db_session.scalars(select(MonthlyMemberResult).where(MonthlyMemberResult.practice_month_id == pm['id'])).all()
    assert stats and all(r.votes_count == 2 and r.wins_count == 2 for r in stats)


def test_fixed_only_voter_not_in_draw(client, db_session, locked_setup):
    token, pm, fixed, other = locked_setup
    vote = db_session.scalar(select(Vote).where(Vote.practice_id == other))
    uid = vote.user_id
    vote.is_deleted = True
    db_session.flush()
    service = LotteryService(db_session)
    _, members, votes = service._collect_inputs(db_session.get(PracticeMonth, pm['id']))
    assert uid not in votes and uid not in {m.id for m in members}


def test_first_execution_replaces_only_unlocked_manual_rows(client, db_session, locked_setup):
    token, pm, fixed, other = locked_setup
    before = snapshot(db_session, fixed.id)
    for execution in db_session.scalars(select(LotteryExecution).where(
        LotteryExecution.practice_month_id == pm['id']
    )):
        execution.is_active = False
    db_session.flush()
    assert run_lottery(client, token, pm['id'], seed=99).status_code == 201
    assert snapshot(db_session, fixed.id) == before
    rows = db_session.scalars(select(Assignment).where(
        Assignment.practice_id == other, Assignment.is_deleted.is_(False)
    )).all()
    assert len(rows) == len({r.user_id for r in rows}) == 6
    assert all(r.publish_state == 'pending' for r in rows)


def test_admin_sql_uses_ids_and_default_flag_not_exposed(client, db_session, locked_setup):
    from pathlib import Path
    token, pm, fixed, other = locked_setup
    assert 'is_assignment_locked' not in pm['practices'][0]
    assert not db_session.get(Practice, other).is_assignment_locked
    script = Path('scripts/admin/lock_practices.sql').read_text()
    script = script.replace("'対象の練習日ID'", "'" + other + "'")
    db_session.execute(text(script))
    db_session.expire_all()
    assert db_session.get(Practice, other).is_assignment_locked


def test_all_locked_and_unsettled_locked_rejected(client, db_session, locked_setup):
    token, pm, fixed, other = locked_setup
    db_session.get(Practice, other).is_assignment_locked = True
    db_session.flush()
    assert run_lottery(client, token, pm['id'], confirm_rerun=True).status_code == 409
    db_session.get(Practice, other).is_assignment_locked = False
    row = db_session.scalar(select(Assignment).where(Assignment.practice_id == fixed.id, Assignment.is_deleted.is_(False)))
    row.publish_state = 'removing'
    db_session.flush()
    assert run_lottery(client, token, pm['id'], confirm_rerun=True).status_code == 409
    assert client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(token)).status_code == 409
    assert not row.is_deleted and row.publish_state == 'removing'


def test_fixed_adjustments_schedule_and_quota_protected(client, db_session, locked_setup):
    token, pm, fixed, other = locked_setup
    row = db_session.scalar(select(Assignment).where(Assignment.practice_id == fixed.id, Assignment.is_deleted.is_(False)))
    before = snapshot(db_session, fixed.id)
    assert client.delete(f"/api/v1/assignments/{row.id}", headers=auth_header(token)).status_code == 409
    assert client.post(f"/api/v1/practices/{fixed.id}/assignments", json={'user_id':row.user_id}, headers=auth_header(token)).status_code == 409
    changes = [change(other, row.user_id, False), change(fixed.id, row.user_id, False, row.id, 'published')]
    assert client.put(f"/api/v1/practice-months/{pm['id']}/assignments", json=body(pm, changes), headers=auth_header(token)).status_code == 409
    assert client.delete(f"/api/v1/practices/{fixed.id}?force=true", headers=auth_header(token)).status_code == 409
    data = {k:pm['practices'][0][k] for k in ('practice_date','starts_at','ends_at','location','capacity')}
    assert client.put(f"/api/v1/practices/{fixed.id}", json=data, headers=auth_header(token)).status_code == 409
    quotas = [{'grade':g, 'quota':getattr(fixed,f'quota_grade{g}')} for g in (1,2,3)]
    request = {'practices':[{'practice_id':fixed.id, 'grades':quotas}]}
    assert client.put(f"/api/v1/practice-months/{pm['id']}/quotas", json=request, headers=auth_header(token)).status_code == 204
    quotas[0]['quota'] += 1
    assert client.put(f"/api/v1/practice-months/{pm['id']}/quotas", json=request, headers=auth_header(token)).status_code == 409
    assert snapshot(db_session, fixed.id) == before


def test_vote_replacement_keeps_locked_votes(client, make_user, db_session):
    # 締切前にも、固定日の投票を追加・削除できない。
    from tests.test_practices import create_month
    _, token = make_user(role='representative')
    uid, member_token = make_user()
    pm = create_month(client, token)
    fixed, other = [p['id'] for p in pm['practices']]
    url = f"/api/v1/practice-months/{pm['id']}/votes/me"
    assert client.put(url, json={'practice_ids':[fixed]}, headers=auth_header(member_token)).status_code == 204
    db_session.get(Practice, fixed).is_assignment_locked = True
    db_session.flush()
    assert client.put(url, json={'practice_ids':[other]}, headers=auth_header(member_token)).status_code == 409
    assert client.put(url, json={'practice_ids':[fixed,other]}, headers=auth_header(member_token)).status_code == 204
    _, newcomer = make_user()
    assert client.put(url, json={'practice_ids':[fixed]}, headers=auth_header(newcomer)).status_code == 409
    votes = client.get(url, headers=auth_header(member_token)).json()['voted_practice_ids']
    assert set(votes) == {fixed,other}


def test_partial_publication_can_vote_without_changing_public_result(client, make_user, db_session):
    from datetime import timedelta
    from src.core.datetime_utils import utcnow
    token, pm, _ = setup_month_with_votes(client, make_user)
    assert run_lottery(client, token, pm['id'], seed=42).status_code == 201
    assert client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(token)).status_code == 204
    fixed, other = [p['id'] for p in pm['practices']]
    month = db_session.get(PracticeMonth, pm['id'])
    month.vote_starts_at, month.vote_ends_at = utcnow()-timedelta(days=1), utcnow()+timedelta(days=1)
    db_session.get(Practice, fixed).is_assignment_locked = True
    row = db_session.scalar(select(Vote).where(Vote.practice_id == fixed))
    uid = row.user_id
    from src.db.models import User
    from src.core.security import create_access_token
    user = db_session.get(User, uid)
    member_token = create_access_token(user.id, user.role, user.gender)
    db_session.flush()
    vote_url = f"/api/v1/practice-months/{pm['id']}/votes/me"
    public_url = f"/api/v1/practice-months/{pm['id']}/results/me"
    before = client.get(public_url, headers=auth_header(member_token)).json()
    status = client.get(vote_url, headers=auth_header(member_token)).json()
    assert status['editable'] is True and status['locked_practice_ids'] == [fixed]
    assert client.put(vote_url, json={'practice_ids':[fixed]}, headers=auth_header(member_token)).status_code == 204
    assert client.get(public_url, headers=auth_header(member_token)).json() == before
    assert client.put(vote_url, json={'practice_ids':[other]}, headers=auth_header(member_token)).status_code == 409
    assert run_lottery(client, token, pm['id'], confirm_rerun=True).status_code == 409
    month.vote_ends_at = utcnow()-timedelta(seconds=1)
    db_session.flush()
    assert client.get(vote_url, headers=auth_header(member_token)).json()['editable'] is False
    assert client.put(vote_url, json={'practice_ids':[fixed,other]}, headers=auth_header(member_token)).status_code == 409
    assert run_lottery(client, token, pm['id'], confirm_rerun=True).status_code == 201


def test_normal_published_month_cannot_revote(client, make_user, db_session):
    from datetime import timedelta
    from src.core.datetime_utils import utcnow
    token, pm, _ = setup_month_with_votes(client, make_user)
    assert run_lottery(client, token, pm['id'], seed=42).status_code == 201
    assert client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(token)).status_code == 204
    month = db_session.get(PracticeMonth, pm['id'])
    month.vote_starts_at, month.vote_ends_at = utcnow()-timedelta(days=1), utcnow()+timedelta(days=1)
    db_session.flush()
    url = f"/api/v1/practice-months/{pm['id']}/votes/me"
    assert client.get(url, headers=auth_header(token)).json()['editable'] is False
    assert client.put(url, json={'practice_ids':[]}, headers=auth_header(token)).status_code == 409
