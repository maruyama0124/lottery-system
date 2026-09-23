"""lottery_sim と同じ入力で run_lottery を回し、抽選の性質が守られているかを検査する (DB 非接続)"""
import json
from collections import defaultdict
from pathlib import Path

from src.domain.lottery import GRADES, Member, PracticeDay, run_lottery
from src.services.lottery_service import LotteryService

DATA = Path(__file__).resolve().parents[2] / ".simulation" / "data.json"
data = json.loads(DATA.read_text())
SEEDS = [20261017, 1, 2, 3, 4, 5, 6, 7, 8, 9]


def build(gender):
    practices = sorted((p for p in data["practices"] if p["gender"] == gender), key=lambda p: p["practice_date"])
    pids = {p["id"] for p in practices}
    members = [m for m in data["members"] if m["gender"] == gender]
    by_id = {m["id"]: m for m in members}
    votes = defaultdict(set)
    for v in data["votes"]:
        if v["practice_id"] in pids:
            votes[v["user_id"]].add(v["practice_id"])
    restricted = {p["id"]: set(p["allowed_grades"]) for p in practices if p["allowed_grades"]}
    for uid, voted in list(votes.items()):
        u = by_id.get(uid)
        if u and not u["is_manager"]:
            votes[uid] = {pid for pid in voted if pid not in restricted or u["grade"] in restricted[pid]}
    grade_of = {m["id"]: m["grade"] for m in members if not m["is_manager"]}
    vpd = []
    for p in practices:
        c = {g: 0 for g in GRADES}
        for uid, voted in votes.items():
            g = grade_of.get(uid)
            if g and p["id"] in voted:
                c[g] += 1
        vpd.append(c)
    mv = {g: 0 for g in GRADES}
    for uid, voted in votes.items():
        g = grade_of.get(uid)
        if g and voted:
            mv[g] += 1
    sug = LotteryService._suggest_quotas([(p["capacity"], v, set(p["allowed_grades"] or GRADES)) for p, v in zip(practices, vpd)], mv)
    days = [PracticeDay(id=p["id"], capacity=p["capacity"], quotas=dict(q)) for p, q in zip(practices, sug)]
    ms = [Member(id=m["id"], grade=m["grade"], is_manager=m["is_manager"], prev_votes=0, prev_losses=0) for m in members]
    return practices, days, ms, dict(votes), by_id, vpd


for gender in ("female", "male"):
    practices, days, ms, votes, by_id, vpd = build(gender)
    alpha = next(float(s["rescue_alpha"]) for s in data["settings"] if s["gender"] == gender)
    problems = []
    for seed in SEEDS:
        r = run_lottery(practices=days, members=ms, votes=votes, rescue_alpha=alpha, seed=seed)
        assigned = defaultdict(set)   # pid -> uids
        per_user = defaultdict(set)
        for pid, uid, via in r.assignments:
            if uid in assigned[pid]:
                problems.append(f"seed{seed}: 重複割当 {uid} {pid}")
            assigned[pid].add(uid)
            per_user[uid].add(pid)
            if pid not in votes.get(uid, set()):
                problems.append(f"seed{seed}: 投票してない日に当選 {by_id[uid]['name']} {pid}")
            if by_id[uid]["is_manager"] != (via == "manager"):
                problems.append(f"seed{seed}: via 不整合 {by_id[uid]['name']} {via}")
        for d, p, v in zip(days, practices, vpd):
            players = [u for u in assigned[d.id] if not by_id[u]["is_manager"]]
            if len(players) > d.capacity:
                problems.append(f"seed{seed}: 定員超過 {p['practice_date']} {len(players)}>{d.capacity}")
            for g in GRADES:
                n = sum(1 for u in players if by_id[u]["grade"] == g)
                if n > d.quotas[g] and n > v[g]:
                    problems.append(f"seed{seed}: 枠超過 {p['practice_date']} {g}年 {n}>{d.quotas[g]}")
            # 空席があるのに落選者がいる → 再配分漏れ
            losers = [u for u, vs in votes.items() if d.id in vs and u not in assigned[d.id] and not by_id[u]["is_manager"]]
            if len(players) < d.capacity and losers:
                problems.append(f"seed{seed}: 空席{d.capacity-len(players)}あるのに落選{len(losers)}名 {p['practice_date']}")
        for uid, vs in votes.items():
            if vs and not per_user.get(uid):
                problems.append(f"seed{seed}: 最低1回保証違反 {by_id[uid]['name']}")
            if by_id[uid]["is_manager"] and per_user.get(uid) != vs:
                problems.append(f"seed{seed}: マネージャーが全投票日に入っていない {by_id[uid]['name']}")
        # 投票数比例: 同学年で投票数が多い人が少ない人より当選数が少ないケースを数える
        inv = 0
        for g in GRADES:
            rows = [(len(votes[u]), len(per_user.get(u, ()))) for u in votes if by_id[u]["grade"] == g and not by_id[u]["is_manager"] and votes[u]]
            for a in rows:
                for b in rows:
                    if a[0] > b[0] and a[1] < b[1]:
                        inv += 1
        print(f"{gender} seed={seed}: 当選延べ{len(r.assignments)} 警告{len(r.warnings)} 比例逆転ペア{inv}")
    print(f"{gender}: 問題 {len(problems)} 件")
    for p in problems[:20]:
        print("  -", p)
