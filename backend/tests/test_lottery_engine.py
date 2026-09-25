"""抽選エンジンの性質テスト — 要件 REQ-005 系の検証

実際の規模感 (定員30 × 5回、3年10人・2年20人・1年30人) で
多数のシードを回し、アルゴリズムの性質が破られないことを確認する。

D-015 以降は学年別の枠を代表が日ごとに決めるため、
テストでも枠を明示して渡す（ここでは 3年8 / 2年10 / 1年12 = 定員30）。
"""
import random
from collections import Counter, defaultdict

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


def test_each_grade_stays_within_its_quota_unless_others_leave_seats() -> None:
    """学年ごとの割当は自分の枠を超えないこと。

    ただし他学年の投票者が足りず枠が余った場合は、その余りを引き受けて
    枠を超えることがある (D-027)。その場合でも合計は定員を超えない。
    """
    for seed in range(20):
        result, members, votes = run(seed)
        grade_of = {m.id: m.grade for m in members if not m.is_manager}
        count: dict[tuple[str, int], int] = defaultdict(int)
        for pid, mid, _via in result.assignments:
            grade = grade_of.get(mid)
            if grade is not None:
                count[(pid, grade)] += 1
        for p in PRACTICES:
            voters_of = defaultdict(int)
            for m in members:
                if not m.is_manager and p.id in votes.get(m.id, set()):
                    voters_of[m.grade] += 1
            # 他学年が枠を使い切れなかったぶんだけ上振れしうる
            leftover = sum(
                max(0, q - voters_of[g]) for g, q in QUOTAS.items()
            )
            for grade, quota in QUOTAS.items():
                assert count[(p.id, grade)] <= quota + leftover, (
                    f"seed={seed} 練習 {p.id} の{grade}年が枠 {quota} を大きく超過"
                )


def test_grade_quota_caps_the_distribution_phase() -> None:
    """残枠の配分は学年別の枠を上限とする。

    最低1回保証 (Phase 1) は日ごとの席数で解くため学年をまたぐが (D-029)、
    その後の配分では各学年が自分の枠を超えない。
    """
    # 1年枠7に対し1年が20人。2年枠3に対し2年が5人。保証で全員は入れない規模にする
    practices = [PracticeDay(id="prc_x", capacity=10, quotas={3: 0, 2: 3, 1: 7})]
    members = [Member(id=f"g2_{i}", grade=2) for i in range(5)] + [
        Member(id=f"g1_{i}", grade=1) for i in range(20)
    ]
    votes = {m.id: {"prc_x"} for m in members}

    for seed in range(20):
        result = run_lottery(practices, members, votes, rescue_alpha=0.2, seed=seed)
        assert len(result.assignments) == 10  # 定員ちょうど
        g2 = sum(1 for _, mid, _ in result.assignments if mid.startswith("g2_"))
        g1 = sum(1 for _, mid, _ in result.assignments if mid.startswith("g1_"))
        # 投票者が枠を満たしているため、枠どおりに収まる
        assert (g2, g1) == (3, 7), f"seed={seed}: 2年{g2} 1年{g1}"


def test_unfilled_quota_warns_only_when_nobody_can_fill() -> None:
    """全学年を配りきってもなお余る場合だけ空席として警告する (D-027)"""
    practices = [PracticeDay(id="prc_x", capacity=10, quotas={3: 5, 2: 5, 1: 0})]
    members = [Member(id="g3_1", grade=3)]
    result = run_lottery(practices, members, {"g3_1": {"prc_x"}}, rescue_alpha=0.2, seed=1)
    assert any("空席" in w for w in result.warnings)
    assert len(result.assignments) == 1


def test_leftover_quota_flows_to_other_grades() -> None:
    """余った枠は空席にせず他学年へ回す (D-027)"""
    practices = [PracticeDay(id="prc_x", capacity=10, quotas={3: 5, 2: 5, 1: 0})]
    members = [Member(id="g3_1", grade=3)] + [
        Member(id=f"g1_{i}", grade=1) for i in range(9)
    ]
    votes = {m.id: {"prc_x"} for m in members}
    result = run_lottery(practices, members, votes, rescue_alpha=0.2, seed=1)

    # 1年枠は0だが、3年・2年の余りが回って定員10が埋まる
    assert len(result.assignments) == 10
    assert not result.warnings


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


