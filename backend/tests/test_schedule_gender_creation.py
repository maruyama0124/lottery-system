"""代表による男女別・男女同時の作成。抽選と既存編集の担当性別は維持する。"""
from unittest.mock import patch

import pytest
from sqlalchemy import func, select

from src.db.models import Practice, PracticeMonth, Vote, Assignment
from src.services.practice_service import PracticeService
from tests.conftest import auth_header
from tests.test_practices import month_body, create_month


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def month_request(genders, *, practices=1):
    return {**month_body(practices=practices), 'genders': genders}


def day_request(genders):
    return {'year_month': '2026-08', 'genders': genders,
            'practice': {**month_body(practices=1)['practices'][0], 'practice_date': '2026-08-24'}}


def test_daily_targets_route_practices_to_separate_months(client, make_user):
    _, token = make_user(role='representative')
    body = month_request(['male', 'female'])
    practice = body['practices'][0]
    body['practices'] = [
        {**practice, 'practice_date': '2026-08-10', 'genders': ['male']},
        {**practice, 'practice_date': '2026-08-11', 'genders': ['female']},
        {**practice, 'practice_date': '2026-08-12', 'genders': ['male', 'female']},
    ]
    response = client.post('/api/v1/practice-months/batch', json=body, headers=auth_header(token))
    assert response.status_code == 201, response.text
    dates = {m['gender']: {p['practice_date'] for p in m['practices']} for m in response.json()}
    assert dates == {'male': {'2026-08-10', '2026-08-12'}, 'female': {'2026-08-11', '2026-08-12'}}
    assert len({p['id'] for m in response.json() for p in m['practices']}) == 4


@pytest.mark.parametrize('targets', [[], ['male', 'male'], ['other'], ['female']])
def test_invalid_daily_targets_create_nothing(client, make_user, db_session, targets):
    _, token = make_user(role='representative')
    body = month_request(['male'])
    body['practices'][0]['genders'] = targets
    response = client.post('/api/v1/practice-months/batch', json=body, headers=auth_header(token))
    assert response.status_code == 400, response.text
    assert count(db_session, PracticeMonth) == count(db_session, Practice) == 0


@pytest.mark.parametrize('rep_gender', ['male', 'female'])
@pytest.mark.parametrize('genders', [['male'], ['female'], ['male', 'female']])
def test_representative_can_create_selected_genders(client, make_user, db_session, rep_gender, genders):
    _, token = make_user(role='representative', gender=rep_gender)
    response = client.post('/api/v1/practice-months/batch', json=month_request(genders), headers=auth_header(token))
    assert response.status_code == 201, response.text
    months = response.json()
    assert {m['gender'] for m in months} == set(genders)
    assert len({m['id'] for m in months}) == len(genders)
    assert len({p['id'] for m in months for p in m['practices']}) == len(genders)
    result = client.post('/api/v1/practices/batch', json=day_request(genders), headers=auth_header(token))
    assert result.status_code == 201, result.text
    assert {p['practice_month_id'] for p in result.json()} == {m['id'] for m in months}
    assert count(db_session, Practice) == 2 * len(genders)
    assert count(db_session, Vote) == count(db_session, Assignment) == 0


def test_both_creation_preserves_independent_scope(client, make_user, db_session):
    _, token = make_user(role='representative', gender='male')
    months = client.post('/api/v1/practice-months/batch', json=month_request(['male','female']), headers=auth_header(token)).json()
    male, female = [next(m for m in months if m['gender']==gender) for gender in ('male','female')]
    male_p, female_p = [m['practices'][0] for m in (male,female)]
    edited = {**month_body(practices=1)['practices'][0], 'capacity': 12}
    assert client.put(f"/api/v1/practices/{male_p['id']}", json=edited, headers=auth_header(token)).status_code == 204
    assert db_session.get(Practice,female_p['id']).capacity == 30
    assert client.put(f"/api/v1/practices/{female_p['id']}", json=edited, headers=auth_header(token)).status_code == 403
    assert client.delete(f"/api/v1/practices/{female_p['id']}?force=true", headers=auth_header(token)).status_code == 403
    assert client.put(f"/api/v1/practice-months/{female['id']}", json={'vote_ends_at':female['vote_ends_at']}, headers=auth_header(token)).status_code == 403
    assert client.post(f"/api/v1/practice-months/{female['id']}/lottery", json={}, headers=auth_header(token)).status_code == 403
    assert client.post(f"/api/v1/practice-months/{female['id']}/publish", headers=auth_header(token)).status_code == 403
    _, member = make_user(gender='male')
    assert client.put(f"/api/v1/practice-months/{female['id']}/votes/me", json={'practice_ids':[female_p['id']]}, headers=auth_header(member)).status_code == 403


