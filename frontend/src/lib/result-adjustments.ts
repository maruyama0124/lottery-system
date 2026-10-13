import type { AssignmentCreated, FullResults, MemberResult, Participant } from "@/types/api";

export interface AdjustmentApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export const cellKey = (practiceId: string, userId: string) => `${practiceId}:${userId}`;

/** 管理画面の人数・当選回数は、削除予定を除いた調整後の参加状態で統一する。 */
export function normalizeResults(results: FullResults): FullResults {
  const joined = new Map<string, string[]>();
  for (const { practice, participants } of results.by_practice) {
    for (const participant of participants) {
      if (participant.publish_state === "removing") continue;
      const ids = joined.get(participant.user_id) ?? [];
      ids.push(practice.id);
      joined.set(participant.user_id, ids);
    }
  }
  return {
    ...results,
    by_member: results.by_member.map((member) => {
      const ids = joined.get(member.user_id) ?? [];
      return { ...member, practice_ids: ids, wins_count: ids.length };
    }),
  };
}

interface AdjustmentState {
  results: FullResults | undefined;
  saving: ReadonlySet<string>;
  syncing: boolean;
  publishing: boolean;
  needsSync: boolean;
  loadError: string | null;
  syncError: string | null;
  actionError: string | null;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** 月ごとの状態管理。セル単位で補正し、全体スナップショットでの巻き戻しはしない。 */
export class ResultAdjustments {
  private state: AdjustmentState = {
    results: undefined, saving: new Set(), syncing: false, publishing: false,
    needsSync: false, loadError: null, syncError: null, actionError: null,
  };
  private listeners = new Set<() => void>();
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private started = false;

  constructor(
    private monthId: string | null,
    private api: AdjustmentApi,
    private quietMs = 400,
  ) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<AdjustmentState>) {
    this.state = { ...this.state, ...patch };
    if (this.active) this.listeners.forEach((listener) => listener());
  }
  start() {
    this.active = true;
    if (!this.started && this.monthId) {
      this.started = true;
      void this.refresh();
    } else {
      this.scheduleRefresh();
    }
  }
  stop() {
    this.active = false;
    clearTimeout(this.timer);
  }
  isCellBusy = (practiceId: string, userId: string) =>
    this.state.publishing || this.state.saving.has(cellKey(practiceId, userId));

  private scheduleRefresh() {
    clearTimeout(this.timer);
    if (!this.active || !this.state.needsSync || this.state.saving.size ||
        this.state.syncing || this.state.publishing || this.state.syncError) return;
    this.timer = setTimeout(() => { void this.refresh(); }, this.quietMs);
  }

  refresh = async (): Promise<boolean> => {
    if (!this.monthId || this.state.saving.size || this.state.syncing) return false;
    clearTimeout(this.timer);
    const revision = this.revision;
    this.update({ syncing: true, loadError: null, syncError: null });
    try {
      const results = await this.api.get<FullResults>(`/v1/practice-months/${this.monthId}/results`);
      // 再取得中も別のマスを操作できる。古い応答は適用せず、保存後に取り直す。
      if (revision !== this.revision || this.state.saving.size) return false;
      this.update({ results: normalizeResults(results), needsSync: false });
      return true;
    } catch (error) {
      if (revision === this.revision) {
        const message = errorMessage(error, "最新の状態を取得できませんでした");
        this.update(this.state.results
          ? { syncError: message, needsSync: true }
          : { loadError: message });
      }
      return false;
    } finally {
      this.update({ syncing: false });
      this.scheduleRefresh();
    }
  };

  private replaceCell(practiceId: string, userId: string, participant: Participant | undefined) {
    if (!this.state.results) return;
    this.update({ results: normalizeResults({
      ...this.state.results,
      by_practice: this.state.results.by_practice.map((row) => {
        if (row.practice.id !== practiceId) return row;
        const participants = row.participants.filter((p) => p.user_id !== userId);
        if (participant) participants.push(participant);
        participants.sort((a, b) => b.grade - a.grade || a.name.localeCompare(b.name, "ja"));
        return { ...row, participants };
      }),
    }) });
  }

  private begin(practiceId: string, userId: string) {
    if (!this.state.results || this.isCellBusy(practiceId, userId)) return false;
    clearTimeout(this.timer);
    this.revision += 1;
    this.update({
      saving: new Set(this.state.saving).add(cellKey(practiceId, userId)),
      needsSync: true,
    });
    return true;
  }
  private finish(practiceId: string, userId: string) {
    const saving = new Set(this.state.saving);
    saving.delete(cellKey(practiceId, userId));
    this.update({ saving });
    this.scheduleRefresh();
  }
  private fail(error: unknown, fallback: string) {
    const message = errorMessage(error, fallback);
    this.update({ actionError: this.state.actionError
      ? `${this.state.actionError} / ${message}` : message });
  }

  add = async (practiceId: string, member: MemberResult) => {
    const row = this.state.results?.by_practice.find((r) => r.practice.id === practiceId);
    const before = row?.participants.find((p) => p.user_id === member.user_id);
    if (!row || (before && before.publish_state !== "removing") ||
        !this.begin(practiceId, member.user_id)) return false;
    const optimistic: Participant = before
      ? { ...before, publish_state: "published" }
      : {
        assignment_id: `optimistic:${cellKey(practiceId, member.user_id)}`,
        user_id: member.user_id, name: member.name, grade: member.grade,
        is_manager: member.is_manager, assigned_via: "manual", publish_state: "pending",
      };
    // 新規追加は公開前後ともpending、削除予定の取り消しはpublished (D-044)。
    this.replaceCell(practiceId, member.user_id, optimistic);
    try {
      const created = await this.api.post<AssignmentCreated>(
        `/v1/practices/${practiceId}/assignments`, { user_id: member.user_id },
      );
      this.replaceCell(practiceId, member.user_id, {
        ...optimistic, assignment_id: created.assignment_id,
      });
      return true;
    } catch (error) {
      this.replaceCell(practiceId, member.user_id, before);
      this.fail(error, `${member.name}さんの追加に失敗しました`);
      return false;
    } finally {
      this.finish(practiceId, member.user_id);
    }
  };

  remove = async (assignmentId: string, published: boolean) => {
    const row = this.state.results?.by_practice.find((r) =>
      r.participants.some((p) => p.assignment_id === assignmentId));
    const before = row?.participants.find((p) => p.assignment_id === assignmentId);
    if (!row || !before || before.publish_state === "removing" ||
        !this.begin(row.practice.id, before.user_id)) return false;
    this.replaceCell(row.practice.id, before.user_id,
      published && before.publish_state === "published"
        ? { ...before, publish_state: "removing" } : undefined);
    try {
      await this.api.delete<void>(`/v1/assignments/${assignmentId}`);
      return true;
    } catch (error) {
      this.replaceCell(row.practice.id, before.user_id, before);
      this.fail(error, `${before.name}さんを外せませんでした`);
      return false;
    } finally {
      this.finish(row.practice.id, before.user_id);
    }
  };

  beginPublish = () => {
    if (!this.state.results || this.state.saving.size || this.state.syncing ||
        this.state.needsSync || this.state.syncError || this.state.publishing) return false;
    this.update({ publishing: true });
    return true;
  };
  endPublish = () => {
    this.update({ publishing: false });
    this.scheduleRefresh();
  };
}
