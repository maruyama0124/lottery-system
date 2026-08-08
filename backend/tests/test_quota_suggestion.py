"""枠の提案値ロジックのテスト (D-031)

基準は定員の等分（定員30なら各学年10）。投票が基準に満たない学年の余りを、
投票に余力のある学年へ 3年 → 2年 → 1年 の順に回す。日ごとに完結し、
月をまたぐ按分はしない。
"""
from src.services.lottery_service import LotteryService

suggest = LotteryService._suggest_quotas

ALL = {1, 2, 3}


def test_full_votes_give_even_split() -> None:
    """全学年の投票が基準以上なら 10 / 10 / 10 になる"""
    days = [(30, {3: 12, 2: 15, 1: 33}, ALL)]
    assert suggest(days, {}) == [{3: 10, 2: 10, 1: 10}]


def test_shortage_of_grade3_flows_to_juniors() -> None:
    """3年の投票が基準に満たない日は、余りが下級生へ回る"""
    # 実データ相当: 3年5人しか投票していない → 3年5、余り5は2年(余力なし)を飛ばして1年へ
    days = [(30, {3: 5, 2: 10, 1: 26}, ALL)]
    assert suggest(days, {}) == [{3: 5, 2: 10, 1: 15}]


def test_leftover_goes_to_grade2_before_grade1() -> None:
    """余りは 2年 → 1年 の順（上級生優先）。2年に余力があれば先に取る"""
    days = [(30, {3: 6, 2: 15, 1: 29}, ALL)]
    # 3年6で4席余り、2年は投票15で余力5 → 2年+4 で 6/14/10
    assert suggest(days, {}) == [{3: 6, 2: 14, 1: 10}]


def test_votes_never_exceeded() -> None:
    """どの学年の枠も、その日の投票者数を超えない（全体が定員未満の日を除く）"""
    days = [(30, {3: 2, 2: 4, 1: 40}, ALL)]
    result = suggest(days, {})[0]
    assert result[3] == 2 and result[2] == 4 and result[1] == 24


def test_empty_seats_are_parked_on_grade1() -> None:
    """全学年の投票者が定員未満の日は、埋まらない席を1年に載せて合計＝定員を保つ"""
    days = [(30, {3: 2, 2: 3, 1: 5}, ALL)]
    result = suggest(days, {})[0]
    assert result == {3: 2, 2: 3, 1: 25}  # 実際に埋まるのは10人。残りは抽選側で処理
    assert sum(result.values()) == 30


def test_each_day_is_independent() -> None:
    """月をまたぐ按分はせず、日ごとに同じ規則で計算する"""
    days = [(30, {3: 5, 2: 10, 1: 26}, ALL), (30, {3: 12, 2: 15, 1: 33}, ALL)]
    assert suggest(days, {}) == [{3: 5, 2: 10, 1: 15}, {3: 10, 2: 10, 1: 10}]


def test_sum_always_matches_capacity() -> None:
    """保存時に合計＝定員が求められるため、提案値も常に定員ちょうどにする"""
    for capacity, voters in [
        (30, {3: 0, 2: 0, 1: 0}),
        (20, {3: 1, 2: 0, 1: 2}),
        (9, {3: 9, 2: 9, 1: 9}),
        (31, {3: 4, 2: 30, 1: 2}),
    ]:
        result = suggest([(capacity, voters, ALL)], {})
        assert sum(result[0].values()) == capacity


def test_restricted_day_splits_only_among_allowed() -> None:
    """学年限定の日 (D-037) は、参加できる学年の中だけで配分する"""
    # 1年限定: 定員も余りもすべて1年へ
    days = [(30, {3: 0, 2: 0, 1: 25}, {1})]
    assert suggest(days, {}) == [{3: 0, 2: 0, 1: 30}]
    # 1・2年限定: 等分は15/15、3年は常に0
    days = [(30, {3: 0, 2: 20, 1: 10}, {1, 2})]
    result = suggest(days, {})[0]
    assert result[3] == 0
    assert sum(result.values()) == 30
    assert result[2] == 20  # 2年は投票20で余力あり → 基準15+5
