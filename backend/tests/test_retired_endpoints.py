"""D-072: 現行APIへ一本化し、旧APIの再露出を防ぐ。"""
import pytest

from tests.conftest import auth_header
from tests.test_practices import create_month


RETIRED = [
    ('post', '/practice-months', '/practice-months', 405),
    ('post', '/practice-months/{pm_id}/practices', '/practice-months/{month}/practices', 404),
    ('put', '/practices/{practice_id}', '/practices/{practice}', 405),
    ('post', '/practices/{practice_id}/assignments', '/practices/{practice}/assignments', 404),
    ('delete', '/assignments/{assignment_id}', '/assignments/retired', 404),
    ('post', '/auth/logout', '/auth/logout', 404),
]


@pytest.mark.parametrize('method,schema_path,path,status', RETIRED)
def test_retired_endpoints_are_absent_and_cannot_mutate(client, make_user, db_session, method, schema_path, path, status):
    _, token = make_user(role='representative')
    pm = create_month(client, token)
    path = '/api/v1' + path.format(month=pm['id'], practice=pm['practices'][0]['id'])
    for headers in ({}, auth_header(token)):
        response = client.request(method, path, json={}, headers=headers)
        assert response.status_code == status, response.text
    spec = client.app.openapi()
    assert method not in spec['paths'].get('/api/v1' + schema_path, {})
    after = client.get(f"/api/v1/practice-months/{pm['id']}", headers=auth_header(token))
    assert after.status_code == 200
    assert after.json() == pm


def test_operational_and_current_endpoints_are_retained(client):
    paths = client.app.openapi()['paths']
    assert 'get' in paths['/api/v1/practice-months/{pm_id}/executions']
    assert 'put' in paths['/api/v1/practice-months/{pm_id}/assignments']
    assert 'post' in paths['/api/v1/practice-months/batch']
    assert 'post' in paths['/api/v1/practices/batch']
    assert 'put' in paths['/api/v1/practices/{practice_id}/genders']
    assert 'delete' in paths['/api/v1/practices/{practice_id}']
    assert 'AssignmentCreated' not in client.app.openapi()['components']['schemas']