@pytest.mark.parametrize('genders', [[], ['male','male'], ['female','female'], ['other'], ['male','female','male']])
def test_invalid_targets_rejected_without_writes(client, make_user, db_session, genders):
    _, token = make_user(role='representative')
    assert client.post('/api/v1/practice-months/batch', json=month_request(genders), headers=auth_header(token)).status_code == 400
    assert client.post('/api/v1/practices/batch', json=day_request(genders), headers=auth_header(token)).status_code == 400
    assert count(db_session,PracticeMonth) == count(db_session,Practice) == 0


def test_create_endpoints_require_representative(client, make_user):
    _, token = make_user()
    for path, body in [('/api/v1/practice-months/batch',month_request(['male','female'])),
                       ('/api/v1/practices/batch',day_request(['male','female']))]:
        assert client.post(path,json=body,headers=auth_header(token)).status_code == 403
        assert client.post(path,json=body).status_code == 401


def test_existing_month_merges_and_creates_other_side(client, make_user, db_session):
    _, female = make_user(role='representative',gender='female')
    existing = create_month(client,female)
    _, male = make_user(role='representative',gender='male')
    db_session.commit()
    body = month_request(['male','female'])
    body['practices'][0].update(location='更新場所', capacity=12, starts_at='19:00', note='最新候補', allowed_grades=[1,2])
    body['vote_ends_at'] = '2026-08-30T00:00:00Z'
    response = client.post('/api/v1/practice-months/batch',json=body,headers=auth_header(male))
    assert response.status_code == 201, response.text
    assert count(db_session,PracticeMonth) == 2
    updated = next(m for m in response.json() if m['gender']=='female')
    assert updated['id'] == existing['id'] and updated['vote_ends_at'] == existing['vote_ends_at']
    assert updated['practices'][0]['id'] == existing['practices'][0]['id']
    assert updated['practices'][0]['location'] == '更新場所'
    assert updated['practices'][0]['capacity'] == 12
    assert updated['practices'][0]['allowed_grades'] == [1,2]
    assert count(db_session,Practice) == 3


def test_concurrent_month_creation_conflict_rolls_back_both(client, make_user, db_session):
    _, female = make_user(role='representative',gender='female')
    create_month(client,female)
    _, male = make_user(role='representative',gender='male')
    db_session.commit()
    # 存在確認直後に別処理が同じ月を作ったケースを、DBの実一意制約で検証する。
    with patch.object(PracticeService,'_lock_existing_months',return_value={}):
        response = client.post('/api/v1/practice-months/batch',json=month_request(['male','female']),headers=auth_header(male))
    assert response.status_code == 409
    assert count(db_session,PracticeMonth) == 1 and count(db_session,Practice) == 2


def test_missing_target_month_and_wrong_date_do_not_add_anything(client, make_user, db_session):
    _, token = make_user(role='representative')
    create_month(client,token,practices=0)
    db_session.commit()
    assert client.post('/api/v1/practices/batch',json=day_request(['male','female']),headers=auth_header(token)).status_code == 404
    request = day_request(['male']);request['practice']['practice_date']='2026-09-24'
    assert client.post('/api/v1/practices/batch',json=request,headers=auth_header(token)).status_code == 400
    assert count(db_session,Practice) == 0
    bad = month_request(['male','female']);bad['year_month']='2026-10'
    assert client.post('/api/v1/practice-months/batch',json=bad,headers=auth_header(token)).status_code == 400
    assert count(db_session,PracticeMonth) == 1


@pytest.mark.parametrize('operation', ['month','practice'])
def test_failure_on_second_gender_is_atomic(client, make_user, db_session, operation):
    _, token = make_user(role='representative')
    if operation == 'practice':
        assert client.post('/api/v1/practice-months/batch',json=month_request(['male','female'],practices=0),headers=auth_header(token)).status_code == 201
    db_session.commit()
    original = PracticeService._create_practice
    calls = 0
    def fail_second(self, *args):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError('simulated second-side failure')
        return original(self,*args)
    path, body = ('/api/v1/practice-months/batch',month_request(['male','female'])) if operation=='month' else ('/api/v1/practices/batch',day_request(['male','female']))
    with patch.object(PracticeService,'_create_practice',fail_second), pytest.raises(RuntimeError):
        client.post(path,json=body,headers=auth_header(token))
    assert count(db_session,Practice) == 0
    assert count(db_session,PracticeMonth) == (0 if operation=='month' else 2)


