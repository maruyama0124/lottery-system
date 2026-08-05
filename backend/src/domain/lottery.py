"""抽選エンジン — 要件定義書「抽選アルゴリズム仕様 (REQ-005 の詳細)」の実装

純粋な Python モジュール。DB・API に依存せず、シード指定で決定的に動作する。

D-015 で「3年生の全通し + 月単位の学年枠比率」から
「日ごと・学年ごとに代表が決めた枠」へ変更した。学年は完全に独立して抽選される。

Phase 0 — マネージャー: 投票した練習日すべてに参加 (定員外・カウントしない)
Phase 1 — 学年ごとに独立した抽選 (3年・2年・1年をそれぞれ自分の枠の中で)
    1-a. 最低1回保証 (最優先): 全投票者に月1枠を割当
    1-b. 残枠配分: 「当選数 ÷ 投票数」が小さい人を優先し、落選救済の重みで抽選
Phase 2 — 同一学年内での余り枠の再配分
    保証できなかった投票者を最優先に救済し、残りを同学年で配分する。
    **学年をまたいだ流し込みは行わない** — 代表が日ごとに決めた学年別の人数を
    システムが勝手に変えないため (D-015)
"""
from __future__ import annotations

import random
from collections import defaultdict
from dataclasses import dataclass, field

# assigned_via の値 (DB設計書 assignments.assigned_via と一致)
VIA_MANAGER = "manager"
VIA_GRADE3 = "grade3"  # D-015 以前の「3年生全通し」。過去データの表示のために残す
VIA_GUARANTEED = "guaranteed"
VIA_DISTRIBUTION = "distribution"
VIA_OVERFLOW = "overflow"

GRADES = (3, 2, 1)


@dataclass(frozen=True)
class Member:
    id: str
    grade: int  # 1-3
    is_manager: bool = False
    prev_losses: int = 0  # 前月落選数 (REQ-005.9 落選救済の入力)


@dataclass(frozen=True)
class PracticeDay:
    id: str
    capacity: int  # プレイヤー定員 (マネージャーは含まない)
    quotas: dict[int, int]  # 学年 -> 参加人数枠 (D-015)


@dataclass
class LotteryResult:
    seed: int
    assignments: list[tuple[str, str, str]] = field(default_factory=list)  # (practice_id, member_id, via)
    warnings: list[str] = field(default_factory=list)
    losses: dict[str, int] = field(default_factory=dict)  # member_id -> 落選数 (次月の救済係数へ)


