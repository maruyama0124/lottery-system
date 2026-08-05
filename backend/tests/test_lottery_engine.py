"""抽選エンジンの性質テスト — 要件 REQ-005 系の検証

実際の規模感 (定員30 × 5回、3年10人・2年20人・1年30人) で
多数のシードを回し、アルゴリズムの性質が破られないことを確認する。

D-015 以降は学年別の枠を代表が日ごとに決めるため、
テストでも枠を明示して渡す（ここでは 3年8 / 2年10 / 1年12 = 定員30）。
"""
import random
from collections import defaultdict

from src.domain.lottery import (
    VIA_MANAGER,
    LotteryResult,
    Member,
    PracticeDay,
    run_lottery,
)

QUOTAS = {3: 8, 2: 10, 1: 12}
PRACTICES = [PracticeDay(id=f"prc_{i}", capacity=30, quotas=QUOTAS) for i in range(5)]


def realistic_scenario(seed: int):
    """現実的な規模のシナリオを生成 (シード決定的)"""
    rng = random.Random(seed)
    members: list[Member] = []
    votes: dict[str, set[str]] = {}
    idx = 0

    def add(grade: int, count: int, is_manager: bool = False) -> None:
        nonlocal idx
        for _ in range(count):
            m = Member(
                id=f"usr_{idx:03d}",
                grade=grade,
                is_manager=is_manager,
                prev_losses=rng.randint(0, 3),
            )
            members.append(m)
            n_votes = rng.randint(1, 5)
            votes[m.id] = {p.id for p in rng.sample(PRACTICES, n_votes)}
            idx += 1

    add(3, 10)
    add(2, 20)
    add(1, 30)
    add(2, 2, is_manager=True)
    return members, votes


def run(seed: int) -> tuple[LotteryResult, list[Member], dict[str, set[str]]]:
    members, votes = realistic_scenario(seed)
    result = run_lottery(PRACTICES, members, votes, rescue_alpha=0.2, seed=seed)
    return result, members, votes


def test_deterministic_with_same_seed() -> None:
    """同一シードで結果が再現できること (REQ-005.11)"""
    r1, _, _ = run(42)
    r2, _, _ = run(42)
    assert r1.assignments == r2.assignments
    assert r1.warnings == r2.warnings


def test_managers_attend_all_voted_days_outside_capacity() -> None:
    """マネージャーは投票日すべてに定員外で参加 (REQ-005.2)"""
    for seed in range(20):
        result, members, votes = run(seed)
        managers = {m.id for m in members if m.is_manager}
        manager_assigned = defaultdict(set)
        for pid, mid, via in result.assignments:
            if mid in managers:
                assert via == VIA_MANAGER
                manager_assigned[mid].add(pid)
        for mid in managers:
            assert manager_assigned[mid] == votes[mid]


def test_each_grade_stays_within_its_quota() -> None:
    """学年ごとの割当がその日の学年別枠を超えないこと (D-015)"""
    for seed in range(20):
        result, members, _votes = run(seed)
        grade_of = {m.id: m.grade for m in members if not m.is_manager}
        count: dict[tuple[str, int], int] = defaultdict(int)
        for pid, mid, _via in result.assignments:
            grade = grade_of.get(mid)
            if grade is not None:
                count[(pid, grade)] += 1
        for p in PRACTICES:
            for grade, quota in QUOTAS.items():
                assert count[(p.id, grade)] <= quota, (
                    f"seed={seed} 練習 {p.id} の{grade}年が枠 {quota} を超過"
                )


def test_grades_are_independent() -> None:
    """ある学年の投票者が増えても他学年の当選数に影響しないこと (D-015)"""
    base_members = [Member(id=f"g2_{i}", grade=2) for i in range(5)]
    votes = {m.id: {"prc_x"} for m in base_members}
    practices = [PracticeDay(id="prc_x", capacity=10, quotas={3: 0, 2: 3, 1: 7})]

    before = run_lottery(practices, base_members, votes, rescue_alpha=0.2, seed=1)
    g2_wins_before = sum(1 for _, mid, _ in before.assignments if mid.startswith("g2_"))

    # 1年生を大量に追加しても2年枠は変わらない
    more = base_members + [Member(id=f"g1_{i}", grade=1) for i in range(20)]
    votes_more = {m.id: {"prc_x"} for m in more}
    after = run_lottery(practices, more, votes_more, rescue_alpha=0.2, seed=1)
    g2_wins_after = sum(1 for _, mid, _ in after.assignments if mid.startswith("g2_"))

    assert g2_wins_before == g2_wins_after == 3


def test_unfilled_quota_warns() -> None:
    """投票者が枠に満たない場合は空席のまま警告する (D-015)"""
    practices = [PracticeDay(id="prc_x", capacity=10, quotas={3: 5, 2: 5, 1: 0})]
    members = [Member(id="g3_1", grade=3)]
    result = run_lottery(practices, members, {"g3_1": {"prc_x"}}, rescue_alpha=0.2, seed=1)
    assert any("3年" in w and "空席" in w for w in result.warnings)
    # 学年をまたいだ流し込みは行わない → 2年枠は空いたまま
    assert len(result.assignments) == 1


def test_capacity_never_exceeded_by_players() -> None:
    """プレイヤー (非マネージャー) の割当が定員を超えないこと"""
    for seed in range(20):
        result, members, votes = run(seed)
        managers = {m.id for m in members if m.is_manager}
        count = defaultdict(int)
        for pid, mid, _via in result.assignments:
            if mid not in managers:
                count[pid] += 1
        for p in PRACTICES:
            assert count[p.id] <= p.capacity, f"seed={seed} 練習 {p.id} が定員超過"


