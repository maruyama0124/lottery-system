import type { Gender, UserProfile } from "@/types/api";
import { userScope, type MemberHome } from "./member-home";

const PREFIX = "lottery:member:v1:";
const SIGNAL = "lottery:member:invalidate";
const MAX_AGE = 24 * 60 * 60 * 1000;
export type HomeState = {
  data?: MemberHome; updatedAt?: number; refreshing: boolean; stale: boolean; error: string | null;
};
type Saved = { data: MemberHome; updatedAt: number };
type FetchHome = (gender: Gender, month: string | null) => Promise<MemberHome>;

/** ページ単位のキャッシュ。権限判定やJWTの保存には使用しない。 */
export class MemberHomeStore {
  private state: HomeState = { refreshing: false, stale: true, error: null };
  private listeners = new Set<() => void>();
  private revision = 0;
  private request: Promise<void> | null = null;
  private disposed = false;
  constructor(
    readonly scope: string, readonly gender: Gender, readonly month: string | null,
    private fetchHome: FetchHome, private storage?: Storage,
  ) {
    try {
      const saved: Saved | null = JSON.parse(storage?.getItem(this.key) ?? "null");
      if (saved && Date.now() - saved.updatedAt < MAX_AGE && this.accepts(saved.data)) {
        this.state = { ...this.state, ...saved };
      }
    } catch { /* 無効な保存内容・利用不可のストレージは無視して取得する。 */ }
  }
  get key() { return PREFIX + JSON.stringify([this.scope, this.gender, this.month ?? "latest"]); }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<HomeState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private accepts(data: MemberHome): boolean {
    return userScope(data.user) === this.scope
      && data.months.every((m) => m.gender === this.gender)
      && (!data.detail || (data.detail.gender === this.gender && (!this.month || data.detail.id === this.month)))
      && (!data.voteStatus || (data.voteStatus.practice_month_id === data.detail?.id && data.user.gender === this.gender && !data.user.is_observer))
      && (!data.participation || (data.detail?.status === "published" && data.participation.practice_month_id === data.detail.id))
      && (!data.myResults || (data.detail?.status === "published" && data.myResults.practice_month_id === data.detail.id && data.user.gender === this.gender && !data.user.is_observer));
  }
  private persist() {
    try {
      if (!this.state.data || this.state.stale) this.storage?.removeItem(this.key);
      else {
        // 一覧性を保つため直近12組まで。トークン・プロフィール・投票状態は永続化しない。
        const keys = Object.keys(this.storage ?? {}).filter((k) => k.startsWith(PREFIX));
        while (keys.length >= 12) this.storage?.removeItem(keys.shift()!);
        const data = { ...this.state.data, user: {
          id: this.state.data.user.id, gender: this.state.data.user.gender, role: this.state.data.user.role,
          grade: this.state.data.user.grade, is_manager: this.state.data.user.is_manager, is_observer: this.state.data.user.is_observer,
        }, voteStatus: null };
        this.storage?.setItem(this.key, JSON.stringify({ data, updatedAt: this.state.updatedAt }));
      }
    } catch { /* 容量超過・プライベートブラウズ時も通信は続ける。 */ }
  }
  invalidate(clear = false) {
    this.revision++;
    this.set({ stale: true, ...(clear ? { data: undefined, updatedAt: undefined } : {}) });
    this.persist();
    if (this.listeners.size) void this.refresh();
  }
  dispose() {
    this.disposed = true;
    this.revision++;
    this.set({ data: undefined, stale: true, updatedAt: undefined });
    this.persist();
  }
  refresh = (): Promise<void> => {
    if (this.disposed) return Promise.resolve();
    if (this.request) return this.request;
    if (this.state.updatedAt && Date.now() - this.state.updatedAt >= MAX_AGE) {
      this.set({ data: undefined, updatedAt: undefined, stale: true });
      this.persist();
    }
    const revision = this.revision;
    this.set({ refreshing: true, error: null });
    this.request = (async () => {
      try {
        const data = await this.fetchHome(this.gender, this.month);
        if (revision !== this.revision) return;
        if (!this.accepts(data)) throw Object.assign(new Error("ユーザー情報が変わりました。ページを開き直してください"), { status: 403 });
        this.set({ data, updatedAt: Date.now(), stale: false });
        this.persist();
      } catch (error) {
        if (revision !== this.revision) return;
        const status = (error as { status?: number })?.status;
        this.set({ error: error instanceof Error ? error.message : "取得に失敗しました", stale: true,
          ...([401, 403, 404].includes(status ?? 0) ? { data: undefined, updatedAt: undefined } : {}) });
        // 失敗したキャッシュを次の訪問で無表示のまま新鮮と扱わない。
        if (!this.state.data) this.persist();
      } finally {
        this.request = null;
        this.set({ refreshing: false });
        if (!this.disposed && revision !== this.revision && this.listeners.size) void this.refresh();
      }
    })();
    return this.request;
  };
}

const stores = new Map<string, MemberHomeStore>();
function storage(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}
export function getMemberHomeStore(user: UserProfile, gender: Gender, month: string | null) {
  const scope = userScope(user);
  const key = JSON.stringify([scope, gender, month]);
  let store = stores.get(key);
  if (!store) {
    store = new MemberHomeStore(scope, gender, month, async (g, m) => {
      const query = new URLSearchParams({ gender: g });
      if (m) query.set("month", m);
      const res = await fetch(`/api/member/home?${query}`, { credentials: "include", cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) window.dispatchEvent(new Event("lottery:session-expired"));
        throw Object.assign(new Error(res.status === 401 ? "再ログインしてください" : "練習情報の更新に失敗しました"), { status: res.status });
      }
      const data: MemberHome = await res.json();
      if (userScope(data.user) !== scope) window.dispatchEvent(new Event("lottery:session-expired"));
      return data;
    }, storage());
    stores.set(key, store);
  }
  return store;
}

/** 日程・投票・公開などの保存成功後だけ呼ぶ。別タブにも通知する。 */
export function invalidateMemberHomes(clear = false, broadcast = true) {
  const local = storage();
  try {
    Object.keys(local ?? {}).filter((k) => k.startsWith(PREFIX)).forEach((k) => local?.removeItem(k));
    if (broadcast) local?.setItem(SIGNAL, JSON.stringify({ at: Date.now(), clear, nonce: Math.random() }));
  } catch { /* ストレージがなくても同じタブは無効化する。 */ }
  stores.forEach((store) => store.invalidate(clear));
}

export function clearMemberHomes() {
  // ログアウト後に保留中の取得結果が永続化されないよう、購読を外してから破棄する。
  stores.forEach((store) => store.dispose());
  stores.clear();
  const local = storage();
  try { Object.keys(local ?? {}).filter((k) => k.startsWith(PREFIX)).forEach((k) => local?.removeItem(k)); } catch { /* optional */ }
}

export function listenForMemberInvalidation(callback: () => void) {
  const listener = (event: StorageEvent) => {
    if (event.key === SIGNAL) {
      invalidateMemberHomes(true, false);
      callback();
    }
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