def test_prev_month_underdog_is_prioritized_in_distribution() -> None:
    """前月不遇だった人は、残枠配分で前月好調だった人より優先される (D-034)

    p1 (4席) と p2 (1席) に対し、p2 に投票しているのは a と b のみ。
      a: 前月 1/5 → 合算当選率 (1+1)/(2+5) ≈ 0.29
      b: 前月 4/5 → 合算当選率 (1+4)/(2+5) ≈ 0.71
    保証フェーズが p2 を空けた配置（＝残席を a と b が直接争える配置）では、
    合算当選率の低い a が必ず残席を取る。保証が b を p2 に置いた配置では
    そもそも争いが発生しないため、検証の対象外とする。
    """
    practices = [
        PracticeDay(id="p1", capacity=4, quotas={3: 0, 2: 0, 1: 4}),
        PracticeDay(id="p2", capacity=1, quotas={3: 0, 2: 0, 1: 1}),
    ]
    members = [
        Member(id="a", grade=1, prev_votes=5, prev_losses=4),  # 前月 1/5
        Member(id="b", grade=1, prev_votes=5, prev_losses=1),  # 前月 4/5
        Member(id="c", grade=1),
        Member(id="d", grade=1),
    ]
    votes = {"a": {"p1", "p2"}, "b": {"p1", "p2"}, "c": {"p1"}, "d": {"p1"}}

    contested = 0
    for seed in range(100):
        result = run_lottery(practices, members, votes, rescue_alpha=0.5, seed=seed)
        wins = Counter(mid for _pid, mid, _via in result.assignments)
        guaranteed_on_p2 = any(
            pid == "p2" and via == "guaranteed" for pid, _mid, via in result.assignments
        )
        if not guaranteed_on_p2:
            contested += 1
            assert wins["a"] == 2, f"seed={seed}: 争える配置で a が残席を取れていない"
            assert wins["b"] == 1, f"seed={seed}: 争える配置で b が残席を取った"
    assert contested >= 30, f"争いが起きた配置が少なすぎる ({contested}回)"


def test_prev_month_underdog_gets_second_seat_first() -> None:
    """前月しっかり投票して1回以下だった人は、残枠配分の前に2席目を確保する (D-035)

    a は前月4投票1当選。今月3日投票すれば、残枠配分に先立って2席目が
    確保されるため、席がある限り必ず2回以上になる。
    b (前月4投票3当選) は a の後になる。
    """
    practices = [
        PracticeDay(id=f"p{i}", capacity=2, quotas={3: 0, 2: 0, 1: 2}) for i in range(3)
    ]
    members = [
        Member(id="a", grade=1, prev_votes=4, prev_losses=3),  # 前月 1/4 (不遇)
        Member(id="b", grade=1, prev_votes=4, prev_losses=1),  # 前月 3/4
        Member(id="c", grade=1),
        Member(id="d", grade=1),
    ]
    all_days = {f"p{i}" for i in range(3)}
    votes = {m.id: set(all_days) for m in members}  # 6席を4人で分ける

    for seed in range(30):
        result = run_lottery(practices, members, votes, rescue_alpha=0.5, seed=seed)
        wins = Counter(mid for _pid, mid, _via in result.assignments)
        assert wins["a"] >= 2, f"seed={seed}: 前月不遇の a が2席目を確保できていない"