def test_no_duplicate_assignment() -> None:
    """同一メンバーが同一練習日に二重割当されないこと"""
    for seed in range(20):
        result, _, _ = run(seed)
        pairs = [(pid, mid) for pid, mid, _ in result.assignments]
        assert len(pairs) == len(set(pairs))


def test_guarantee_invariant() -> None:
    """最低1回保証 (REQ-005.6): 当選0のメンバーがいるなら、
    その人の投票日はすべて満員でなければならない (＝救済不能だった場合のみ0回を許容)"""
    for seed in range(50):
        result, members, votes = run(seed)
        grade_of = {m.id: m.grade for m in members if not m.is_manager}
        wins = defaultdict(int)
        # D-015 以降、空きの判定は「その人の学年の枠」で見る
        count: dict[tuple[str, int], int] = defaultdict(int)
        for pid, mid, _via in result.assignments:
            grade = grade_of.get(mid)
            if grade is not None:
                wins[mid] += 1
                count[(pid, grade)] += 1
        for m in members:
            if m.is_manager or not votes[m.id]:
                continue
            if wins[m.id] == 0:
                for pid in votes[m.id]:
                    assert count[(pid, m.grade)] >= QUOTAS[m.grade], (
                        f"seed={seed}: {m.id} が0回なのに {pid} の{m.grade}年枠に空きがある"
                    )


def test_guarantee_uses_seat_swapping() -> None:
    """枠がぴったり足りるなら、割当順に関わらず全員が保証される

    先着順で埋めるだけだと、選択肢の少ない人が後回しになったときに
    投票日が満員になり「枠は余っていないのに0回」が発生していた（実データで再現）。
    席の入れ替えを行うことで、配れるはずの枠を配り切れることを確認する。
    """
    # 3人・2枠+1枠。usr_a は prc_x にしか投票していない
    practices = [
        PracticeDay(id="prc_x", capacity=1, quotas={3: 0, 2: 0, 1: 1}),
        PracticeDay(id="prc_y", capacity=2, quotas={3: 0, 2: 0, 1: 2}),
    ]
    members = [Member(id=f"usr_{c}", grade=1) for c in "abc"]
    votes = {
        "usr_a": {"prc_x"},  # 選択肢1つだけ
        "usr_b": {"prc_x", "prc_y"},
        "usr_c": {"prc_x", "prc_y"},
    }
    for seed in range(30):
        result = run_lottery(practices, members, votes, rescue_alpha=0.2, seed=seed)
        wins = defaultdict(int)
        for _pid, mid, _via in result.assignments:
            wins[mid] += 1
        assert all(wins[m.id] >= 1 for m in members), f"seed={seed} で0回の人が出た"


def test_grade3_is_no_longer_guaranteed() -> None:
    """3年生も枠を超えれば落選する (D-015 で全通しを廃止)"""
    practices = [PracticeDay(id="prc_x", capacity=5, quotas={3: 5, 2: 0, 1: 0})]
    members = [Member(id=f"usr_{i}", grade=3) for i in range(8)]
    votes = {m.id: {"prc_x"} for m in members}
    result = run_lottery(practices, members, votes, rescue_alpha=0.2, seed=1)
    assert len(result.assignments) == 5  # 8人中5人だけ当選
    assert all(via != "grade3" for _, _, via in result.assignments)


def test_more_votes_more_wins_on_average() -> None:
    """投票数比例 (REQ-005.7): 多く投票した人ほど平均当選数が多い (統計的性質)"""
    total_by_votes: dict[int, list[int]] = defaultdict(list)
    for seed in range(50):
        result, members, votes = run(seed)
        managers = {m.id for m in members if m.is_manager}
        wins = defaultdict(int)
        for _pid, mid, _via in result.assignments:
            wins[mid] += 1
        for m in members:
            if m.is_manager:
                continue
            total_by_votes[len(votes[m.id])].append(wins[m.id])
    avg = {k: sum(v) / len(v) for k, v in total_by_votes.items()}
    assert avg[5] > avg[1], f"5日投票の平均当選 {avg[5]:.2f} <= 1日投票 {avg[1]:.2f}"


def test_rescue_weight_increases_win_rate() -> None:
    """落選救済 (REQ-005.9): 前月落選数が多い人は、1枠を争う抽選で当選しやすい (統計的性質)"""
    small = [PracticeDay(id="prc_x", capacity=1, quotas={3: 0, 2: 0, 1: 1})]
    lucky_wins = 0
    trials = 600
    for seed in range(trials):
        members = [
            Member(id="usr_rescued", grade=1, prev_losses=5),  # w = 1 + 0.2*5 = 2.0
            Member(id="usr_normal", grade=1, prev_losses=0),  # w = 1.0
        ]
        votes = {m.id: {"prc_x"} for m in members}
        result = run_lottery(small, members, votes, rescue_alpha=0.2, seed=seed)
        winners = {mid for _, mid, _ in result.assignments}
        if "usr_rescued" in winners:
            lucky_wins += 1
    # 期待当選率 2/3。統計ゆらぎを見込み 55% 以上なら救済が効いているとみなす
    assert lucky_wins / trials > 0.55, f"救済対象の当選率 {lucky_wins / trials:.2%}"


def test_losses_recorded_for_next_month() -> None:
    """落選記録 (votes - wins) が次月の入力として返ること"""
    result, members, votes = run(7)
    wins = defaultdict(int)
    for _pid, mid, _via in result.assignments:
        wins[mid] += 1
    for m in members:
        if m.is_manager:
            assert m.id not in result.losses
        elif votes[m.id]:
            assert result.losses[m.id] == len(votes[m.id]) - wins[m.id]
            assert result.losses[m.id] >= 0
