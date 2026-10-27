"""既存練習の対象性別変更と削除ガード・原子性。"""
from unittest.mock import patch

import pytest
from sqlalchemy import select

from src.db.models import Assignment, Practice, Vote
from src.services.practice_service import PracticeService
from tests.conftest import auth_header
from tests.test_practices import month_body


def setup_edit(client, make_user, genders=('male',), months=('male','female')):
    uid, token = make_user(role='representative', gender='male')
    header = auth_header(token)
    body = {**month_body(practices=1), 'genders':list(months)}
    body['practices'][0]['genders'] = list(genders)
    created = client.post('/api/v1/practice-months/batch', json=body, headers=header)
    assert created.status_code == 201, created.text
    source = next(p for m in created.json() for p in m['practices'])
    path = f"/api/v1/practices/{source['id']}/genders"
    context = client.get(path,headers=header)
    assert context.status_code == 200, context.text
    request = {'genders':list(genders), 'practice':body['practices'][0],
               'expected_versions':context.json()['versions']}
    return uid, header, path, request, created.json()


@pytest.mark.parametrize('original,target', [(['male'],['male','female']),
    (['female'],['male']), (['male','female'],['female']), (['female'],['male','female'])])
def test_change_gender_add_update_remove_atomically(client, make_user, db_session, original, target):
    _, header, path, request, months = setup_edit(client,make_user,original)
    old_ids = {g:v['id'] for g,v in request['expected_versions'].items()}
    request['genders'] = target
    request['practice'].update(location='更新場所')
    request['practice'].pop('capacity')
    response = client.put(path,json=request,headers=header)
    assert response.status_code == 204, response.text
    for month in months:
        practices = client.get(f"/api/v1/practice-months/{month['id']}",headers=header).json()['practices']
        assert len(practices) == (1 if month['gender'] in target else 0)
        if practices:
            assert practices[0]['location'] == '更新場所'
            assert practices[0]['capacity'] == (30 if month['gender'] in old_ids else None)
            if month['gender'] in old_ids:
                assert practices[0]['id'] == old_ids[month['gender']]
    for gender in set(original)-set(target):
        assert db_session.get(Practice,old_ids[gender]).is_deleted


@pytest.mark.parametrize('blocker',['vote','assignment','removing','locked'])
def test_removal_with_data_or_lock_is_rejected_without_any_updates(client, make_user, db_session, blocker):
    uid,header,path,request,_ = setup_edit(client,make_user,['male','female'])
    female_id = request['expected_versions']['female']['id']
    if blocker=='vote':
        db_session.add(Vote(id='vot_block',user_id=uid,practice_id=female_id))
    elif blocker=='locked':
        db_session.get(Practice,female_id).is_assignment_locked = True
    else:
        db_session.add(Assignment(id='asg_block',user_id=uid,practice_id=female_id,
            assigned_via='manual',publish_state='removing' if blocker=='removing' else 'published'))
    db_session.commit()
    request['expected_versions'] = client.get(path,headers=header).json()['versions']
    request['genders'] = ['male'];request['practice']['capacity']=9
    response = client.put(path,json=request,headers=header)
    assert response.status_code == 409, response.text
    for version in request['expected_versions'].values():
        p = db_session.get(Practice,version['id'])
        assert not p.is_deleted and p.capacity==30


def test_retained_votes_assignments_and_ids_are_not_copied(client, make_user, db_session):
    uid,header,path,request,_ = setup_edit(client,make_user)
    pid = request['expected_versions']['male']['id']
    db_session.add_all([Vote(id='vot_keep',user_id=uid,practice_id=pid),
        Assignment(id='asg_keep',user_id=uid,practice_id=pid,assigned_via='manual')])
    db_session.commit();request['genders']=['male','female']
    assert client.put(path,json=request,headers=header).status_code == 204
    assert db_session.get(Vote,'vot_keep').practice_id == pid
    assert db_session.get(Assignment,'asg_keep').practice_id == pid
    assert len(list(db_session.scalars(select(Vote)))) == 1


