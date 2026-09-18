"""ランダムな条件を大量に生成し、最低1回保証と定員充足が破れないか検証する

実行:
    docker compose -f backend/docker-compose.yaml run --rm --no-deps api \
        python -m scripts.sim.fuzz
"""
import random
from collections import Counter, defaultdict
from src.domain.lottery import Member, PracticeDay, run_lottery

def seats_enough(practices, members, votes):
    """全員に1回配れるだけの席があるか（最大マッチングで厳密に判定）"""
    cap = {p.id: sum(p.quotas.values()) for p in practices}
    match = defaultdict(list); placed = {}
    def go(mid, seen):
        for pid in sorted(votes[mid]):
            if pid in seen: continue
            seen.add(pid)
            if len(match[pid]) < cap[pid]:
                match[pid].append(mid); placed[mid] = pid; return True
            for other in list(match[pid]):
                if go(other, seen):
                    match[pid].remove(other); match[pid].append(mid); placed[mid] = pid; return True
        return False
    players = [m for m in members if not m.is_manager]
    for m in players:
        go(m.id, set())
    return len(placed), len(players)

rng = random.Random(20260806)
fail_zero = fail_cap = fail_dup = fail_check = 0
cases = 0
for case in range(400):
    n_days = rng.randint(1, 8)
    practices = []
    for i in range(n_days):
        q = {g: rng.randint(0, 12) for g in (3, 2, 1)}
        if sum(q.values()) == 0:
            q[1] = 1
        practices.append(PracticeDay(id=f"p{i}", capacity=sum(q.values()), quotas=q))
    members = []
    for g in (3, 2, 1):
        for i in range(rng.randint(0, 25)):
            pv = rng.randint(0, 6)
            members.append(Member(id=f"s{g}_{i}", grade=g,
                                  is_manager=rng.random() < 0.05,
                                  prev_votes=pv,
                                  prev_losses=rng.randint(0, pv) if pv else 0))
    if not members:
        continue
    votes = {}
    for m in members:
        k = rng.randint(1, n_days)
        votes[m.id] = set(rng.sample([p.id for p in practices], k))
    cases += 1

    r = run_lottery(practices, members, votes, 0.2, seed=rng.randrange(10**6))
    mgr = {m.id for m in members if m.is_manager}
    wins = Counter(mid for _p, mid, _v in r.assignments if mid not in mgr)
    players = [m for m in members if not m.is_manager]

    # 1. 席が足りているのに0回の人がいないか
    placeable, total = seats_enough(practices, members, votes)
    zero = [m.id for m in players if wins[m.id] == 0]
    if len(zero) > total - placeable:
        fail_zero += 1
        print(f"[0回] case={case}: 配置可能{placeable}/{total} なのに0回が{len(zero)}名")

    # 2. 定員超過がないか
    per_day = Counter(pid for pid, mid, _v in r.assignments if mid not in mgr)
    for p in practices:
        if per_day[p.id] > p.capacity:
            fail_cap += 1
            print(f"[定員超過] case={case}: {p.id} {per_day[p.id]}/{p.capacity}")
            break

    # 3.5 エンジン自身の内部検証 (D-036) が発火していないか
    if any(w.startswith("内部検証") for w in r.warnings):
        fail_check += 1
        print(f"[内部検証] case={case}: {[w for w in r.warnings if w.startswith('内部検証')][:2]}")

    # 3. 同じ人を同じ日に二重に入れていないか
    pairs = [(pid, mid) for pid, mid, _v in r.assignments]
    if len(pairs) != len(set(pairs)):
        fail_dup += 1
        print(f"[二重割当] case={case}")

print(f"\n{cases}ケース検証: 0回の欠陥 {fail_zero} / 定員超過 {fail_cap} / 二重割当 {fail_dup} / 内部検証警告 {fail_check}")
