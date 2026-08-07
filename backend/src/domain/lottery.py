"""抽選エンジン — 要件定義書「抽選アルゴリズム仕様 (REQ-005 の詳細)」の実装

純粋な Python モジュール。DB・API に依存せず、シード指定で決定的に動作する。

D-015 で「3年生の全通し + 月単位の学年枠比率」から
「日ごと・学年ごとに代表が決めた枠」へ変更した。学年は完全に独立して抽選される。

Phase 0 — マネージャー: 投票した練習日すべてに参加 (定員外・カウントしない)
Phase 1 — 学年ごとに独立した抽選 (3年・2年・1年をそれぞれ自分の枠の中で)
    1-a. 最低1回保証 (最優先): 全投票者に月1枠を割当
    1-b. 残枠配分: 「当選数 ÷ 投票数」が小さい人を優先し、落選救済の重みで抽選
Phase 2 — 同一学年内での余り枠の再配分
    保証できなかった投票者を最優先に救済し、残りを同学年で配分する
Phase 3 — 学年をまたいだ余り枠の再配分 (D-027)
    投票者が足りずに余った枠は空席にせず、他学年へ学年順に1人ずつ配る。
    当初は学年をまたいだ流用を行わなかったが (D-015)、上級生の投票者が
    定員に満たない日に空席が多発したため方針を変更した
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
    prev_votes: int = 0  # 前月投票数 (D-034: 残枠配分の優先順位に前月を含める)

    @property
    def prev_wins(self) -> int:
        # prev_votes を渡さず prev_losses だけ指定された場合に負にしない
        return max(0, self.prev_votes - self.prev_losses)


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
        """残枠配分: 「当選数 ÷ 投票数」最小のメンバー群から重み付き抽選で1名ずつ割当。

        当選率は前月と今月の合算で見る (D-034)。前月不遇だった人は合算の
        当選率が低くなり、今月の残枠配分で構造的に先頭グループへ入る。
        α (同率タイブレークの重み) だけでは順位に届かず、前月の不遇が
        翌月に反映されなかったため。前月データがない人は今月だけで比べる。
        """
        while True:
            candidates = [m for m in pool if assignable_days(m, q)]
            if not candidates:
                return
            ratio = lambda m: (wins[m.id] + m.prev_wins) / (len(votes[m.id]) + m.prev_votes)  # noqa: E731
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

    # ---------- Phase 1: 最低1回保証 ----------
    # 2段構えで解く (D-029)。
    #   1-a. まず自分の学年の枠の中で配置する（代表が決めた学年構成を尊重する）
    #   1-b. そこに入れなかった人だけ、他学年の余り枠も使って配置し直す
    # いずれも席の入れ替え（既に入っている人を別の日へ動かす）を伴う最大マッチング。
    # 1-b がないと、ある学年の枠の総数が投票者数に満たないときに構造的な0回が出る
    # （実データで1年58名に対し1年枠50席となり8名が0回になった）。
    players = [m for m in voters if not m.is_manager]
    day_seats = {pid: sum(quota[g][pid] for g in GRADES) for pid in practice_ids}

    occupants: dict[str, list[str]] = defaultdict(list)  # practice_id -> member_ids
    placed: dict[str, str] = {}  # member_id -> practice_id
    grade_of = {m.id: m.grade for m in players}

    def make_place(has_room, movable=None):
        """has_room(pid, member_id) が真なら入れる。空きがなければ入れ替えを試みる。

        movable(occupant_id, member_id) は「その占有者を動かしてよいか」の判定。
        1-a では同学年どうしに限定する。他学年の人を動かすと、動かされた側が
        自分の学年の枠に戻れず押し出されてしまうため（3年の席に1年が入り込む）。
        """

        def place(member_id: str, seen: set[str]) -> bool:
            options = [pid for pid in sorted(votes[member_id]) if pid in day_seats]
            rng.shuffle(options)  # seed 固定なので決定的
            for pid in options:
                if pid in seen:
                    continue
                seen.add(pid)
                if has_room(pid, member_id):
                    occupants[pid].append(member_id)
                    placed[member_id] = pid
                    return True
                for other in list(occupants[pid]):
                    if movable is not None and not movable(other, member_id):
                        continue
                    if place(other, seen):
                        occupants[pid].remove(other)
                        occupants[pid].append(member_id)
                        placed[member_id] = pid
                        return True
            return False

        return place

    # 1-a. 自学年の枠の中だけで配置する。
    #      その日にすでに入っている同学年の人数と、自学年の枠を比べる
    def has_own_grade_room(pid: str, member_id: str) -> bool:
        # その日の定員は常に守る。そのうえで自学年の枠に空きがあるかを見る
        if len(occupants[pid]) >= day_seats[pid]:
            return False
        g = grade_of[member_id]
        same_grade = sum(1 for mid in occupants[pid] if grade_of[mid] == g)
        return same_grade < quota[g][pid]

    place_in_grade = make_place(has_own_grade_room)
    unguaranteed: list[Member] = []
    for m in weighted_order(players):
        if not place_in_grade(m.id, set()):
            unguaranteed.append(m)

    # 1-b. 入れなかった人を、他学年の余り枠も使って配置する
    place_anywhere = make_place(lambda pid, _mid: len(occupants[pid]) < day_seats[pid])
    for m in weighted_order(unguaranteed):
        place_anywhere(m.id, set())

    for member_id, pid in placed.items():
        assign(pid, member_id, VIA_GUARANTEED)

    # 保証で使った席を枠から引く。
    # 日ごとに「その学年が何人入ったか」を数え、自学年の枠から引く。
    # 枠を超えたぶん（他学年の余りを借りた人数）だけ、余っている学年から引く。
    # 1人ずつ順に引くと、自学年に枠が残っているのに他学年から引いてしまい、
    # 枠が空いているように見えるのに埋まらない席が生まれる
    for pid in practice_ids:
        used = defaultdict(int)
        for member_id, p_id in placed.items():
            if p_id == pid:
                used[grade_of[member_id]] += 1
        borrowed = 0
        for g in GRADES:
            take = min(used[g], quota[g][pid])
            quota[g][pid] -= take
            borrowed += used[g] - take
        for g in GRADES:
            if borrowed <= 0:
                break
            take = min(borrowed, quota[g][pid])
            quota[g][pid] -= take
            borrowed -= take

    # ---------- Phase 1.5: 前月不遇者への2席目の優先確保 (D-035) ----------
    # 「しっかり投票したのに月1回」が2か月続くのを防ぐため、
    # 前月3日以上投票して当選1回以下だった人には、残枠配分に先立って
    # 2席目を確保する。今月も3日以上投票している人に限る
    # （投票が少ない人の当選が少ないのは不遇ではないため）。
    # 席が足りない月は全員には行き渡らない（最低1回保証が常に優先）。
    second_chance = [
        m
        for m in players
        if m.prev_votes >= 3
        and m.prev_wins <= 1
        and len(votes[m.id]) >= 3
        and wins[m.id] == 1
    ]
    for m in weighted_order(second_chance):
        options = [
            pid
            for pid in sorted(votes[m.id])
            if pid not in assigned[m.id] and sum(quota[g][pid] for g in GRADES) > 0
        ]
        if not options:
            continue
        pid = rng.choice(options)
        assign(pid, m.id, VIA_DISTRIBUTION)
        if quota[m.grade][pid] > 0:
            quota[m.grade][pid] -= 1
        else:
            for g in GRADES:
                if quota[g][pid] > 0:
                    quota[g][pid] -= 1
                    break

    # ---------- Phase 2: 残枠を学年ごとに配る ----------
    for grade in GRADES:
        grade_voters = [m for m in players if m.grade == grade]
        if grade_voters:
            distribute(grade_voters, quota[grade], VIA_DISTRIBUTION)

    # ---------- Phase 3: 学年をまたいだ余り枠の再配分 (D-027) ----------
    # 投票者が足りずに余った枠は、空席にせず他学年へ回す。
    for pid in practice_ids:
        if sum(quota[g][pid] for g in GRADES) <= 0:
            continue

        def waiting_of(g: int) -> list[Member]:
            """その日に投票していて、まだ入っていない人。0回の人を先に置く"""
            pool = [
                m
                for m in players
                if m.grade == g and pid in votes[m.id] and pid not in assigned[m.id]
            ]
            return sorted(pool, key=lambda m: wins[m.id])

        # 3-a. まず自分の学年の枠で埋める。
        #      枠が余っていて投票者もいるのに埋まらない、という状態を作らない
        for g in GRADES:
            pool = waiting_of(g)
            while quota[g][pid] > 0 and pool:
                zero = [m for m in pool if wins[m.id] == 0]
                m = weighted_pick(zero or pool)
                pool.remove(m)
                assign(pid, m.id, VIA_DISTRIBUTION)
                quota[g][pid] -= 1

        # 3-b. それでも余った枠は、学年の区別をなくして他学年へ回す。
        #      特定の学年に偏らないよう、学年を順番に回して1人ずつ配る
        leftover = sum(quota[g][pid] for g in GRADES)
        for g in GRADES:
            quota[g][pid] = 0
        waiting = {g: waiting_of(g) for g in GRADES}
        turn = [g for g in GRADES if waiting[g]]
        i = 0
        while leftover > 0 and any(waiting[g] for g in turn):
            g = turn[i % len(turn)]
            i += 1
            if not waiting[g]:
                continue
            zero = [m for m in waiting[g] if wins[m.id] == 0]
            m = weighted_pick(zero or waiting[g])
            waiting[g].remove(m)
            assign(pid, m.id, VIA_OVERFLOW)
            leftover -= 1

        # 全学年を配りきってもなお余る場合のみ、空席として警告する
        if leftover > 0:
            result.warnings.append(
                f"{pid}: 投票者が足りず {leftover}枠 が空席のままです"
            )

    # ---------- 最低1回保証の判定 (REQ-005.6) ----------
    # Phase 3 まで終えてなお0回の人だけを警告する
    for m in voters:
        if not m.is_manager and wins[m.id] == 0:
            result.warnings.append(
                f"メンバー {m.id}: 投票した練習日がすべて埋まっており"
                "最低1回保証を満たせませんでした"
            )

    # ---------- 落選記録 (次月の救済係数の入力) ----------
    for m in voters:
        if not m.is_manager:
            result.losses[m.id] = len(votes[m.id]) - wins[m.id]

    return result
