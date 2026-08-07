"""α を変えて半年の連鎖を回し、救済の効きを比較する (純粋計算・DB不使用)

実データ相当の構成 (male: 3年12・2年22・1年45、月6練習・定員30) で、
落選記録を翌月へ引き継ぎながら6か月連鎖させる。
"""
import random
from collections import defaultdict

from src.domain.lottery import Member, PracticeDay, run_lottery
from src.services.lottery_service import LotteryService

GRADE_SIZE = {3: 12, 2: 22, 1: 45}
MONTHS, DAYS_PER_MONTH, CAPACITY = 6, 6, 30


def simulate(alpha: float, seed: int):
    rng = random.Random(seed)
    members = [
        Member(id=f"g{g}_{i}", grade=g)
        for g, n in GRADE_SIZE.items()
        for i in range(n)
    ]
    losses: dict[str, int] = {}
    prev_votes: dict[str, int] = {}
    history = []  # 月ごとの {mid: (votes, wins)}
    for month in range(MONTHS):
        pids = [f"m{month}p{i}" for i in range(DAYS_PER_MONTH)]
        votes = {
            m.id: set(rng.sample(pids, rng.randint(1, DAYS_PER_MONTH)))
            for m in members
        }
        days = []
        for pid in pids:
            vc = {g: sum(1 for m in members if m.grade == g and pid in votes[m.id]) for g in (3, 2, 1)}
            days.append((CAPACITY, vc))
        quotas = LotteryService._suggest_quotas(days, {})
        practices = [PracticeDay(id=pid, capacity=CAPACITY, quotas=q) for pid, q in zip(pids, quotas)]
        ms = [
            Member(
                id=m.id, grade=m.grade,
                prev_losses=losses.get(m.id, 0),
                prev_votes=prev_votes.get(m.id, 0),
            )
            for m in members
        ]
        r = run_lottery(practices, ms, votes, alpha, seed=seed * 1000 + month)
        wins = defaultdict(int)
        for _pid, mid, _via in r.assignments:
            wins[mid] += 1
        losses = {m.id: len(votes[m.id]) - wins[m.id] for m in members}
        prev_votes = {m.id: len(votes[m.id]) for m in members}
        history.append({m.id: (len(votes[m.id]), wins[m.id]) for m in members})
    return history


def metrics(history):
    """1年生の (救済差, 月1回以下が2か月連続した延べ人数)"""
    g1 = [f"g1_{i}" for i in range(GRADE_SIZE[1])]
    low_next, high_next = [], []
    consecutive_bad = 0
    for t in range(1, MONTHS):
        for mid in g1:
            pv, pw = history[t - 1][mid]
            cv, cw = history[t][mid]
            (low_next if pw * 2 < pv else high_next).append(cw / cv)
            # 「3日以上投票したのに当選1回以下」が2か月続いた人だけを数える。
            # 投票が1〜2日の人は当選1回以下が当たり前で、不遇とは言えないため
            if pv >= 3 and pw <= 1 and cv >= 3 and cw <= 1:
                consecutive_bad += 1
    lo = sum(low_next) / len(low_next)
    hi = sum(high_next) / len(high_next)
    return lo, hi, consecutive_bad


for alpha in (0.5, 1.0, 2.0, 3.0):
    los, his, bads = [], [], []
    for seed in range(10):
        lo, hi, bad = metrics(simulate(alpha, seed))
        los.append(lo); his.append(hi); bads.append(bad)
    lo, hi, bad = sum(los) / 10, sum(his) / 10, sum(bads) / 10
    print(f"α={alpha}: 前月不遇→翌月 {lo:.3f} / 前月好調→翌月 {hi:.3f} "
          f"(差 {lo-hi:+.3f})  月1回以下が2か月連続: {bad:.1f}人/月平均")
