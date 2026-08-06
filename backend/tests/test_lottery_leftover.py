"""学年をまたいだ余り枠の再配分 (D-027) のテスト"""
from collections import Counter

from src.domain.lottery import Member, PracticeDay, run_lottery


def day(pid: str, *, g1: int = 0, g2: int = 0, g3: int = 0) -> PracticeDay:
    return PracticeDay(id=pid, capacity=g1 + g2 + g3, quotas={1: g1, 2: g2, 3: g3})


def winners(result, practice_id: str) -> set[str]:
    return {mid for pid, mid, _ in result.assignments if pid == practice_id}


def test_leftover_quota_is_filled_by_other_grades() -> None:
    """3年の投票者が枠に満たないとき、余りは1・2年で埋まる"""
    practices = [day("p1", g1=3, g2=3, g3=4)]  # 定員10
    members = [
        Member(id="s3", grade=3),  # 3年は1人しか投票しない → 3枠余る
        *[Member(id=f"s2_{i}", grade=2) for i in range(5)],
        *[Member(id=f"s1_{i}", grade=1) for i in range(4)],
    ]  # 投票者はちょうど10人。全員が入れるはず
    votes = {m.id: {"p1"} for m in members}

    result = run_lottery(practices, members, votes, 0.2, seed=1)

    # 定員10がすべて埋まる (以前は3年枠の3席が空席のまま残っていた)
    assert len(winners(result, "p1")) == 10
    assert not result.warnings


def test_leftover_is_shared_between_grades() -> None:
    """余り枠は特定の学年に偏らず、学年を順に回して配られる"""
    practices = [day("p1", g1=1, g2=1, g3=6)]  # 3年枠6に対し3年は投票者なし
    members = [
        *[Member(id=f"s2_{i}", grade=2) for i in range(4)],
        *[Member(id=f"s1_{i}", grade=1) for i in range(4)],
    ]
    votes = {m.id: {"p1"} for m in members}

    result = run_lottery(practices, members, votes, 0.2, seed=1)

    won = winners(result, "p1")
    assert len(won) == 8  # 定員8にちょうど収まる
    by_grade = Counter(mid.split("_")[0] for mid in won)
    assert by_grade["s1"] == 4 and by_grade["s2"] == 4


def test_leftover_is_used_by_both_grades_when_capacity_is_short() -> None:
    """余りが全員に行き渡らない場合も、両学年が余り枠を使える

    どちらか一方に偏らせないことを確認する。保証フェーズは全員に1回配ることを
    優先するため厳密な同数にはならないが、片方が締め出されることはない。
    """
    practices = [day("p1", g1=1, g2=1, g3=4)]  # 3年枠4が丸ごと余る
    members = [
        *[Member(id=f"s2_{i}", grade=2) for i in range(5)],
        *[Member(id=f"s1_{i}", grade=1) for i in range(5)],
    ]
    votes = {m.id: {"p1"} for m in members}

    for seed in range(20):
        result = run_lottery(practices, members, votes, 0.2, seed=seed)
        won = winners(result, "p1")
        assert len(won) == 6  # 定員6が埋まる
        by_grade = Counter(mid.split("_")[0] for mid in won)
        # 自学年の枠 (各1) は必ず確保され、残り4を両学年で分け合う
        assert by_grade["s1"] >= 1 and by_grade["s2"] >= 1, f"seed={seed}: {by_grade}"


def test_warns_only_when_nobody_can_fill() -> None:
    """全学年を配りきってもなお余る場合だけ警告する"""
    practices = [day("p1", g1=5, g2=5, g3=5)]  # 定員15
    members = [Member(id="s1_0", grade=1), Member(id="s2_0", grade=2)]
    votes = {m.id: {"p1"} for m in members}

    result = run_lottery(practices, members, votes, 0.2, seed=1)

    assert len(winners(result, "p1")) == 2
    assert any("空席" in w for w in result.warnings)


def test_no_double_assignment_from_leftover() -> None:
    """余り枠の配分で、同じ人を同じ日に二重に入れない"""
    practices = [day("p1", g1=2, g2=2, g3=6)]
    members = [Member(id=f"s1_{i}", grade=1) for i in range(3)]
    votes = {m.id: {"p1"} for m in members}

    result = run_lottery(practices, members, votes, 0.2, seed=1)

    assigned = [mid for pid, mid, _ in result.assignments if pid == "p1"]
    assert len(assigned) == len(set(assigned)) == 3


def test_guarantee_holds_when_a_grade_has_more_voters_than_its_seats() -> None:
    """自学年の枠の総数を投票者数が上回っても、他学年の余りで全員に1回配る (D-029)

    実データで起きた状況の再現。1年は58名の投票者に対し1年枠の総数が50席
    しかなく、学年ごとに区切って保証すると8名が構造的に0回になっていた。
    """
    practices = [day(f"p{i}", g1=10, g2=10, g3=10) for i in range(5)]  # 各学年50席
    members = [
        *[Member(id=f"s3_{i}", grade=3) for i in range(8)],
        *[Member(id=f"s2_{i}", grade=2) for i in range(19)],
        *[Member(id=f"s1_{i}", grade=1) for i in range(58)],
    ]
    # 全員が全日に投票する（最も枠を奪い合う状況）
    votes = {m.id: {p.id for p in practices} for m in members}

    for seed in range(20):
        result = run_lottery(practices, members, votes, 0.2, seed=seed)
        wins = Counter(mid for _pid, mid, _via in result.assignments)
        zero = [m.id for m in members if wins[m.id] == 0]
        assert not zero, f"seed={seed} で0回の人がいる: {zero}"


def test_no_zero_when_voters_are_spread_unevenly() -> None:
    """投票日が偏っていても、席が足りていれば0回を出さない"""
    practices = [day(f"p{i}", g1=4, g2=4, g3=4) for i in range(3)]  # 定員12×3日
    members = [
        *[Member(id=f"s1_{i}", grade=1) for i in range(10)],
        *[Member(id=f"s2_{i}", grade=2) for i in range(3)],
    ]
    # 1年の大半が p0 に集中し、少数だけが他の日にも投票する
    votes = {}
    for i in range(10):
        votes[f"s1_{i}"] = {"p0"} if i < 6 else {"p0", "p1", "p2"}
    for i in range(3):
        votes[f"s2_{i}"] = {"p1", "p2"}

    for seed in range(20):
        result = run_lottery(practices, members, votes, 0.2, seed=seed)
        wins = Counter(mid for _pid, mid, _via in result.assignments)
        assert all(wins[m.id] > 0 for m in members), f"seed={seed} で0回の人がいる"


def test_capacity_is_filled_when_enough_voters_exist() -> None:
    """投票者が足りている日は定員がすべて埋まる（空席を作らない）"""
    practices = [day(f"p{i}", g1=10, g2=10, g3=10) for i in range(5)]
    members = [
        *[Member(id=f"s3_{i}", grade=3) for i in range(8)],
        *[Member(id=f"s2_{i}", grade=2) for i in range(19)],
        *[Member(id=f"s1_{i}", grade=1) for i in range(58)],
    ]
    votes = {m.id: {p.id for p in practices} for m in members}

    for seed in range(10):
        result = run_lottery(practices, members, votes, 0.2, seed=seed)
        per_day = Counter(pid for pid, _mid, _via in result.assignments)
        for p in practices:
            assert per_day[p.id] == p.capacity, f"seed={seed} {p.id} が定員未満"
