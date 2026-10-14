import type { AssignmentBatchRequest, AssignmentChange, FullResults, MemberResult, Participant, PracticeMonth } from "@/types/api";

export interface AdjustmentApi {
  get<T>(path: string): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
}
export const cellKey = (practiceId: string, userId: string) => `${practiceId}:${userId}`;
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
  return { ...results, by_member: results.by_member.map((member) => {
    const ids = joined.get(member.user_id) ?? [];
    return { ...member, practice_ids: ids, wins_count: ids.length };
  }) };
}
interface AdjustmentState {
  results: FullResults | undefined;
  saving: boolean; syncing: boolean; publishing: boolean; needsSync: boolean;
  dirtyChanges: number; savedChanges: number;
  loadError: string | null; syncError: string | null; saveError: string | null;
}
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const unpublishedCount = (results: FullResults) => results.by_practice.reduce(
  (count, row) => count + row.participants.filter((p) => p.publish_state !== "published").length, 0);

/** 未保存差分と保存済み基準を分離する。クリックでは通信しない。 */
export class ResultAdjustments {
  private state: AdjustmentState = {
    results: undefined, saving: false, syncing: false, publishing: false, needsSync: false,
    dirtyChanges: 0, savedChanges: 0, loadError: null, syncError: null, saveError: null,
  };
  private baseline: FullResults | undefined;
  private changes = new Map<string, AssignmentChange>();
  private listeners = new Set<() => void>();
  private active = false;
  private started = false;
  constructor(private monthId: string | null, private api: AdjustmentApi) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<AdjustmentState>) {
    this.state = { ...this.state, ...patch };
    if (this.active) this.listeners.forEach((listener) => listener());
  }
  start() {
    this.active = true;
    if (!this.started && this.monthId) { this.started = true; void this.refresh(); }
  }
  stop() { this.active = false; }
  isCellBusy = (practiceId: string, userId: string) => {
    void practiceId; void userId;
    return this.state.saving || this.state.syncing || this.state.publishing || this.state.needsSync || !!this.state.syncError;
  };
  refresh = async (): Promise<boolean> => {
    if (!this.monthId || this.state.saving || this.state.syncing || this.changes.size) return false;
    this.update({ syncing: true, loadError: null, syncError: null });
    try {
      const results = normalizeResults(await this.api.get<FullResults>(`/v1/practice-months/${this.monthId}/results`));
      this.baseline = results;
      this.update({ results, savedChanges: unpublishedCount(results), dirtyChanges: 0, needsSync: false, saveError: null });
      return true;
    } catch (error) {
      const text = message(error, "最新の状態を取得できませんでした");
      this.update(this.baseline ? { syncError: text } : { loadError: text });
      return false;
    } finally { this.update({ syncing: false }); }
  };
  private edit(practiceId: string, userId: string, participating: boolean, published: boolean): boolean {
    if (!this.baseline || this.isCellBusy(practiceId, userId)) return false;
    const row = this.baseline.by_practice.find((r) => r.practice.id === practiceId);
    const member = this.baseline.by_member.find((m) => m.user_id === userId);
    if (!row || !member) return false;
    const before = row.participants.find((p) => p.user_id === userId);
    const beforeJoined = !!before && before.publish_state !== "removing";
    const key = cellKey(practiceId, userId);
    if (participating === beforeJoined) this.changes.delete(key);
    else this.changes.set(key, { practice_id: practiceId, user_id: userId, participating,
      expected_assignment_id: before?.assignment_id ?? null, expected_publish_state: before?.publish_state ?? null });
    let participant: Participant | undefined = before;
    if (participating !== beforeJoined) {
      participant = participating
        ? before ? { ...before, publish_state: "published" } : {
          assignment_id: `local:${key}`, user_id: userId, name: member.name, grade: member.grade,
          is_manager: member.is_manager, assigned_via: "manual", publish_state: "pending",
        }
        : before && published && before.publish_state === "published" ? { ...before, publish_state: "removing" } : undefined;
    }
    const results = this.state.results!;
    this.update({ results: normalizeResults({ ...results, by_practice: results.by_practice.map((r) => {
      if (r.practice.id !== practiceId) return r;
      const participants = r.participants.filter((p) => p.user_id !== userId);
      if (participant) participants.push(participant);
      participants.sort((a, b) => b.grade - a.grade || a.name.localeCompare(b.name, "ja"));
      return { ...r, participants };
    }) }), dirtyChanges: this.changes.size });
    return true;
  }
  add = (practiceId: string, member: MemberResult) => this.edit(practiceId, member.user_id, true, true);
  remove = (assignmentId: string, published: boolean) => {
    const row = this.state.results?.by_practice.find((r) => r.participants.some((p) => p.assignment_id === assignmentId));
    const current = row?.participants.find((p) => p.assignment_id === assignmentId);
    return !!row && !!current && this.edit(row.practice.id, current.user_id, false, published);
  };
  save = async (month: PracticeMonth): Promise<boolean> => {
    if (month.id !== this.monthId || !this.changes.size || this.isCellBusy("", "")) return false;
    const preview = this.state.results!;
    this.update({ saving: true, saveError: null });
    try {
      const body: AssignmentBatchRequest = {
        changes: [...this.changes.values()], expected_month_status: month.status,
        expected_published_at: month.published_at,
      };
      await this.api.put<void>(`/v1/practice-months/${this.monthId}/assignments`, body);
    } catch (error) {
      this.update({ saving: false, saveError: message(error, "変更を保存できませんでした") });
      return false;
    }
    // 保存成功後の取得失敗では、PUTを再送せずGETだけを再試行する。
    this.changes.clear();
    this.baseline = preview;
    this.update({ saving: false, dirtyChanges: 0, savedChanges: unpublishedCount(preview), needsSync: true });
    await this.refresh();
    return true;
  };
  beginPublish = () => {
    if (!this.state.results || this.changes.size || this.state.saveError || this.isCellBusy("", "")) return false;
    this.update({ publishing: true });
    return true;
  };
  endPublish = () => { this.update({ publishing: false }); };
}
