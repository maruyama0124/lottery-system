"""現行の一括APIでテストデータを準備する。廃止APIは呼ばない。"""
from httpx import Response


def duplicate_practice(db, practice_id):
    """旧データ由来の同日重複を再現。現行登録APIは同日を更新するためDBで準備する。"""
    from src.core.ids import generate_id
    from src.db.models import Practice
    original = db.get(Practice, practice_id)
    duplicate = Practice(**{column.name: getattr(original, column.name)
        for column in Practice.__table__.columns if column.name != 'id'}, id=generate_id('prc'))
    db.add(duplicate)
    db.flush()
    return duplicate


def _detail_response(response, detail):
    # バッチの結果をテスト内で扱いやすい単件の形にする。HTTPステータスは保持。
    return Response(response.status_code, json=detail, request=response.request)


def create_month_response(client, *, json, headers):
    me = client.get('/api/v1/users/me', headers=headers)
    if me.status_code != 200:
        return me
    response = client.post('/api/v1/practice-months/batch',
        json={**json, 'genders': [me.json()['gender']]}, headers=headers)
    return _detail_response(response, response.json()[0]) if response.status_code == 201 else response


def add_practice_response(client, month_id, *, json, headers):
    month = client.get(f'/api/v1/practice-months/{month_id}', headers=headers)
    if month.status_code != 200:
        return month
    data = month.json()
    response = client.post('/api/v1/practices/batch', json={
        'year_month': data['year_month'], 'genders': [data['gender']], 'practice': json,
    }, headers=headers)
    return _detail_response(response, response.json()[0]) if response.status_code == 201 else response


def update_practice_response(client, practice_id, *, json, headers):
    context = client.get(f'/api/v1/practices/{practice_id}/genders', headers=headers)
    if context.status_code != 200:
        return context
    data = context.json()
    return client.put(f'/api/v1/practices/{practice_id}/genders', json={
        'genders': data['genders'], 'practice': json, 'expected_versions': data['versions'],
    }, headers=headers)


def save_participation(client, month_id, practice_id, user_id, participating, *, headers):
    month = client.get(f'/api/v1/practice-months/{month_id}', headers=headers)
    if month.status_code != 200:
        return month
    results = client.get(f'/api/v1/practice-months/{month_id}/results', headers=headers)
    if results.status_code != 200:
        return results
    current = next((p for day in results.json()['by_practice'] for p in day['participants']
        if day['practice']['id'] == practice_id and p['user_id'] == user_id), None)
    return client.put(f'/api/v1/practice-months/{month_id}/assignments', json={
        'expected_month_status': month.json()['status'],
        'expected_published_at': month.json()['published_at'],
        'changes': [{'practice_id': practice_id, 'user_id': user_id, 'participating': participating,
            'expected_assignment_id': current['assignment_id'] if current else None,
            'expected_publish_state': current['publish_state'] if current else None}],
    }, headers=headers)


def remove_assignment_response(client, month_id, assignment_id, *, headers):
    results = client.get(f'/api/v1/practice-months/{month_id}/results', headers=headers)
    assert results.status_code == 200, results.text
    for day in results.json()['by_practice']:
        for participant in day['participants']:
            if participant['assignment_id'] == assignment_id:
                return save_participation(client, month_id, day['practice']['id'],
                    participant['user_id'], False, headers=headers)
    raise AssertionError('削除対象の割当がテストデータに存在しない')
