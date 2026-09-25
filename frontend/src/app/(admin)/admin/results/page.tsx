"use client";

// 結果・微調整画面（代表のみ） — ui-design/snippets/admin-results-mobile.html 準拠
import { Fragment, useState } from "react";
import { AdminHeader } from "@/components/admin/header";
import { ErrorMessage } from "@/components/ui/error-message";
import {
  ChevronDownIcon,
  TriangleAlertIcon,
  XIcon,
} from "@/components/ui/icons";
import { Loading } from "@/components/ui/loading";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useRequireRepresentative } from "@/hooks/use-auth";
import type {
  AssignmentCreated,
  FullResults,
  PracticeMonth,
  PracticeMonthDetail,
  PracticeResults,
  RosterPage,
} from "@/types/api";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatPracticeDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

function shortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatYearMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
}

type Tab = "practice" | "member" | "matrix";

export default function AdminResultsPage() {
  const { user, isLoading: authLoading } = useRequireRepresentative();

  const { data: months, error: monthsError } = useApi<PracticeMonth[]>(
    user ? "/v1/practice-months" : null,
  );
  // 過去の月の結果も見られるようにする (既定は最新月)
  const [selectedMonthId, setSelectedMonthId] = useState<string | null>(null);
  const monthId = selectedMonthId ?? months?.[0]?.id ?? null;

  const { data: pm, mutate: mutatePm } = useApi<PracticeMonthDetail>(
    monthId ? `/v1/practice-months/${monthId}` : null,
  );
  const {
    data: results,
    error: resultsError,
    mutate: mutateResults,
  } = useApi<FullResults>(monthId ? `/v1/practice-months/${monthId}/results` : null);

  // 追加用メンバー候補（自性別）
  const { data: roster } = useApi<RosterPage>(
    pm ? `/v1/users?per_page=200&gender=${pm.gender}` : null,
  );

  // 既定は一覧表。全体を見ながらマスを直接タップして調整できるため
  const [tab, setTab] = useState<Tab>("matrix");
  // メンバー別タブの学年絞り込み ("all" | "3" | "2" | "1" | "manager")
  const [memberGrade, setMemberGrade] = useState("all");
  // メンバー別タブで展開中の1名。その人の参加日をここで直接調整する
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const [openPracticeIds, setOpenPracticeIds] = useState<Set<string>>(new Set());
  // 一覧表の行・列ハイライト。名前や日付をタップすると青くなり、もう一度で解除
  const [pickedRow, setPickedRow] = useState<string | null>(null);
  const [pickedCol, setPickedCol] = useState<string | null>(null);
  // 一覧表の学年絞り込み ("all" | "3" | "2" | "1" | "manager")
  const [matrixGrade, setMatrixGrade] = useState("all");
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [capacityWarnings, setCapacityWarnings] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [busy, setBusy] = useState(false);

  // 絞り込み。マネージャーは学年に関係なく1つにまとめる
  const filterByGrade = (grade: string) =>
    (results?.by_member ?? []).filter((m) => {
      if (grade === "all") return true;
      if (grade === "manager") return m.is_manager;
      return !m.is_manager && String(m.grade) === grade;
    });
  const filteredMembers = filterByGrade(memberGrade);
  const matrixMembers = filterByGrade(matrixGrade);

  const toggleOpen = (practiceId: string) => {
    setOpenPracticeIds((prev) => {
      const next = new Set(prev);
      if (next.has(practiceId)) next.delete(practiceId);
      else next.add(practiceId);
      return next;
    });
  };

  // タップごとに確認は出さない。メンバーへ反映されるのは公開・再公開のときだけなので、
  // 確認はそちらでまとめて行う (D-044)
  const handleDelete = async (assignmentId: string, name: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiClient.delete<void>(`/v1/assignments/${assignmentId}`);
      await mutateResults();
    } catch (e) {
      setActionError(
        e instanceof ApiClientError ? e.error.message : `${name}さんを外せませんでした`,
      );
    } finally {
      setBusy(false);
    }
  };

  /** メンバー別タブから、その人を指定の練習日へ追加する */
  const handleAddFor = async (practiceId: string, userId: string, name: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const created = await apiClient.post<AssignmentCreated>(
        `/v1/practices/${practiceId}/assignments`,
        { user_id: userId },
      );
      if (created?.capacity_exceeded) {
        setCapacityWarnings((prev) => new Set(prev).add(practiceId));
      }
      await mutateResults();
    } catch (e) {
      setActionError(
        e instanceof ApiClientError
          ? e.error.message
          : `${name}さんの追加に失敗しました`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (practiceId: string) => {
    if (!selectedUserId || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const created = await apiClient.post<AssignmentCreated>(
        `/v1/practices/${practiceId}/assignments`,
        { user_id: selectedUserId },
      );
      if (created?.capacity_exceeded) {
        setCapacityWarnings((prev) => new Set(prev).add(practiceId));
      }
      setAddingFor(null);
      setSelectedUserId("");
      await mutateResults();
    } catch (e) {
      setActionError(
        e instanceof ApiClientError ? e.error.message : "追加に失敗しました",
      );
    } finally {
      setBusy(false);
    }
  };

  const published = pm?.status === "published";

  // 公開後の微調整で、まだメンバーに反映されていない件数 (D-044)。
  // 追加予定 (pending) と削除予定 (removing) を数える
  const pendingChanges = published
    ? (results?.by_practice ?? []).reduce(
        (n, pr) =>
          n + pr.participants.filter((p) => p.publish_state !== "published").length,
        0,
      )
    : 0;

  const handlePublish = async () => {
    if (!monthId || publishing) return;
    // メンバーに見える内容が変わるのはこの操作だけなので、確認はここでまとめて出す
    const message = published
      ? `${pendingChanges}件の変更をメンバーに反映しますか？再公開後は全メンバーが新しい内容を閲覧できます`
      : "結果を公開しますか？公開後は全メンバーが閲覧できます";
    if (!window.confirm(message)) return;
    setPublishing(true);
    setActionError(null);
    try {
      await apiClient.post<void>(`/v1/practice-months/${monthId}/publish`);
      await Promise.all([mutatePm(), mutateResults()]);
    } catch (e) {
      setActionError(
        e instanceof ApiClientError ? e.error.message : "公開に失敗しました",
      );
    } finally {
      setPublishing(false);
    }
  };

  if (authLoading || !user) {
    return <Loading />;
  }

  const renderPracticeSection = (pr: PracticeResults) => {
    const { practice, participants } = pr;
    const playerCount = participants.filter((p) => !p.is_manager).length;
    const capacity = practice.capacity;
    const over = playerCount > capacity;
    const full = playerCount === capacity;
    const pct = Math.min((playerCount / capacity) * 100, 100);
    const open = openPracticeIds.has(practice.id);
    const assignedUserIds = new Set(participants.map((p) => p.user_id));
    // 追加候補は「この日に投票した人」を先に出す。投票していない人を入れても
    // 当人が来られない可能性があるため、区別できるようにしておく
    const votedIds = new Set(
      (results?.by_member ?? [])
        .filter((m) => m.voted_practice_ids.includes(practice.id))
        .map((m) => m.user_id),
    );
    const winsOf = new Map(
      (results?.by_member ?? []).map((m) => [m.user_id, m] as const),
    );
    const candidates = (roster?.items ?? [])
      .filter((u) => !assignedUserIds.has(u.id))
      .map((u) => ({ user: u, voted: votedIds.has(u.id), stat: winsOf.get(u.id) }))
      .sort((a, b) => {
        if (a.voted !== b.voted) return a.voted ? -1 : 1; // 投票者が先
        // 投票者どうしは当選が少ない人を先に出す
        const aw = a.stat?.wins_count ?? 0;
        const bw = b.stat?.wins_count ?? 0;
        if (aw !== bw) return aw - bw;
        return a.user.name.localeCompare(b.user.name, "ja");
      });

    return (
      <section
        key={practice.id}
        className={`overflow-hidden rounded-xl bg-white shadow-sm ${
          open
            ? "border-2 border-brand-200"
            : "border border-gray-200"
        }`}
      >
        <button
          onClick={() => toggleOpen(practice.id)}
          className={`flex w-full items-center justify-between px-4 py-3 ${open ? "bg-brand-50" : ""}`}
        >
          <div className="text-left">
            <p className="text-sm font-bold text-gray-900">
              {formatPracticeDate(practice.practice_date)} {practice.location}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-2 w-28 overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full rounded-full ${
                    over || full ? "bg-gray-400" : "bg-green-500"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {over ? (
                <span className="text-xs font-semibold text-gray-500">
                  {playerCount} / {capacity}名（定員超過）
                </span>
              ) : full ? (
                <span className="text-xs font-semibold text-gray-500">
                  {playerCount} / {capacity}名（満員）
                </span>
              ) : (
                <span className="text-xs font-semibold text-green-700">
                  {playerCount} / {capacity}名
                </span>
              )}
            </div>
          </div>
          <span className={`text-gray-400 ${open ? "rotate-180" : ""}`}>
            <ChevronDownIcon width={16} height={16} />
          </span>
        </button>

        {open && (
          <ul className="divide-y divide-gray-100">
            {capacityWarnings.has(practice.id) && (
              <li className="bg-yellow-50 px-4 py-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-yellow-800">
                  <TriangleAlertIcon width={14} height={14} />
                  定員を超過しています
                </p>
              </li>
            )}
            {/* 抽選のどの段階で入ったか (保証/配分/流込) は内部処理であり、
                代表の判断材料にならないため表示しない。マネージャーだけは
                定員外という運用上の意味があるので区別する */}
            {participants.map((p) => {
              return (
                <li key={p.assignment_id} className="flex items-center gap-2 px-4 py-2.5">
                  <span className="flex-1 text-sm font-semibold text-gray-800">
                    {p.name}
                  </span>
                  {p.is_manager ? (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
                      マネージャー
                    </span>
                  ) : (
                    <>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
                        {p.grade}年
                      </span>
                      {/* 誰を外すかの判断材料。月内でよく当たっている人ほど外しやすい */}
                      <span className="text-[11px] text-gray-500">
                        月{winsOf.get(p.user_id)?.wins_count ?? 0}/
                        {winsOf.get(p.user_id)?.votes_count ?? 0}
                      </span>
                    </>
                  )}
                  {published && p.publish_state === "pending" && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                      追加予定
                    </span>
                  )}
                  {p.publish_state === "removing" ? (
                    <>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        削除予定
                      </span>
                      <button
                        onClick={() => handleAddFor(practice.id, p.user_id, p.name)}
                        disabled={busy}
                        className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700 disabled:opacity-50"
                      >
                        戻す
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleDelete(p.assignment_id, p.name)}
                      disabled={busy}
                      aria-label={`${p.name}を削除`}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    >
                      <XIcon width={16} height={16} />
                    </button>
                  )}
                </li>
              );
            })}
            <li className="p-3">
              {addingFor === practice.id ? (
                <div className="space-y-2">
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-brand-600 focus:outline-none"
                  >
                    <option value="">メンバーを選択…</option>
                    {candidates.some((c) => c.voted) && (
                      <optgroup label="この日に投票した人">
                        {candidates
                          .filter((c) => c.voted)
                          .map(({ user, stat }) => (
                            <option key={user.id} value={user.id}>
                              {user.name}（{user.grade}年
                              {user.is_manager ? "・マネ" : ""}）投票
                              {stat?.votes_count ?? 0}→当選{stat?.wins_count ?? 0}
                            </option>
                          ))}
                      </optgroup>
                    )}
                    {candidates.some((c) => !c.voted) && (
                      <optgroup label="この日に投票していない人">
                        {candidates
                          .filter((c) => !c.voted)
                          .map(({ user }) => (
                            <option key={user.id} value={user.id}>
                              {user.name}（{user.grade}年
                              {user.is_manager ? "・マネ" : ""}）
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAdd(practice.id)}
                      disabled={!selectedUserId || busy}
                      className="flex-1 rounded-lg bg-brand-600 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      追加する
                    </button>
                    <button
                      onClick={() => {
                        setAddingFor(null);
                        setSelectedUserId("");
                      }}
                      className="flex-1 rounded-lg bg-gray-100 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-200"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setAddingFor(practice.id);
                    setSelectedUserId("");
                  }}
                  className="w-full rounded-lg border-2 border-dashed border-brand-300 py-2.5 text-sm font-semibold text-brand-600 hover:bg-brand-50"
                >
                  + 参加者を追加
                </button>
              )}
            </li>
          </ul>
        )}
      </section>
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      <AdminHeader title="結果・微調整" />

      <main className="flex-1 space-y-4 px-4 py-4 pb-44">
        {monthsError && <ErrorMessage message="対象月の取得に失敗しました" />}
        {resultsError && (
          <ErrorMessage
            message="結果の取得に失敗しました"
            onRetry={() => mutateResults()}
          />
        )}
        {actionError && <ErrorMessage message={actionError} />}

        {/* 月の切り替え */}
        {months && months.length > 1 && (
          <select
            value={monthId ?? ""}
            onChange={(e) => setSelectedMonthId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-bold text-gray-900 focus:border-brand-600 focus:outline-none"
          >
            {months.map((m) => (
              <option key={m.id} value={m.id}>
                {formatYearMonth(m.year_month)}
              </option>
            ))}
          </select>
        )}

        {/* 公開状態バナー */}
        {pm &&
          (published && pendingChanges > 0 ? (
            <div className="rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-yellow-800">
                <span className="shrink-0">
                  <TriangleAlertIcon width={18} height={18} />
                </span>
                未反映の変更が{pendingChanges}件あります。再公開するとメンバーに反映されます
              </p>
            </div>
          ) : published ? (
            <div className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-3">
              <p className="text-sm font-semibold text-blue-800">公開済み</p>
              <p className="mt-0.5 text-xs text-blue-700">
                微調整した内容は、再公開するまでメンバーには見えません
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-yellow-800">
                <span className="shrink-0">
                  <TriangleAlertIcon width={18} height={18} />
                </span>
                結果は未公開です。微調整が終わったら公開してください
              </p>
            </div>
          ))}

        {/* タブ切替 */}
        <div className="flex rounded-lg bg-gray-100 p-1">
          <button
            onClick={() => setTab("matrix")}
            className={`flex-1 rounded-md py-2 text-sm ${
              tab === "matrix"
                ? "bg-brand-600 font-bold text-white shadow-sm"
                : "font-semibold text-gray-500"
            }`}
          >
            一覧表
          </button>
          <button
            onClick={() => setTab("practice")}
            className={`flex-1 rounded-md py-2 text-sm ${
              tab === "practice"
                ? "bg-brand-600 font-bold text-white shadow-sm"
                : "font-semibold text-gray-500"
            }`}
          >
            練習日別
          </button>
          <button
            onClick={() => setTab("member")}
            className={`flex-1 rounded-md py-2 text-sm ${
              tab === "member"
                ? "bg-brand-600 font-bold text-white shadow-sm"
                : "font-semibold text-gray-500"
            }`}
          >
            メンバー別
          </button>
        </div>

        {!results && !resultsError && <Loading />}

        {results && tab === "practice" && (
          <div className="space-y-4">
            {results.by_practice.length === 0 && (
              <p className="py-8 text-center text-sm text-gray-500">
                結果がまだありません
              </p>
            )}
            {results.by_practice.map(renderPracticeSection)}
          </div>
        )}

        {results && tab === "member" && (
          <>
            {/* 88名が縦に並ぶため学年で絞り込む */}
            <div className="mb-3 flex items-center gap-2">
              <label htmlFor="grade-filter" className="text-sm font-semibold text-gray-600">
                表示
              </label>
              <select
                id="grade-filter"
                value={memberGrade}
                onChange={(e) => setMemberGrade(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
              >
                <option value="all">すべて（{results.by_member.length}名）</option>
                {[3, 2, 1].map((g) => {
                  const n = results.by_member.filter(
                    (m) => m.grade === g && !m.is_manager,
                  ).length;
                  return n ? (
                    <option key={g} value={String(g)}>
                      {g}年（{n}名）
                    </option>
                  ) : null;
                })}
                {results.by_member.some((m) => m.is_manager) && (
                  <option value="manager">
                    マネージャー（
                    {results.by_member.filter((m) => m.is_manager).length}名）
                  </option>
                )}
              </select>
            </div>

          <section className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
            {filteredMembers.length === 0 && (
              <p className="p-4 text-sm text-gray-500">該当するメンバーがいません</p>
            )}
            {filteredMembers.map((m) => {
              const open = openMemberId === m.user_id;
              return (
                <div key={m.user_id}>
                  <button
                    type="button"
                    onClick={() => setOpenMemberId(open ? null : m.user_id)}
                    className={`flex w-full items-center gap-2 px-4 py-2.5 text-left ${
                      open ? "bg-brand-50" : ""
                    }`}
                  >
                    <span className="flex-1 text-sm font-semibold text-gray-800">
                      {m.name}
                    </span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
                      {m.grade}年
                    </span>
                    {m.is_manager && (
                      <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
                        マネ
                      </span>
                    )}
                    {m.votes_count === 0 && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        未投票
                      </span>
                    )}
                    <span className="text-sm text-gray-500">
                      投票{m.votes_count} →{" "}
                      <span
                        className={
                          m.wins_count === 0
                            ? "font-bold text-red-600"
                            : "font-bold text-gray-800"
                        }
                      >
                        当選{m.wins_count}
                      </span>
                    </span>
                    <ChevronDownIcon
                      width={16}
                      height={16}
                      className={`shrink-0 text-gray-400 ${open ? "" : "-rotate-90"}`}
                    />
                  </button>

                  {/* 展開すると、その人の参加日をここで直接いじれる。
                      練習日別タブを行き来せずに1人分の調整を完結させる */}
                  {open && (
                    <div className="space-y-1.5 bg-brand-50 px-4 pt-1 pb-3">
                      {results.by_practice.map((pr) => {
                        const joining = pr.participants.find(
                          (x) => x.user_id === m.user_id,
                        );
                        const voted = m.voted_practice_ids.includes(pr.practice.id);
                        const players = pr.participants.filter((x) => !x.is_manager);
                        const full = players.length >= pr.practice.capacity;
                        return (
                          <div
                            key={pr.practice.id}
                            className="flex items-center gap-2 rounded-lg bg-white px-3 py-2"
                          >
                            <span className="w-20 shrink-0 text-sm font-bold text-gray-800">
                              {formatPracticeDate(pr.practice.practice_date)}
                            </span>
                            <span className="flex-1 truncate text-xs text-gray-500">
                              {players.length}/{pr.practice.capacity}名
                              {voted ? "" : "・未投票"}
                            </span>
                            {joining?.publish_state === "removing" ? (
                              <>
                                <span className="text-[10px] font-bold text-amber-700">
                                  削除予定
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleAddFor(pr.practice.id, m.user_id, m.name)
                                  }
                                  disabled={busy}
                                  className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700 disabled:opacity-50"
                                >
                                  戻す
                                </button>
                              </>
                            ) : joining ? (
                              <>
                                {published && joining.publish_state === "pending" && (
                                  <span className="text-[10px] font-bold text-amber-700">
                                    追加予定
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDelete(joining.assignment_id, m.name)
                                  }
                                  disabled={busy}
                                  className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-600 disabled:opacity-50"
                                >
                                  外す
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  handleAddFor(pr.practice.id, m.user_id, m.name)
                                }
                                disabled={busy}
                                className={`rounded-full px-3 py-1 text-xs font-bold disabled:opacity-50 ${
                                  full
                                    ? "bg-gray-100 text-gray-500"
                                    : "bg-brand-100 text-brand-700"
                                }`}
                              >
                                {full ? "追加（定員超過）" : "追加"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
          </>
        )}

        {results && tab === "matrix" && (
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            {results.by_practice.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">練習日がまだありません</p>
            ) : (
              <>
                {/* 学年の切り替え。人数が多い月は1学年ずつ見たほうが調整しやすい */}
                <div className="flex gap-1.5 overflow-x-auto border-b border-gray-100 px-3 py-2">
                  {[
                    { key: "all", label: "すべて" },
                    { key: "3", label: "3年" },
                    { key: "2", label: "2年" },
                    { key: "1", label: "1年" },
                    { key: "manager", label: "マネージャー" },
                  ]
                    .filter(({ key }) => filterByGrade(key).length > 0)
                    .map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setMatrixGrade(key);
                          setPickedRow(null); // 絞り込みをまたぐと行の選択は無効になる
                        }}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
                          matrixGrade === key
                            ? "bg-brand-600 text-white"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                </div>
                {/* 全体を見ながらマスを直接タップして付け外しする調整画面 */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-gray-100 px-3 py-2 text-[11px] text-gray-500">
                  <span>
                    <span className="font-bold text-brand-600">●</span> 参加
                    → タップで外す
                  </span>
                  <span>
                    <span className="font-bold text-gray-400">〇</span> 投票のみ
                    → タップで追加
                  </span>
                  <span>
                    <span className="text-gray-300">・</span> 投票なし
                  </span>
                  {published && (
                    <span className="text-amber-700">
                      <span className="font-bold">●</span> 追加予定{" "}
                      <span className="font-bold">×</span> 削除予定
                      （再公開で反映）
                    </span>
                  )}
                  <span className="text-gray-400">
                    名前・日付をタップすると行・列に色が付きます
                  </span>
                </div>
                <div className="max-h-[70vh] overflow-auto">
                  <table className="w-full border-collapse text-center text-xs">
                    <thead>
                      <tr>
                        <th className="sticky top-0 left-0 z-30 border-r border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-bold whitespace-nowrap text-gray-600">
                          名前
                        </th>
                        {results.by_practice.map((pr) => {
                          const players = pr.participants.filter(
                            (x) => !x.is_manager,
                          ).length;
                          const cap = pr.practice.capacity;
                          const tone =
                            players > cap
                              ? "text-gray-500"
                              : players === cap
                                ? "text-gray-400"
                                : "text-green-700";
                          const colPicked = pr.practice.id === pickedCol;
                          return (
                            <th
                              key={pr.practice.id}
                              className={`sticky top-0 z-20 min-w-[46px] border-b border-gray-200 p-0 ${
                                colPicked ? "bg-sky-100" : "bg-gray-50"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setPickedCol(colPicked ? null : pr.practice.id)
                                }
                                className={`w-full px-1 py-1 font-bold ${
                                  colPicked ? "text-sky-800" : "text-gray-600"
                                }`}
                              >
                                <div>{shortDate(pr.practice.practice_date)}</div>
                                {/* 定員との差をここで常に見せる。超過は赤、空きありは緑 */}
                                <div className={`text-[9px] leading-tight ${tone}`}>
                                  {players}/{cap}
                                </div>
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {matrixMembers.map((m, idx) => {
                        // 学年見出しは全員表示のときだけ入れる
                        const gradeHeader =
                          matrixGrade === "all" &&
                          (idx === 0 || matrixMembers[idx - 1].grade !== m.grade);
                        const rowPicked = m.user_id === pickedRow;
                        return (
                          <Fragment key={m.user_id}>
                            {gradeHeader && (
                              <tr className="bg-brand-50">
                                <td className="sticky left-0 z-10 border-r border-gray-200 bg-brand-50 px-2 py-1 text-left text-[10px] font-bold text-brand-700">
                                  {m.grade}年
                                </td>
                                <td
                                  colSpan={results.by_practice.length}
                                  className="bg-brand-50"
                                />
                              </tr>
                            )}
                            <tr
                              className={`border-b border-gray-100 ${
                                rowPicked ? "bg-sky-50" : ""
                              }`}
                            >
                              <td
                                className={`sticky left-0 z-10 border-r border-gray-200 p-0 ${
                                  rowPicked ? "bg-sky-50" : "bg-white"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPickedRow(rowPicked ? null : m.user_id)
                                  }
                                  className="w-full px-2 py-1 text-left whitespace-nowrap"
                                >
                                  <span
                                    className={`font-semibold ${
                                      rowPicked ? "text-sky-800" : "text-gray-800"
                                    }`}
                                  >
                                    {m.name}
                                  </span>
                                  {m.is_manager && (
                                    <span className="ml-1 text-[9px] text-gray-400">
                                      マネ
                                    </span>
                                  )}
                                  {m.votes_count === 0 && (
                                    <span className="ml-1 text-[9px] font-bold text-amber-700">
                                      未投票
                                    </span>
                                  )}
                                  {/* 今月と前月の当選/投票。外す人を選ぶ判断材料 */}
                                  {!m.is_manager && (
                                    <span className="ml-1 text-[9px] font-bold text-gray-600">
                                      {m.wins_count}/{m.votes_count}
                                    </span>
                                  )}
                                  {!m.is_manager && m.prev_votes_count > 0 && (
                                    <span className="ml-1 text-[9px] text-gray-500">
                                      先月{m.prev_wins_count}/{m.prev_votes_count}
                                    </span>
                                  )}
                                </button>
                              </td>
                              {results.by_practice.map((pr) => {
                                const joining = pr.participants.find(
                                  (x) => x.user_id === m.user_id,
                                );
                                const voted = m.voted_practice_ids.includes(
                                  pr.practice.id,
                                );
                                const colPicked = pr.practice.id === pickedCol;
                                // 行と列の交点はさらに濃くして、どこを見ているかを示す
                                const cellBg =
                                  rowPicked && colPicked
                                    ? "bg-sky-200"
                                    : colPicked
                                      ? "bg-sky-50"
                                      : "";
                                // 削除予定の人をもう一度タップすると取り消し (元に戻す)。
                                // それ以外は参加中なら外し、未参加なら追加する
                                const toggleCell = () => {
                                  if (joining && joining.publish_state !== "removing") {
                                    handleDelete(joining.assignment_id, m.name);
                                  } else {
                                    handleAddFor(
                                      pr.practice.id,
                                      m.user_id,
                                      m.name,
                                    );
                                  }
                                };
                                return (
                                  <td key={pr.practice.id} className={`p-0 ${cellBg}`}>
                                    <button
                                      type="button"
                                      onClick={toggleCell}
                                      disabled={busy}
                                      aria-label={`${m.name} ${shortDate(pr.practice.practice_date)}`}
                                      className="block w-full px-1 py-2 disabled:opacity-50"
                                    >
                                      {joining?.publish_state === "removing" ? (
                                        <span className="font-bold text-amber-600">
                                          ×
                                        </span>
                                      ) : joining?.publish_state === "pending" && published ? (
                                        <span className="font-bold text-amber-500">
                                          ●
                                        </span>
                                      ) : joining ? (
                                        <span className="font-bold text-brand-600">
                                          ●
                                        </span>
                                      ) : voted ? (
                                        <span className="font-bold text-gray-400">
                                          〇
                                        </span>
                                      ) : (
                                        <span className="text-gray-200">・</span>
                                      )}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}
      </main>

      {/* 下部固定: 公開ボタン（タブバーの上） */}
      <div className="fixed bottom-14 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t border-gray-200 bg-white/95 px-4 pt-3 pb-3 backdrop-blur">
        <button
          onClick={handlePublish}
          disabled={(published && pendingChanges === 0) || publishing || !pm}
          className="w-full rounded-xl bg-brand-600 py-4 text-lg font-bold text-white shadow-lg hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {publishing
            ? "公開中…"
            : published && pendingChanges > 0
              ? `変更を再公開する（${pendingChanges}件）`
              : published
                ? "公開済み"
                : "結果を公開する"}
        </button>
      </div>
    </div>
  );
}
