export interface OrderedMember {
  user_id: string;
  grade: number;
  is_manager: boolean;
}

type Orders = Record<string, string[]>;
export type RowOrderState = { orders: Orders; error: string | null };
export const EMPTY_ROW_ORDER: RowOrderState = { orders: {}, error: null };
export const ROW_ORDER_PREFIX = "lottery:member-row-order:v1:";
export type RowOrderMode = "separate" | "mixed";
export const memberGroup = (m: OrderedMember, mode: RowOrderMode = "separate") =>
  `${m.grade}:${mode === "mixed" ? "all" : m.is_manager ? "manager" : "player"}`;

export interface RowBox { id: string; group: string; top: number; height: number }

/** DOMを並べ替える前の挿入プレビュー。可変の行高・学年見出しの隙間も保持する。 */
export function previewRowOffsets(boxes: readonly RowBox[], sourceId: string, targetId: string): Record<string, number> | null {
  const source = boxes.find((b) => b.id === sourceId), target = boxes.find((b) => b.id === targetId);
  if (!source || !target || source.group !== target.group) return null;
  const group = boxes.filter((b) => b.group === source.group);
  const from = group.indexOf(source), to = group.indexOf(target);
  group.splice(from, 1); group.splice(to, 0, source);
  let index = 0;
  const reordered = boxes.map((b) => b.group === source.group ? group[index++] : b);
  const offsets: Record<string, number> = {};
  let top = boxes[0]?.top ?? 0;
  reordered.forEach((row, i) => {
    if (i) top += boxes[i].top - (boxes[i - 1].top + boxes[i - 1].height);
    offsets[row.id] = top - row.top;
    top += row.height;
  });
  return offsets;
}

/** グループの位置・API配列は変えず整列する。通常は同学年・同区分、混在一覧のみ学年単位。 */
export function orderMembers<T extends OrderedMember>(rows: readonly T[], orders: Orders, mode: RowOrderMode = "separate"): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = memberGroup(row, mode);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    const ranks = new Map((orders[key] ?? []).map((id, i) => [id, i]));
    // sortは安定。未登録の新メンバーは入力順のまま末尾へ追加する。
    group.sort((a, b) => (ranks.get(a.user_id) ?? Infinity) - (ranks.get(b.user_id) ?? Infinity));
  }
  const positions = new Map<string, number>();
  return rows.map((row) => {
    const key = memberGroup(row, mode), index = positions.get(key) ?? 0;
    positions.set(key, index + 1);
    return groups.get(key)![index];
  });
}

function parse(raw: string | null): Orders {
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const orders: Orders = {};
  for (const [key, ids] of Object.entries(value)) {
    if (!/^[123]:(player|manager|all)$/.test(key) || !Array.isArray(ids) || ids.length > 1000 ||
        ids.some((id) => typeof id !== "string" || !id || id.length > 100)) continue;
    orders[key] = [...new Set(ids as string[])];
  }
  return orders;
}

/** 表示設定のみ。会員名・投票・当選情報は保存せず、通信もしない。 */
export class MemberRowOrderStore {
  private state = EMPTY_ROW_ORDER;
  private listeners = new Set<() => void>();
  constructor(readonly key: string, private storage?: Pick<Storage, "getItem" | "setItem">, private mode: RowOrderMode = "separate") {
    this.reload();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(state: RowOrderState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  reload = () => {
    try {
      this.update({ orders: parse(this.storage?.getItem(this.key) ?? null), error: null });
    } catch {
      this.update({ orders: {}, error: null });
    }
  };
  move(sourceId: string, targetId: string, members: readonly OrderedMember[]): boolean {
    if (sourceId === targetId) return false;
    const source = members.find((m) => m.user_id === sourceId);
    const target = members.find((m) => m.user_id === targetId);
    if (!source || !target || memberGroup(source, this.mode) !== memberGroup(target, this.mode)) return false;
    const group = memberGroup(source, this.mode);
    // 別の月・絞り込みで見えない会員の保存位置も保持する。
    const ids = [...new Set([...(this.state.orders[group] ?? []),
      ...members.filter((m) => memberGroup(m, this.mode) === group).map((m) => m.user_id)])];
    const from = ids.indexOf(sourceId), to = ids.indexOf(targetId);
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    const orders = { ...this.state.orders, [group]: ids };
    let error: string | null = null;
    try {
      if (!this.storage) throw new Error("storage unavailable");
      this.storage.setItem(this.key, JSON.stringify(orders));
    } catch {
      error = "並び順をブラウザに保存できません。この画面内では有効ですが、再読み込みすると失われます。";
    }
    this.update({ orders, error });
    return true;
  }
}
