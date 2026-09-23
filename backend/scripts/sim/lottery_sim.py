"""抽選シミュレーション (本番 DB には一切書き込まない)

本番から SELECT のみで吸い出した .simulation/data.json を入力に、
本番と同じ抽選エンジン run_lottery を呼ぶだけのスクリプト。
DB セッションは作らないので、書き込みが起きる経路は存在しない。

実行:
    docker compose -f backend/docker-compose.yaml run --rm --no-deps api \
        python -m scripts.sim.lottery_sim
"""
import json
from collections import defaultdict
from pathlib import Path

from src.domain.lottery import GRADES, Member, PracticeDay, run_lottery
from src.services.lottery_service import LotteryService

SEED = 20261017  # 再現性のため固定。本番は secrets で毎回ランダム
FORCE_SUGGEST = True  # True なら DB に保存済みの枠も無視して按分提案値で回す

# データは追跡対象外の .simulation/ に置く (実名を含むため)
DATA = Path(__file__).resolve().parents[2] / ".simulation" / "data.json"

data = json.loads(DATA.read_text())

members_all = data["members"]
votes_raw = data["votes"]
prev_stats = {r["user_id"]: (r["votes_count"], r["losses_count"]) for r in data["prev_stats"]}
alpha_by_gender = {s["gender"]: float(s["rescue_alpha"]) for s in data["settings"]}
name_of = {m["id"]: m["name"] for m in members_all}


def simulate(gender: str) -> None:
    practices = [p for p in data["practices"] if p["gender"] == gender]
    practices.sort(key=lambda p: p["practice_date"])
    pids = {p["id"] for p in practices}
    members = [m for m in members_all if m["gender"] == gender]
    by_id = {m["id"]: m for m in members}

    # --- 投票を集約 (_collect_inputs 相当) ---
    votes: dict[str, set[str]] = defaultdict(set)
    for v in votes_raw:
        if v["practice_id"] in pids:
            votes[v["user_id"]].add(v["practice_id"])

    # 学年限定の日 (D-037): 対象外学年の投票は入力から除外。マネージャーは制限しない
    restricted = {p["id"]: set(p["allowed_grades"]) for p in practices if p["allowed_grades"]}
    if restricted:
        for uid, voted in list(votes.items()):
            u = by_id.get(uid)
            if u is None or u["is_manager"]:
                continue
            votes[uid] = {
                pid for pid in voted
                if pid not in restricted or u["grade"] in restricted[pid]
            }

    # --- 日ごと・学年別の投票者数 ---
    grade_of = {m["id"]: m["grade"] for m in members if not m["is_manager"]}
    voters_per_day = []
    for p in practices:
        counts = {g: 0 for g in GRADES}
        for uid, voted in votes.items():
            g = grade_of.get(uid)
            if g is not None and p["id"] in voted:
                counts[g] += 1
        voters_per_day.append(counts)

    month_voters = {g: 0 for g in GRADES}
    for uid, voted in votes.items():
        g = grade_of.get(uid)
        if g is not None and voted:
            month_voters[g] += 1

    # --- 枠: 未設定なら按分提案値を使う (本番の vote_summary と同じ計算) ---
    suggested = LotteryService._suggest_quotas(
        [
            (p["capacity"], v, set(p["allowed_grades"] or GRADES))
            for p, v in zip(practices, voters_per_day)
        ],
        month_voters,
    )

    practice_days = []
    quota_source = []
    for p, sug in zip(practices, suggested):
        db_quotas = {3: p["quota_grade3"], 2: p["quota_grade2"], 1: p["quota_grade1"]}
        if FORCE_SUGGEST or any(db_quotas[g] is None for g in GRADES):
            quotas, src = sug, "按分提案値"
        else:
            quotas, src = db_quotas, "DB設定値"
        quota_source.append(src)
        practice_days.append(
            PracticeDay(id=p["id"], capacity=p["capacity"], quotas=dict(quotas))
        )

    engine_members = [
        Member(
            id=m["id"],
            grade=m["grade"],
            is_manager=m["is_manager"],
            prev_votes=prev_stats.get(m["id"], (0, 0))[0],
            prev_losses=prev_stats.get(m["id"], (0, 0))[1],
        )
        for m in members
    ]

    result = run_lottery(
        practices=practice_days,
        members=engine_members,
        votes=dict(votes),
        rescue_alpha=alpha_by_gender[gender],
        seed=SEED,
    )

    # --- 出力 ---
    label = "女子" if gender == "female" else "男子"
    print(f"\n{'=' * 60}")
    print(f"{label} 2026-10  (seed={SEED}, rescue_alpha={alpha_by_gender[gender]})")
    print(f"{'=' * 60}")

    by_practice: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for practice_id, member_id, via in result.assignments:
        by_practice[practice_id].append((member_id, via))

    date_of = {p["id"]: p["practice_date"] for p in practices}
    for p, day, src, voters in zip(practices, practice_days, quota_source, voters_per_day):
        limited = f" ※{p['allowed_grades']}年限定" if p["allowed_grades"] else ""
        print(f"\n■ {date_of[p['id']]}  定員{p['capacity']}{limited}")
        print(f"  枠({src}): 3年={day.quotas[3]} 2年={day.quotas[2]} 1年={day.quotas[1]}")
        print(f"  投票者数: 3年={voters[3]} 2年={voters[2]} 1年={voters[1]}")
        rows = by_practice.get(p["id"], [])
        players = [(mid, via) for mid, via in rows if not by_id[mid]["is_manager"]]
        managers = [(mid, via) for mid, via in rows if by_id[mid]["is_manager"]]
        print(f"  当選 {len(players)}名 (ほかマネージャー{len(managers)}名)")
        for g in GRADES:
            names = sorted(name_of[mid] for mid, _ in players if by_id[mid]["grade"] == g)
            if names:
                print(f"    {g}年 ({len(names)}名): " + "、".join(names))
        if managers:
            print("    マネージャー: " + "、".join(sorted(name_of[m] for m, _ in managers)))

    # --- 個人別 ---
    print(f"\n-- {label} 個人別 (投票数 / 当選数 / 落選数) --")
    wins: dict[str, int] = defaultdict(int)
    for _pid, mid, _via in result.assignments:
        wins[mid] += 1
    rows = []
    for m in members:
        voted = len(votes.get(m["id"], ()))
        if voted == 0:
            continue
        rows.append((m["grade"], m["name"], voted, wins[m["id"]], result.losses.get(m["id"], 0),
                     m["is_manager"]))
    for grade, name, voted, win, loss, is_mgr in sorted(rows, key=lambda r: (-r[0], r[1])):
        tag = " [マネージャー]" if is_mgr else ""
        print(f"  {grade}年 {name}{tag}: 投票{voted} / 当選{win} / 落選{loss}")

    not_voted = [m["name"] for m in members if not votes.get(m["id"])]
    if not_voted:
        print(f"\n  未投票 ({len(not_voted)}名): " + "、".join(sorted(not_voted)))

    if result.warnings:
        print("\n  警告:")
        for w in result.warnings:
            print(f"    - {w}")


for g in ("female", "male"):
    simulate(g)

print("\n(シミュレーションのみ。DB への書き込みは行っていない)")
