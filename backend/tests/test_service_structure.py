"""D-074: Serviceの責務分割とRepository境界を維持する。"""
import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.core.errors import ForbiddenError, NotFoundError
from src.schemas import lottery, practices, results, votes
from src.services.lottery_service import LotteryService
from src.services.practice_service import PracticeService
from src.services.result_command_service import ResultCommandService
from src.services.result_query_service import ResultQueryService
from src.services.user_service import UserService


@pytest.mark.parametrize("service, expected", [
    (LotteryService, {"vote_summary", "base_shares", "update_quotas", "execute", "list_executions"}),
    (ResultQueryService, {"my_results", "participation_table", "full_results"}),
    (ResultCommandService, {"save_assignments", "publish"}),
])
def test_services_have_separate_public_responsibilities(service, expected):
    methods = {name for name, value in vars(service).items()
               if callable(value) and not name.startswith("_")}
    assert methods == expected


@pytest.mark.parametrize("schema", [
    results.MyResults, results.FullResults, results.ParticipationTable,
    results.AssignmentBatchRequest, votes.VoteStatus, votes.VoteUpdateRequest,
])
def test_result_and_vote_schemas_are_owned_by_their_feature(schema):
    expected = votes if schema.__name__.startswith("Vote") else results
    assert schema.__module__ == expected.__name__
    assert not hasattr(lottery, schema.__name__)
    assert not hasattr(practices, schema.__name__)


def test_services_leave_sql_and_session_io_to_repositories():
    services_dir = Path(__file__).resolve().parents[1] / "src" / "services"
    for path in services_dir.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "sqlalchemy":
                pytest.fail(f"{path.name}: SQL construction belongs in repositories")
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            if ast.unparse(node.func.value) == "self.db":
                # 既存のsavepointとcommit責任は今回の変更対象外。
                assert node.func.attr == "begin_nested", (path.name, node.lineno)


def test_shared_month_lock_checks_role_before_db_access():
    service = PracticeService(Mock())
    service.months = Mock()
    with pytest.raises(ForbiddenError):
        service.lock_month_for_rep(SimpleNamespace(role="member"), "month")
    service.months.get_for_update.assert_not_called()


def test_shared_month_lock_returns_locked_month_or_not_found():
    service = PracticeService(Mock())
    service.months = Mock()
    rep = SimpleNamespace(role="representative")
    month = SimpleNamespace(id="month")
    service.months.get_for_update.return_value = month
    assert service.lock_month_for_rep(rep, "month") is month
    service.months.get_for_update.assert_called_once_with("month")
    service.months.get_for_update.return_value = None
    with pytest.raises(NotFoundError):
        service.lock_month_for_rep(rep, "missing")


def test_roster_forwards_all_filters_and_pagination_to_repository():
    service = UserService(Mock())
    service.users = Mock()
    service.users.roster.return_value = ([], 0)
    params = dict(grade=2, is_manager=False, gender="female", q="test", page=3, per_page=10)
    assert service.roster(**params) == ([], 0)
    service.users.roster.assert_called_once_with(**params)