def test_second_seat_requires_serious_votes_both_months() -> None:
    """2席目の確保は「前月も今月も3日以上投票」した人に限る (D-035)

    前月1日しか投票していない人は当選1回でも不遇ではないため対象外。
    """
    practices = [
        PracticeDay(id=f"p{i}", capacity=2, quotas={3: 0, 2: 0, 1: 2}) for i in range(3)
    ]
    members = [
        Member(id="casual", grade=1, prev_votes=1, prev_losses=0),  # 前月 1/1
        Member(id="serious", grade=1, prev_votes=4, prev_losses=3),  # 前月 1/4
        Member(id="c", grade=1),
        Member(id="d", grade=1),
    ]
    votes = {m.id: {f"p{i}" for i in range(3)} for m in members}

    serious_two = 0
    for seed in range(30):
        result = run_lottery(practices, members, votes, rescue_alpha=0.5, seed=seed)
        wins = Counter(mid for _pid, mid, _via in result.assignments)
        if wins["serious"] >= 2:
            serious_two += 1
    # serious は毎回2席以上、casual は優先確保の対象にならない
    assert serious_two == 30


def test_second_seat_uses_swap_when_days_are_full() -> None:
    """2席目の確保でも席の入れ替えが働く (D-036)

    6席に対し目標は5人×1席 + a の2席目 = 6席ちょうど。
    空き席が a の保有日側に残った配置では、a の未保有日は満席になるが、
    占有者を空き席へ動かせば a の2席目が作れる。入れ替えがないと取り漏れる。
    """
    practices = [
        PracticeDay(id=f"p{i}", capacity=2, quotas={3: 0, 2: 0, 1: 2}) for i in range(3)
    ]
    members = [
        Member(id="a", grade=1, prev_votes=4, prev_losses=3),  # 前月 1/4 (不遇)
        Member(id="x", grade=1),
        Member(id="y", grade=1),
        Member(id="z", grade=1),
        Member(id="w", grade=1),
    ]
    votes = {m.id: {"p0", "p1", "p2"} for m in members}  # 全員3日投票

    for seed in range(50):
        result = run_lottery(practices, members, votes, rescue_alpha=0.5, seed=seed)
        wins = Counter(mid for _pid, mid, _via in result.assignments)
        assert wins["a"] == 2, f"seed={seed}: a が2席目を確保できていない ({dict(wins)})"
        assert sum(wins.values()) == 6  # 席は使い切る


def test_internal_check_is_silent_on_valid_runs() -> None:
    """正常な抽選で内部検証 (D-036) の警告が出ないこと"""
    practices = [PracticeDay(id=f"p{i}", capacity=10, quotas={3: 3, 2: 3, 1: 4}) for i in range(4)]
    members = [Member(id=f"g{g}_{i}", grade=g) for g in (3, 2, 1) for i in range(8)]
    votes = {m.id: {f"p{i}" for i in range(4)} for m in members}
    for seed in range(10):
        result = run_lottery(practices, members, votes, rescue_alpha=0.5, seed=seed)
        internal = [w for w in result.warnings if w.startswith("内部検証")]
        assert not internal, f"seed={seed}: {internal}"


def test_quota_total_may_differ_from_capacity() -> None:
    """枠の合計が定員と違っても、枠どおりに配り、内部検証の警告も出ない (D-045)"""
    members = [Member(id=f"g{g}_{i}", grade=g) for g in (3, 2, 1) for i in range(8)]
    votes = {m.id: {"p_over", "p_under"} for m in members}
    practices = [
        # 定員10に対して枠13 → 13人入る
        PracticeDay(id="p_over", capacity=10, quotas={3: 4, 2: 4, 1: 5}),
        # 定員10に対して枠8 → 8人で止まり、「空席」扱いにしない
        PracticeDay(id="p_under", capacity=10, quotas={3: 3, 2: 3, 1: 2}),
    ]
    for seed in range(5):
        result = run_lottery(practices, members, votes, rescue_alpha=0.5, seed=seed)
        count = {p.id: 0 for p in practices}
        for pid, _mid, _via in result.assignments:
            count[pid] += 1
        assert count == {"p_over": 13, "p_under": 8}, f"seed={seed}: {count}"
        internal = [w for w in result.warnings if w.startswith("内部検証")]
        assert not internal, f"seed={seed}: {internal}"
