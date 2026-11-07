"""D-073: URLを変えず、機能ごとのモジュール・Swaggerタグに分類する。"""
from collections import Counter
from importlib import import_module
import warnings

import pytest
from fastapi.routing import APIRoute
from src.main import create_app


ROUTES = {
    'health': {('GET', '/health')},
    'auth': {('POST', '/auth/line/login'), ('POST', '/auth/line/register')},
    'users': {('GET', '/users/me'), ('GET', '/users'),
        ('PUT', '/users/{user_id}/role'), ('DELETE', '/users/{user_id}')},
    'practice_months': {('POST', '/practice-months/batch'), ('GET', '/practice-months'),
        ('GET', '/practice-months/{pm_id}'), ('PUT', '/practice-months/{pm_id}'),
        ('POST', '/practices/batch'), ('GET', '/practices/suggestions'),
        ('GET', '/practices/{practice_id}/genders'), ('PUT', '/practices/{practice_id}/genders'),
        ('DELETE', '/practices/{practice_id}')},
    'votes': {('GET', '/practice-months/{pm_id}/votes/me'),
        ('PUT', '/practice-months/{pm_id}/votes/me')},
    'lottery': {('GET', '/practice-months/{pm_id}/vote-summary'),
        ('PUT', '/practice-months/{pm_id}/quotas'), ('POST', '/practice-months/{pm_id}/lottery'),
        ('GET', '/practice-months/{pm_id}/executions')},
    'results': {('GET', '/practice-months/{pm_id}/results/me'),
        ('GET', '/practice-months/{pm_id}/participation'), ('GET', '/practice-months/{pm_id}/results'),
        ('PUT', '/practice-months/{pm_id}/assignments'), ('POST', '/practice-months/{pm_id}/publish')},
}


@pytest.mark.parametrize('module', ROUTES)
def test_endpoints_live_in_expected_modules_with_matching_tags(module):
    router = import_module(f'src.api.{module}').router
    routes = [route for route in router.routes if isinstance(route, APIRoute)]
    assert all(route.endpoint.__module__ == f'src.api.{module}' for route in routes)
    assert {(method, route.path.removeprefix('/api/v1'))
        for route in routes for method in route.methods} == ROUTES[module]
    expected_tag = 'practice-months' if module == 'practice_months' else module
    for route in routes:
        assert route.tags == [expected_tag]


def test_router_registration_has_no_missing_or_duplicate_endpoints():
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter('always')
        spec = create_app().openapi()
    assert not any('Duplicate Operation ID' in str(warning.message) for warning in captured)
    actual = Counter((method.upper(), path.removeprefix('/api/v1'))
        for path, operations in spec['paths'].items() for method in operations)
    expected = set().union(*ROUTES.values())
    assert set(actual) == expected
    assert all(count == 1 for count in actual.values())
