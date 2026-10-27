"""定員の未設定・学年枠での確定・既存データ移行を検証する。"""
from datetime import datetime, timedelta, timezone

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from migrations.versions.c8d4e2a6b913_capacity_from_grade_quotas import upgrade, downgrade
from src.db.models import Practice
from tests.conftest import auth_header
from tests.test_practices import month_body


def create_without_capacity(client, make_user):
    _,token=make_user(role='representative')
    body=month_body(practices=1)
    body['practices'][0].pop('capacity')
    body['vote_starts_at']=(datetime.now(timezone.utc)-timedelta(days=2)).isoformat()
    body['vote_ends_at']=(datetime.now(timezone.utc)-timedelta(days=1)).isoformat()
    response=client.post('/api/v1/practice-months',json=body,headers=auth_header(token))
    assert response.status_code==201,response.text
    return auth_header(token),response.json(),body


def quotas(pid, values):
    return {'practices':[{'practice_id':pid,'grades':[
        {'grade':grade,'quota':value} for grade,value in enumerate(values,1)
    ]}]}


@pytest.mark.parametrize('values', [(2,3,4),(0,0,0)])
def test_creation_without_capacity_requires_quota_confirmation(client,make_user,db_session,values):
    header,pm,body=create_without_capacity(client,make_user)
    p=pm['practices'][0];pid=p['id'];base=f"/api/v1/practice-months/{pm['id']}"
    assert p['capacity'] is None
    suggestions=client.get('/api/v1/practices/suggestions',headers=header)
    assert suggestions.status_code==200 and suggestions.json()[0]['capacity'] is None
    summary=client.get(base+'/vote-summary',headers=header).json()
    assert summary['quotas_ready'] is False and summary['practices'][0]['capacity'] is None
    assert client.post(base+'/lottery',json={},headers=header).status_code==409
    assert client.put(base+'/quotas',json=quotas(pid,values),headers=header).status_code==204
    summary=client.get(base+'/vote-summary',headers=header).json()
    assert summary['quotas_ready'] is True and summary['practices'][0]['capacity']==sum(values)
    # 旧クライアントが日程編集で定員を送っても、確定値を上書きできない。
    edit={**body['practices'][0],'location':'新会場','capacity':99}
    assert client.put('/api/v1/practices/'+pid,json=edit,headers=header).status_code==204
    assert db_session.get(Practice,pid).capacity==sum(values)
    assert client.post(base+'/lottery',json={},headers=header).status_code==201


def test_inconsistent_or_partial_quota_state_cannot_execute(client,make_user,db_session):
    header,pm,_=create_without_capacity(client,make_user)
    pid=pm['practices'][0]['id'];base=f"/api/v1/practice-months/{pm['id']}"
    p=db_session.get(Practice,pid)
    p.quota_grade1=2;p.quota_grade2=3;p.quota_grade3=4
    db_session.flush()
    assert client.post(base+'/lottery',json={},headers=header).status_code==409
    assert client.get(base+'/vote-summary',headers=header).json()['quotas_ready'] is False
    assert client.put(base+'/quotas',json=quotas(pid,(2,3,4)),headers=header).status_code==204
    assert db_session.get(Practice,pid).capacity==9
    bad=quotas(pid,(2,3,4));bad['practices'][0]['grades'].append({'grade':1,'quota':5})
    assert client.put(base+'/quotas',json=bad,headers=header).status_code==400


def test_capacity_migration_preserves_fixed_and_legacy_unconfigured_data(test_engine):
    # 一時表で旧DDLを再現し、実際のアプリテーブルは一切変更しない。
    with test_engine.begin() as conn:
        conn.execute(text('''CREATE TEMP TABLE practices (
            id integer, capacity integer NOT NULL CONSTRAINT ck_practices_capacity CHECK(capacity > 0),
            quota_grade1 integer, quota_grade2 integer, quota_grade3 integer,
            is_assignment_locked boolean NOT NULL DEFAULT false
        ) ON COMMIT DROP'''))
        conn.execute(text('''INSERT INTO practices VALUES
            (1,30,2,3,4,false), (2,28,2,3,4,true), (3,20,NULL,NULL,NULL,false), (4,30,0,0,0,false)'''))
        with Operations.context(MigrationContext.configure(conn)):
            upgrade()
            assert dict(conn.execute(text('SELECT id,capacity FROM practices')).all())=={1:9,2:28,3:20,4:0}
            conn.execute(text('INSERT INTO practices(id,capacity) VALUES(5,NULL)'))
            with pytest.raises(DBAPIError),conn.begin_nested():
                downgrade()
            # 旧DDLへ戻せるデータに整えた場合だけdowngradeが成功する。
            conn.execute(text('UPDATE practices SET capacity=1 WHERE capacity IS NULL OR capacity=0'))
            downgrade()
            with pytest.raises(DBAPIError),conn.begin_nested():
                conn.execute(text('INSERT INTO practices(id,capacity) VALUES(6,NULL)'))
