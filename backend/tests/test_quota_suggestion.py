"""枠の提案値ロジックのテスト (D-015)

「3年はなるべく全員、2年もそれに準じて、1年が回らなくなるなら上級生を削る」を
投票状況から自動で導けているかを検証する。
"""
from src.services.lottery_service import LotteryService

suggest = LotteryService._suggest_quotas


def totals(result: list[dict[int, int]]) -> dict[int, int]:
    return {g: sum(day[g] for day in result) for g in (3, 2, 1)}


def test_upper_grades_fill_completely_when_capacity_is_enough() -> None:
    """総枠に余裕がある月は3年が全日で全員入る（実データ相当のシナリオ）"""
    days = [
        (20, {3: 6, 2: 8, 1: 24}),
        (20, {3: 6, 2: 12, 1: 26}),
        (20, {3: 6, 2: 12, 1: 33}),
        (20, {3: 5, 2: 10, 1: 24}),
        (20, {3: 5, 2: 9, 1: 27}),
        (20, {3: 6, 2: 13, 1: 31}),
    ]
    month_voters = {3: 11, 2: 22, 1: 45}

    result = suggest(days, month_voters)

    # 各日とも定員ちょうど
    for quotas, (capacity, _voters) in zip(result, days):
        assert sum(quotas.values()) == capacity
    # 3年はその日の投票者全員が入る
    for quotas, (_capacity, voters) in zip(result, days):
        assert quotas[3] == voters[3]
    # 1年は投票者数ぶんの枠が月全体で確保される（全員が月1回当選できる）
    assert totals(result)[1] >= month_voters[1]


def test_first_year_minimum_is_protected_when_seats_suffice() -> None:
    """総枠が投票者数を上回る限り、上級生が多くても1年の枠は確保される"""
    days = [(20, {3: 15, 2: 15, 1: 6}) for _ in range(2)]  # 総枠40 > 投票者36
    month_voters = {3: 15, 2: 15, 1: 6}

    result = suggest(days, month_voters)

    assert totals(result)[1] >= month_voters[1]
    for quotas, (capacity, _voters) in zip(result, days):
        assert sum(quotas.values()) == capacity


def test_upper_grades_are_trimmed_when_capacity_is_short() -> None:
    """総枠が全学年の投票者数に満たない場合は、優先度の低い学年から確保できなくなる"""
    days = [(10, {3: 8, 2: 8, 1: 8})]  # 総枠10 < 投票者24
    month_voters = {3: 8, 2: 8, 1: 8}

    result = suggest(days, month_voters)

    assert sum(result[0].values()) == 10
    # 3年 → 2年 の順に確保され、1年は枠を得られない
    assert result[0][3] == 8
    assert result[0][2] == 2
    assert result[0][1] == 0


def test_no_quota_for_grades_without_voters() -> None:
    """投票者がいない学年には枠を割り当てない"""
    days = [(10, {3: 0, 2: 2, 1: 3})]
    result = suggest(days, {3: 0, 2: 2, 1: 3})

    assert result[0][3] == 0
    assert result[0][2] <= 2
    # 合計は定員ちょうど。投票者より多い枠は埋まらず、抽選時に空席として警告される
    assert sum(result[0].values()) == 10


def test_sum_always_matches_capacity() -> None:
    """保存時に合計＝定員が求められるため、提案値も常に定員ちょうどにする"""
    for days, voters in [
        ([(20, {3: 0, 2: 0, 1: 0})], {3: 0, 2: 0, 1: 0}),  # 投票なし
        ([(15, {3: 1, 2: 0, 1: 2})], {3: 1, 2: 0, 1: 2}),  # 投票者 < 定員
        ([(5, {3: 9, 2: 9, 1: 9})], {3: 9, 2: 9, 1: 9}),  # 投票者 > 定員
    ]:
        result = suggest(days, voters)
        assert sum(result[0].values()) == days[0][0]