def test_commit_failure_does_not_report_success(client, make_user, db_session):
    _, token = make_user(role='representative');db_session.commit()
    with patch.object(db_session,'commit',side_effect=RuntimeError('commit failed')), pytest.raises(RuntimeError):
        client.post('/api/v1/practice-months/batch',json=month_request(['male','female']),headers=auth_header(token))
    assert count(db_session,PracticeMonth) == count(db_session,Practice) == 0


def test_merge_is_idempotent_and_preserves_votes_assignments_and_other_days(client, make_user, db_session):
    user, token = make_user(role='representative')
    existing = create_month(client, token)
    pid = existing['practices'][0]['id']
    db_session.add_all([Vote(id='vot_merge', user_id=user, practice_id=pid),
                        Assignment(id='asg_merge', user_id=user, practice_id=pid,
                                   assigned_via='manual', publish_state='published')])
    db_session.commit()
    body = month_request(['male'])
    body['practices'][0]['location'] = '新体育館'
    first = client.post('/api/v1/practice-months/batch', json=body, headers=auth_header(token))
    assert first.status_code == 201, first.text
    before = db_session.get(Practice,pid).updated_at
    second = client.post('/api/v1/practice-months/batch', json=body, headers=auth_header(token))
    assert second.status_code == 201
    assert db_session.get(Practice,pid).updated_at == before
    assert count(db_session,Practice) == 2
    assert count(db_session,Vote) == count(db_session,Assignment) == 1
    assert db_session.get(Assignment,'asg_merge').publish_state == 'published'
    assert {p['id'] for p in second.json()[0]['practices']} == {p['id'] for p in existing['practices']}


def test_latest_candidate_per_gender_date_wins(client, make_user):
    _, token = make_user(role='representative')
    body = month_request(['male','female'])
    first = {**body['practices'][0], 'genders':['male','female']}
    body['practices'] = [first, {**first, 'genders':['female'], 'capacity':17, 'location':'最新'}]
    response = client.post('/api/v1/practice-months/batch', json=body, headers=auth_header(token))
    assert response.status_code == 201, response.text
    by_gender = {m['gender']:m['practices'] for m in response.json()}
    assert len(by_gender['female']) == len(by_gender['male']) == 1
    assert by_gender['female'][0]['capacity'] == 17
    assert by_gender['male'][0]['capacity'] == 30


def test_fixed_update_failure_rolls_back_other_gender_changes(client, make_user, db_session):
    _, token = make_user(role='representative')
    baseline = client.post('/api/v1/practice-months/batch', json=month_request(['male','female']), headers=auth_header(token)).json()
    for month in baseline:
        if month['gender']=='male':
            db_session.get(Practice,month['practices'][0]['id']).is_assignment_locked = True
    db_session.commit()
    body = month_request(['male','female']);body['practices'][0]['capacity'] = 12
    response = client.post('/api/v1/practice-months/batch', json=body, headers=auth_header(token))
    assert response.status_code == 409, response.text
    assert all(db_session.get(Practice,m['practices'][0]['id']).capacity == 30 for m in baseline)
    # 固定日でも変更なしの再送は許可する。
    assert client.post('/api/v1/practice-months/batch', json=month_request(['male','female']), headers=auth_header(token)).status_code == 201


def test_ambiguous_existing_same_date_rejected(client, make_user, db_session):
    _, token = make_user(role='representative')
    body = month_body(practices=1)
    body['practices'].append({**body['practices'][0], 'location':'別会場'})
    response = client.post('/api/v1/practice-months', json=body, headers=auth_header(token))
    # 旧APIは従来の同日複数登録・既存月409を維持する。
    assert response.status_code == 201
    db_session.commit()
    assert client.post('/api/v1/practice-months', json=body, headers=auth_header(token)).status_code == 409
    # 既存の同日複数行は自動で選ばない。
    result = client.post('/api/v1/practice-months/batch', json=month_request(['male']), headers=auth_header(token))
    assert result.status_code == 409


def test_day_addition_updates_same_date_instead_of_duplicating(client, make_user, db_session):
    _, token = make_user(role='representative')
    original = create_month(client,token,practices=1)['practices'][0]
    body = day_request(['male']);body['practice']['practice_date'] = original['practice_date']
    body['practice']['ends_at'] = '22:00'
    response = client.post('/api/v1/practices/batch', json=body, headers=auth_header(token))
    assert response.status_code == 201, response.text
    assert response.json()[0]['id'] == original['id']
    assert response.json()[0]['ends_at'] == '22:00'
    assert count(db_session,Practice) == 1
