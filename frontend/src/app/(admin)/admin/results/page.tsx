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
  AssignedVia,
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

const VIA_BADGES: Record<AssignedVia, { label: string; className: string }> = {
  manager: { label: "マネ", className: "bg-gray-200 text-gray-600" },
  grade3: { label: "3年確定", className: "bg-brand-100 text-brand-700" },
  guaranteed: { label: "保証", className: "bg-green-100 text-green-700" },
  distribution: { label: "配分", className: "bg-blue-100 text-blue-700" },
  overflow: { label: "流込", className: "bg-cyan-100 text-cyan-700" },
  manual: { label: "手動", className: "bg-orange-100 text-orange-700" },
};

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
  const [openPracticeIds, setOpenPracticeIds] = useState<Set<string>>(new Set());
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [capacityWarnings, setCapacityWarnings] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [busy, setBusy] = useState(false);

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
    const candidates =
      roster?.items.filter((u) => !assignedUserIds.has(u.id)) ?? [];

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
            {participants.map((p) => {
              const via = VIA_BADGES[p.assigned_via];
              return (
                <li key={p.assignment_id} className="flex items-center gap-2 px-4 py-2.5">
                  <span className="flex-1 text-sm font-semibold text-gray-800">
                    {p.name}
                  </span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
                    {p.grade}年
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${via.className}`}
                  >
                    {via.label}
                  </span>
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
                    {candidates.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}（{u.grade}年{u.is_manager ? "・マネ" : ""}）
                      </option>
                    ))}
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
          <section className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
            {results.by_member.length === 0 && (
              <p className="p-4 text-sm text-gray-500">結果がまだありません</p>
            )}
            {results.by_member.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2 px-4 py-2.5">
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
              </div>
            ))}
          </section>
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