def run_lottery(
    practices: list[PracticeDay],
    members: list[Member],
    votes: dict[str, set[str]],  # member_id -> 投票した practice_id 集合
    rescue_alpha: float,
    seed: int,
) -> LotteryResult:
    rng = random.Random(seed)
    result = LotteryResult(seed=seed)

    # 1日以上投票したメンバーのみが抽選対象 (投票していない人は関与しない)
    voters = sorted(
        (m for m in members if votes.get(m.id)),
        key=lambda m: m.id,  # 決定性のため常に id 順で処理を開始する
    )

    def weight(m: Member) -> float:
        """落選救済係数 w(m) = 1 + α × 前月落選数"""
        return 1.0 + rescue_alpha * m.prev_losses

    assigned: dict[str, set[str]] = defaultdict(set)  # member_id -> practice_ids
    wins: dict[str, int] = defaultdict(int)
    practice_ids = sorted(p.id for p in practices)
    # 学年 -> practice_id -> 残枠
    quota: dict[int, dict[str, int]] = {
        g: {p.id: p.quotas.get(g, 0) for p in practices} for g in GRADES
    }

    for p in practices:
        total = sum(p.quotas.get(g, 0) for g in GRADES)
        if total > p.capacity:
            result.warnings.append(
                f"練習 {p.id}: 学年別枠の合計 ({total}名) が定員 ({p.capacity}名) を超えています"
            )

    def assign(practice_id: str, member_id: str, via: str, counts: bool = True) -> None:
        result.assignments.append((practice_id, member_id, via))
        assigned[member_id].add(practice_id)
        if counts:
            wins[member_id] += 1

    def weighted_pick(pool: list[Member]) -> Member:
        return rng.choices(pool, weights=[weight(m) for m in pool])[0]

    def weighted_order(pool: list[Member]) -> list[Member]:
        """重み付きシャッフル (重みが大きいほど先頭に来やすい)"""
        pool = list(pool)
        order: list[Member] = []
        while pool:
            m = weighted_pick(pool)
            pool.remove(m)
            order.append(m)
        return order

    def assignable_days(m: Member, q: dict[str, int]) -> list[str]:
        return sorted(
            pid for pid in votes[m.id] if q.get(pid, 0) > 0 and pid not in assigned[m.id]
        )

    def distribute(pool: list[Member], q: dict[str, int], via: str) -> None:
        """残枠配分: 「当選数 ÷ 投票数」最小のメンバー群から重み付き抽選で1名ずつ割当"""
        while True:
            candidates = [m for m in pool if assignable_days(m, q)]
            if not candidates:
                return
            ratio = lambda m: wins[m.id] / len(votes[m.id])  # noqa: E731
            min_ratio = min(ratio(m) for m in candidates)
            lowest = [m for m in candidates if ratio(m) == min_ratio]
            m = weighted_pick(lowest)
            pid = rng.choice(assignable_days(m, q))
            assign(pid, m.id, via)
            q[pid] -= 1

    # ---------- Phase 0: マネージャー (定員外・全参加) ----------
    for m in voters:
        if m.is_manager:
            for pid in sorted(votes[m.id]):
                assign(pid, m.id, VIA_MANAGER, counts=False)

    # ---------- Phase 1・2: 学年ごとに独立して抽選する ----------
    for grade in GRADES:
        grade_voters = [m for m in voters if m.grade == grade and not m.is_manager]
        if not grade_voters:
            continue
        q = quota[grade]

        # 1-a. 最低1回保証 (最優先)
        # 単純な先着順だと、選択肢の少ない人が後回しになったときに
        # 投票日が先に埋まり、枠が余っているのに0回になることがある。
        # そのため席の入れ替え（既に入っている人を別の日へ動かす）を行い、
        # 保証できる人数を最大にする。
        occupants: dict[str, list[str]] = defaultdict(list)  # practice_id -> member_ids
        placed: dict[str, str] = {}  # member_id -> practice_id

        def place(member_id: str, seen: set[str]) -> bool:
            options = [pid for pid in sorted(votes[member_id]) if pid in q]
            rng.shuffle(options)  # seed 固定なので決定的
            for pid in options:
                if pid in seen:
                    continue
                seen.add(pid)
                if q[pid] > 0:
                    q[pid] -= 1
                    occupants[pid].append(member_id)
                    placed[member_id] = pid
                    return True
                # 空きがない日でも、先に入っている人が別の日へ移れれば席が空く
                for other in list(occupants[pid]):
                    if place(other, seen):
                        occupants[pid].remove(other)
                        occupants[pid].append(member_id)
                        placed[member_id] = pid
                        return True
            return False

        unguaranteed: list[Member] = []
        for m in weighted_order(grade_voters):
            if not place(m.id, set()):
                unguaranteed.append(m)
        for member_id, pid in placed.items():
            assign(pid, member_id, VIA_GUARANTEED)

        # 1-b. 残枠配分
        distribute(grade_voters, q, VIA_DISTRIBUTION)

        # Phase 2: 同学年内の余り枠で未保証者を救済する
        for m in weighted_order([m for m in unguaranteed if wins[m.id] == 0]):
            options = assignable_days(m, q)
            if options:
                pid = rng.choice(options)
                assign(pid, m.id, VIA_OVERFLOW)
                q[pid] -= 1
            else:
                result.warnings.append(
                    f"メンバー {m.id}: 投票した練習日の{grade}年枠がすべて埋まっており"
                    "最低1回保証を満たせませんでした"
                )

        # 使い切れなかった枠は空席のまま残す (代表が枠を見直す判断材料として警告する)
        unfilled = sum(q[pid] for pid in practice_ids)
        if unfilled:
            result.warnings.append(
                f"{grade}年: 投票者が足りず {unfilled}枠 が空席のままです。枠の見直しを検討してください"
            )

    # ---------- 落選記録 (次月の救済係数の入力) ----------
    for m in voters:
        if not m.is_manager:
            result.losses[m.id] = len(votes[m.id]) - wins[m.id]

    return result