def test_stale_context_and_new_counterpart_are_rejected(client, make_user, db_session):
    _,header,path,request,months = setup_edit(client,make_user)
    male = db_session.get(Practice,request['expected_versions']['male']['id'])
    male.capacity=22;db_session.commit()
    assert client.put(path,json=request,headers=header).status_code==409
    request['expected_versions']=client.get(path,headers=header).json()['versions']
    female_month=next(m for m in months if m['gender']=='female')
    assert client.post(f"/api/v1/practice-months/{female_month['id']}/practices", json=request['practice'],headers=header).status_code==403
    assert client.post('/api/v1/practices/batch',json={'year_month':'2026-08','genders':['female'],'practice':request['practice']},headers=header).status_code==201
    assert client.put(path,json=request,headers=header).status_code==409


def test_missing_month_and_date_collision_are_non_destructive(client, make_user, db_session):
    _,header,path,request,_ = setup_edit(client,make_user,months=['male'])
    request['genders']=['female']
    assert client.put(path,json=request,headers=header).status_code==404
    request['genders']=['male']
    body = {**request['practice'],'practice_date':'2026-08-20'}
    assert client.post('/api/v1/practices/batch',json={'year_month':'2026-08','genders':['male'],'practice':body},headers=header).status_code==201
    request['practice']['practice_date']='2026-08-20'
    assert client.put(path,json=request,headers=header).status_code==409
    assert not db_session.get(Practice,request['expected_versions']['male']['id']).is_deleted


def test_insert_failure_rolls_back_source_removal(client, make_user, db_session):
    _,header,path,request,_ = setup_edit(client,make_user)
    db_session.commit();request['genders']=['female']
    with patch.object(PracticeService,'_create_practice',side_effect=RuntimeError('insert failed')),pytest.raises(RuntimeError):
        client.put(path,json=request,headers=header)
    assert not db_session.get(Practice,request['expected_versions']['male']['id']).is_deleted
    assert len(list(db_session.scalars(select(Practice).where(Practice.is_deleted.is_(False))))) == 1


def test_gender_edit_requires_representative_and_valid_context(client, make_user):
    _,header,path,request,_ = setup_edit(client,make_user)
    _,member = make_user()
    for headers,expected in [({},401),(auth_header(member),403)]:
        assert client.get(path,headers=headers).status_code==expected
        assert client.put(path,json=request,headers=headers).status_code==expected
    for targets in [[],['other'],['male','male']]:
        assert client.put(path,json={**request,'genders':targets},headers=header).status_code==400
    assert client.put(path,json={**request,'expected_versions':{}},headers=header).status_code==400


def test_same_day_multiple_existing_practices_is_ambiguous(client, make_user):
    _,header,path,request,months = setup_edit(client,make_user)
    male_month=next(m for m in months if m['gender']=='male')
    assert client.post(f"/api/v1/practice-months/{male_month['id']}/practices",json=request['practice'],headers=header).status_code==201
    assert client.get(path,headers=header).status_code==409
    assert client.put(path,json=request,headers=header).status_code==409


def test_locked_retained_day_and_outside_month_are_rejected(client, make_user, db_session):
    _,header,path,request,_ = setup_edit(client,make_user)
    pid=request['expected_versions']['male']['id']
    db_session.get(Practice,pid).is_assignment_locked=True;db_session.commit()
    request['expected_versions']=client.get(path,headers=header).json()['versions']
    request['genders']=['male','female']
    assert client.put(path,json=request,headers=header).status_code==409
    request['genders']=['male'];request['practice']['location']='変更場所'
    assert client.put(path,json=request,headers=header).status_code==409
    request['practice']['location']='第一体育館'
    assert client.put(path,json=request,headers=header).status_code==204
    request['practice']['practice_date']='2026-09-10'
    assert client.put(path,json=request,headers=header).status_code==400


def test_gender_edit_commit_failure_rolls_back_all(client, make_user, db_session):
    _,header,path,request,_ = setup_edit(client,make_user)
    db_session.commit();request['genders']=['female']
    with patch.object(db_session,'commit',side_effect=RuntimeError('commit failed')),pytest.raises(RuntimeError):
        client.put(path,json=request,headers=header)
    assert not db_session.get(Practice,request['expected_versions']['male']['id']).is_deleted
    assert len(list(db_session.scalars(select(Practice).where(Practice.is_deleted.is_(False)))))==1
