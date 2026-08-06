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

type Tab = "practice" | "member" | "matrix";

export default function AdminResultsPage() {
  const { user, isLoading: authLoading } = useRequireRepresentative();

  const { data: months, error: monthsError } = useApi<PracticeMonth[]>(
    user ? "/v1/practice-months" : null,
  );
  const monthId = months?.[0]?.id ?? null;

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

  const [tab, setTab] = useState<Tab>("practice");
  // メンバー別タブの学年絞り込み ("all" | "3" | "2" | "1" | "manager")
  const [memberGrade, setMemberGrade] = useState("all");
  // メンバー別タブで展開中の1名。その人の参加日をここで直接調整する
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const [openPracticeIds, setOpenPracticeIds] = useState<Set<string>>(new Set());
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [capacityWarnings, setCapacityWarnings] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [busy, setBusy] = useState(false);

  // メンバー別タブの絞り込み結果。マネージャーは学年に関係なく1つにまとめる
  const filteredMembers = (results?.by_member ?? []).filter((m) => {
    if (memberGrade === "all") return true;
    if (memberGrade === "manager") return m.is_manager;
    return !m.is_manager && String(m.grade) === memberGrade;
  });

  const toggleOpen = (practiceId: string) => {
    setOpenPracticeIds((prev) => {
      const next = new Set(prev);
      if (next.has(practiceId)) next.delete(practiceId);
      else next.add(practiceId);
      return next;
    });
  };

  const handleDelete = async (assignmentId: string, name: string) => {
    if (busy) return;
    if (!window.confirm(`${name}さんをこの練習から外しますか？`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiClient.delete<void>(`/v1/assignments/${assignmentId}`);
      await mutateResults();
    } catch (e) {
      setActionError(
        e instanceof ApiClientError ? e.error.message : "削除に失敗しました",
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

  const handlePublish = async () => {
    if (!monthId || publishing) return;
    if (!window.confirm("結果を公開しますか？公開後は全メンバーが閲覧できます")) return;
    setPublishing(true);
    setActionError(null);
    try {
      await apiClient.post<void>(`/v1/practice-months/${monthId}/publish`);
      await mutatePm();
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

  const published = pm?.status === "published";

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
            : over
              ? "border border-red-200"
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
                    over ? "bg-red-500" : full ? "bg-gray-400" : "bg-green-500"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {over ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600">
                  <TriangleAlertIcon width={14} height={14} />
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
                  <button
                    onClick={() => handleDelete(p.assignment_id, p.name)}
                    aria-label={`${p.name}を削除`}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <XIcon width={16} height={16} />
                  </button>
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

        {/* 公開状態バナー */}
        {pm &&
          (published ? (
            <div className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-3">
              <p className="text-sm font-semibold text-blue-800">公開済み</p>
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
                            {joining ? (
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
            {results.by_member.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">結果がまだありません</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-center text-xs">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="sticky left-0 z-10 border-r border-gray-200 bg-gray-50 px-2 py-2 text-left font-bold whitespace-nowrap text-gray-600">
                        名前
                      </th>
                      {results.by_practice.map((pr) => (
                        <th
                          key={pr.practice.id}
                          className="min-w-[42px] px-1 py-2 font-bold text-gray-600"
                        >
                          {shortDate(pr.practice.practice_date)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.by_member.map((m, idx) => {
                      const won = new Set(m.practice_ids);
                      const gradeHeader =
                        idx === 0 ||
                        results.by_member[idx - 1].grade !== m.grade;
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
                          <tr className="border-b border-gray-100">
                            <td className="sticky left-0 z-10 border-r border-gray-200 bg-white px-2 py-1.5 text-left font-semibold whitespace-nowrap text-gray-800">
                              {m.name}
                              {m.is_manager && (
                                <span className="ml-1 text-[9px] text-gray-400">
                                  マネ
                                </span>
                              )}
                            </td>
                            {results.by_practice.map((pr) => (
                              <td key={pr.practice.id} className="px-1 py-1.5">
                                {won.has(pr.practice.id) ? (
                                  <span className="font-bold text-brand-600">
                                    〇
                                  </span>
                                ) : (
                                  <span className="text-gray-200">・</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-50">
                      <td className="sticky left-0 z-10 border-r border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-bold whitespace-nowrap text-gray-600">
                        合計
                      </td>
                      {results.by_practice.map((pr) => (
                        <td
                          key={pr.practice.id}
                          className="px-1 py-1.5 font-bold text-gray-700"
                        >
                          {
                            results.by_member.filter((m) =>
                              m.practice_ids.includes(pr.practice.id),
                            ).length
                          }
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      {/* 下部固定: 公開ボタン（タブバーの上） */}
      <div className="fixed bottom-14 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t border-gray-200 bg-white/95 px-4 pt-3 pb-3 backdrop-blur">
        <button
          onClick={handlePublish}
          disabled={published || publishing || !pm}
          className="w-full rounded-xl bg-brand-600 py-4 text-lg font-bold text-white shadow-lg hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {published ? "公開済み" : publishing ? "公開中…" : "結果を公開する"}
        </button>
      </div>
    </div>
  );
}
