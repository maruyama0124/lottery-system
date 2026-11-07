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


@pytest.mark.parametrize('configured_alpha', [None, '1.7'])
def test_draw_keeps_database_coefficient_without_settings_api(client, make_user, db_session, configured_alpha):
    from decimal import Decimal
    from src.db.models import LotteryExecution
    from src.repositories.lottery_repository import LotteryRepository

    _, pm, _ = setup_month_with_votes(client, make_user)
    repo = LotteryRepository(db_session)
    if configured_alpha is not None:
        repo.get_or_create_settings('male').rescue_alpha = Decimal(configured_alpha)
        db_session.flush()
    female_settings = repo.get_or_create_settings('female')
    female_settings.rescue_alpha = Decimal('9')
    db_session.flush()
    _, operator = make_user(role='representative', gender='female')
    response = client.post(f"/api/v1/practice-months/{pm['id']}/lottery", json={'seed':42}, headers=auth_header(operator))
    assert response.status_code == 201, response.text
    expected = float(configured_alpha) if configured_alpha is not None else 0.5
    execution = db_session.get(LotteryExecution, response.json()['id'])
    assert execution.settings_snapshot['rescue_alpha'] == expected
    assert float(repo.get_settings('male').rescue_alpha) == expected
    assert female_settings.rescue_alpha == Decimal('9')
