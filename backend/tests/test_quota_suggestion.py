"""枠の提案値ロジックのテスト (D-028)

運用実態が「各学年10人ずつ・合計30人」であるため、定員を学年数で等分する。
投票状況では変えない（余った枠は抽選側が他学年へ回すため: D-027）。
"""
from src.services.lottery_service import LotteryService

suggest = LotteryService._suggest_quotas


def test_capacity_30_is_split_evenly() -> None:
    """定員30なら 10 / 10 / 10 になる（運用の既定値）"""
    days = [(30, {3: 7, 2: 11, 1: 33})]
    assert suggest(days, {3: 7, 2: 11, 1: 33}) == [{3: 10, 2: 10, 1: 10}]


def test_suggestion_does_not_depend_on_votes() -> None:
    """投票状況が違っても提案値は変わらない"""
    a = suggest([(30, {3: 0, 2: 0, 1: 50})], {3: 0, 2: 0, 1: 50})
    b = suggest([(30, {3: 20, 2: 20, 1: 0})], {3: 20, 2: 20, 1: 0})
    assert a == b == [{3: 10, 2: 10, 1: 10}]


def test_remainder_goes_to_upper_grades() -> None:
    """割り切れない定員は 3年 → 2年 → 1年 の順に1ずつ多く配る"""
    assert suggest([(20, {})], {}) == [{3: 7, 2: 7, 1: 6}]
    assert suggest([(10, {})], {}) == [{3: 4, 2: 3, 1: 3}]


def test_each_day_is_calculated_independently() -> None:
    """日ごとに定員が違っても、それぞれの定員で等分する"""
    result = suggest([(30, {}), (20, {}), (9, {})], {})
    assert result == [{3: 10, 2: 10, 1: 10}, {3: 7, 2: 7, 1: 6}, {3: 3, 2: 3, 1: 3}]


def test_sum_always_matches_capacity() -> None:
    """保存時に合計＝定員が求められるため、提案値も常に定員ちょうどにする"""
    for capacity in (0, 1, 2, 5, 9, 10, 15, 20, 30, 31):
        result = suggest([(capacity, {})], {})
        assert sum(result[0].values()) == capacity
