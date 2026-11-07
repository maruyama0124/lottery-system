"""D-070: 抽選対象から外しても公開済み参加記録は保持する。"""
import pytest
from sqlalchemy import select

from src.core.ids import generate_id
from src.db.models import Assignment, MonthlyMemberResult, PracticeMonth, User, Vote
from src.domain.lottery import run_lottery
from src.services.lottery_service import LotteryService
from tests.conftest import auth_header
from tests.api_helpers import save_participation
from tests.test_lottery_api import setup_month_with_votes
from tests.test_practices import create_month


def published_month(client, make_user):
    token, pm, members = setup_month_with_votes(client, make_user, practices=1)
    header = auth_header(token)
    assert client.post(f"/api/v1/practice-months/{pm['id']}/lottery", json={"seed": 1}, headers=header).status_code == 201
    assert client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=header).status_code == 204
    uid = client.get('/api/v1/users/me', headers=auth_header(members[0])).json()['id']
    return token, pm, members[0], uid


def public_rows(client, token, pm):
    response = client.get(f"/api/v1/practice-months/{pm['id']}/participation", headers=auth_header(token))
    assert response.status_code == 200, response.text
    return {r['user_id']: r for section in response.json()['grades'] for r in section['rows']}


def test_retired_member_stays_in_both_tables_but_not_votes_roster_or_draw(client, make_user, db_session):
    rep, pm, member, uid = published_month(client, make_user)
    before = public_rows(client, member, pm)[uid]
    db_session.get(User, uid).is_observer = True
    db_session.flush()
    assert public_rows(client, member, pm)[uid] == before
    results = client.get(f"/api/v1/practice-months/{pm['id']}/results", headers=auth_header(rep)).json()
    row = next(r for r in results['by_member'] if r['user_id'] == uid)
    assert row['wins_count'] == 1 and row['practice_ids'] == before['practice_ids']
    assert uid in {p['user_id'] for day in results['by_practice'] for p in day['participants']}
    assert client.put(f"/api/v1/practice-months/{pm['id']}/votes/me", json={'practice_ids': []}, headers=auth_header(member)).status_code == 403
    assert uid not in {u['id'] for u in client.get('/api/v1/users?per_page=200', headers=auth_header(rep)).json()['items']}
    days, players, votes = LotteryService(db_session)._collect_inputs(db_session.get(PracticeMonth, pm['id']))
    assert uid not in {m.id for m in players}
    # 過去の投票自体は保持するが、プレイヤー一覧にいないので割り当てない。
    result = run_lottery(days, players, votes, rescue_alpha=1, seed=1)
    assert uid not in {mid for _, mid, _ in result.assignments}
    assert save_participation(client, pm['id'], pm['practices'][0]['id'], uid, True, headers=auth_header(rep)).status_code == 403
    later = create_month(client, rep, year_month='2026-09')
    db_session.get(PracticeMonth, later['id']).status = 'published'
    db_session.flush()
    assert uid not in public_rows(client, member, later)
    later_results = client.get(f"/api/v1/practice-months/{later['id']}/results", headers=auth_header(rep)).json()
    assert uid not in {r['user_id'] for r in later_results['by_member']}


@pytest.mark.parametrize('state,deleted,visible', [
    ('published', False, True), ('removing', False, True),
    ('pending', False, False), ('published', True, False),
])
def test_only_visible_month_assignments_restore_observers(client, make_user, db_session, state, deleted, visible):
    rep, pm, member, uid = published_month(client, make_user)
    db_session.get(User, uid).is_observer = True
    assignment = db_session.scalar(select(Assignment).where(Assignment.user_id == uid))
    assignment.publish_state, assignment.is_deleted = state, deleted
    db_session.flush()
    assert (uid in public_rows(client, member, pm)) == visible
    results = client.get(f"/api/v1/practice-months/{pm['id']}/results", headers=auth_header(rep)).json()
    assert (uid in {r['user_id'] for r in results['by_member']}) == visible
    assert (uid in {p['user_id'] for d in results['by_practice'] for p in d['participants']}) == visible
    if state == 'removing':
        assert client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(rep)).status_code == 204
        assert uid not in public_rows(client, member, pm)


def test_observers_without_participation_and_deleted_or_other_gender_users_stay_hidden(client, make_user, db_session):
    rep, pm, member, uid = published_month(client, make_user)
    observer, _ = make_user(is_observer=True)
    assert save_participation(client, pm['id'], pm['practices'][0]['id'], observer, True, headers=auth_header(rep)).status_code == 403
    user = db_session.get(User, uid)
    user.is_observer = True
    for field, value in [('gender', 'female'), ('is_deleted', True)]:
        user.gender, user.is_deleted = 'male', False
        setattr(user, field, value)
        db_session.flush()
        rows = public_rows(client, rep, pm)
        assert uid not in rows and observer not in rows


def test_unpublished_month_does_not_expose_observer_history(client, make_user, db_session):
    rep, pm, member, uid = published_month(client, make_user)
    db_session.get(User, uid).is_observer = True
    db_session.get(PracticeMonth, pm['id']).status = 'drawn'
    db_session.flush()
    assert client.get(f"/api/v1/practice-months/{pm['id']}/participation", headers=auth_header(member)).status_code == 404
    assert client.get(f"/api/v1/practice-months/{pm['id']}/results", headers=auth_header(member)).status_code == 403


def test_retired_manager_stays_visible_and_is_not_counted_as_player_on_republish(client, make_user, db_session):
    rep, pm, _, _ = published_month(client, make_user)
    manager, _ = make_user(is_manager=True, is_observer=True)
    pid = pm['practices'][0]['id']
    db_session.add(Vote(id=generate_id('vot'), user_id=manager, practice_id=pid))
    db_session.add(Assignment(id=generate_id('asg'), user_id=manager, practice_id=pid,
        assigned_via='manager', publish_state='published'))
    db_session.flush()
    assert public_rows(client, rep, pm)[manager]['is_manager'] is True
    assert client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=auth_header(rep)).status_code == 204
    assert db_session.scalar(select(MonthlyMemberResult).where(
        MonthlyMemberResult.user_id == manager, MonthlyMemberResult.practice_month_id == pm['id']
    )) is None
