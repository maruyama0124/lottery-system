"""D-068: 管理対象は男女共通、投票・割当の性別は分離する。"""
import pytest

from tests.conftest import auth_header
from tests.test_practices import create_month
from tests.test_lottery_api import setup_month_with_votes


@pytest.mark.parametrize("gender", ["male", "female"])
def test_representative_can_manage_other_gender(client, make_user, gender):
    other = "female" if gender == "male" else "male"
    _, owner = make_user(role="representative", gender=other)
    _, operator = make_user(role="representative", gender=gender)
    pm = create_month(client, owner)
    h = auth_header(operator)
    assert client.get(f"/api/v1/practice-months/{pm['id']}/vote-summary", headers=h).status_code == 200
    assert client.get(f"/api/v1/practice-months/{pm['id']}/results", headers=h).status_code == 200
    assert client.get(f"/api/v1/practices/suggestions?gender={other}", headers=h).json()
    target, _ = make_user(gender=other)
    assert client.delete(f"/api/v1/users/{target}", headers=h).status_code == 204
    # 代表でも本人の投票先は変わらない。
    assert client.put(f"/api/v1/practice-months/{pm['id']}/votes/me", headers=h,
        json={"practice_ids": [pm['practices'][0]['id']]}).status_code == 403


def test_other_gender_draw_publish_and_assignment_validation(client, make_user):
    _, pm, _ = setup_month_with_votes(client, make_user)
    _, operator = make_user(role="representative", gender="female")
    h = auth_header(operator)
    assert client.post(f"/api/v1/practice-months/{pm['id']}/lottery", json={"seed": 42}, headers=h).status_code == 201
    assert client.post(f"/api/v1/practice-months/{pm['id']}/publish", headers=h).status_code == 204
    male, _ = make_user(gender="male")
    female, _ = make_user(gender="female")
    path = f"/api/v1/practices/{pm['practices'][0]['id']}/assignments"
    assert client.post(path, json={"user_id": male}, headers=h).status_code == 201
    assert client.post(path, json={"user_id": female}, headers=h).status_code == 403


def test_settings_are_selected_not_operator_gender(client, make_user):
    _, token = make_user(role="representative", gender="male")
    _, member = make_user()
    h = auth_header(token)
    male = client.get('/api/v1/settings?gender=male', headers=h).json()
    assert client.put('/api/v1/settings?gender=female', json={"rescue_alpha": 7}, headers=h).status_code == 204
    assert float(client.get('/api/v1/settings?gender=female', headers=h).json()['rescue_alpha']) == 7
    assert client.get('/api/v1/settings', headers=h).json() == male
    assert client.get('/api/v1/settings?gender=other', headers=h).status_code == 400
    assert client.put('/api/v1/settings?gender=female', json={"rescue_alpha": 1}, headers=auth_header(member)).status_code == 403
