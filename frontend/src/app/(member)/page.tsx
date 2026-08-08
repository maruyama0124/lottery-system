"use client";

// メンバー画面 — これ1枚だけ (D-022)
// 投票受付中は投票フォーム、締切後は抽選待ち、公開後は当選日。
// メンバーがやることは「投票する」「結果を見る」の2つだけなので画面を分けない。
import Link from "next/link";
import { useState } from "react";
import { ParticipationTable } from "@/components/member/participation-table";
import { Quasar } from "@/components/quasar";
import { ErrorMessage } from "@/components/ui/error-message";
import { Loading } from "@/components/ui/loading";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useRequireAuth } from "@/hooks/use-auth";
import type {
  MyResults,
  ParticipationTable as ParticipationTableData,
  PracticeMonth,
  PracticeMonthDetail,
  VoteStatus,
} from "@/types/api";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** "2026-08-24" → "8/24(月)" */
function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

/** ISO日時 → "8/20(木)" */
function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

/** "08:00:00" → "8:00" */
function formatTime(t: string): string {
  const [h, m] = t.split(":");
  return `${Number(h)}:${m}`;
}

export default function MemberPage() {
  const { user, isLoading: authLoading } = useRequireAuth();

  const {
    data: months,
    error: monthsError,
    isLoading: monthsLoading,
    mutate: mutateMonths,
  } = useApi<PracticeMonth[]>("/v1/practice-months");

  const currentMonth = months?.[0];

  const { data: detail } = useApi<PracticeMonthDetail>(
    currentMonth ? `/v1/practice-months/${currentMonth.id}` : null,
  );
  const { data: voteStatus, mutate: mutateVoteStatus } = useApi<VoteStatus>(
    currentMonth ? `/v1/practice-months/${currentMonth.id}/votes/me` : null,
  );
  const { data: myResults } = useApi<MyResults>(
    currentMonth ? `/v1/practice-months/${currentMonth.id}/results/me` : null,
  );
  // 参加表は公開後のみ取得できる (公開前は 404 が返る)
  const { data: participation } = useApi<ParticipationTableData>(
    currentMonth?.status === "published"
      ? `/v1/practice-months/${currentMonth.id}/participation`
      : null,
  );

  // ユーザーが触るまではサーバー上の投票内容を表示する
  const [localSelection, setLocalSelection] = useState<string[] | null>(null);
  const selectedIds = localSelection ?? voteStatus?.voted_practice_ids ?? [];
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // 結果公開後の表示切り替え。既定は自分の参加日
  const [resultTab, setResultTab] = useState<"mine" | "all">("mine");

  const editable = voteStatus?.editable ?? false;
  const published = currentMonth?.status === "published";

  const toggle = (practiceId: string) => {
    if (!editable) return;
    setSaved(false);
    setLocalSelection(
      selectedIds.includes(practiceId)
        ? selectedIds.filter((id) => id !== practiceId)
        : [...selectedIds, practiceId],
    );
  };

  const submit = async () => {
    if (!currentMonth || !editable || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await apiClient.put<VoteStatus>(
        `/v1/practice-months/${currentMonth.id}/votes/me`,
        { practice_ids: selectedIds },
      );
      await mutateVoteStatus();
      setLocalSelection(null);
      setSaved(true);
    } catch (e) {
      setSubmitError(
        e instanceof ApiClientError ? e.message : "投票の保存に失敗しました",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || !user || monthsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading />
      </div>
    );
  }

  const assignments = myResults?.assignments ?? [];

  return (
    <div className="min-h-screen pb-32">
      <Header userName={user.name} isRep={user.role === "representative"} />

      <main className="space-y-5 px-4">
        {monthsError && (
          <ErrorMessage
            message="練習情報を取得できませんでした"
            onRetry={() => mutateMonths()}
          />
        )}

        {!monthsError && !currentMonth && (
          <Card>
            <div className="py-6 text-center">
              <p className="font-bold text-gray-700">練習が登録されていません</p>
              <p className="mt-1 text-sm text-gray-500">
                代表が登録すると表示されます
              </p>
            </div>
          </Card>
        )}

        {/* 結果公開後 — 自分の参加日と全員の参加表をタブで切り替える (D-025)。
            縦に並べると参加表まで毎回スクロールすることになるため */}
        {currentMonth && published && (
          <>
            <div className="flex gap-2">
              {(
                [
                  { key: "mine", label: "自分の参加日" },
                  { key: "all", label: "練習参加表" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setResultTab(t.key)}
                  className={`flex-1 rounded-full py-2.5 text-sm font-bold transition-colors ${
                    resultTab === t.key
                      ? "bg-brand-600 text-white"
                      : "border-2 border-gray-200 bg-white text-gray-500"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {resultTab === "mine" ? (
              <Card>
                {/* 1件を1行に収める。縦に伸ばさず一覧性を優先する */}
                <p className="mb-3 font-bold text-gray-900">
                  {assignments.length > 0
                    ? `参加する練習 ${assignments.length}日`
                    : "今月の参加はありません"}
                </p>
                {assignments.length > 0 && (
                  <ul className="divide-y divide-gray-100">
                    {assignments.map(({ practice }) => (
                      <li
                        key={practice.id}
                        className="flex items-baseline gap-3 py-2.5"
                      >
                        <span className="w-20 shrink-0 font-bold text-accent-700">
                          {formatDate(practice.practice_date)}
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-gray-700">
                          {formatTime(practice.starts_at)}〜{formatTime(practice.ends_at)}
                        </span>
                        <span className="truncate text-sm text-gray-500">
                          {practice.location}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : participation ? (
              <ParticipationTable
                data={participation}
                currentUserId={user.id}
                currentUserGrade={user.grade}
                currentUserIsManager={user.is_manager}
              />
            ) : (
              <Card>
                <Loading />
              </Card>
            )}
          </>
        )}

        {/* 締切後・結果未公開 — 抽選待ち */}
        {currentMonth && !published && !editable && (
          <Card>
            <div className="py-6 text-center">
              <p className="font-bold text-gray-700">抽選結果を待っています</p>
              <p className="mt-1 text-sm text-gray-500">
                公開されると表示されます
              </p>
            </div>
          </Card>
        )}

        {/* 投票受付中 */}
        {currentMonth && editable && (
          <>
            <Card>
              <p className="font-bold text-gray-900">
                {saved ? "投票を保存しました" : "参加できる日を選択してください"}
              </p>
              <p className="mt-0.5 text-sm text-gray-500">
                {formatDeadline(currentMonth.vote_ends_at)}まで
                {saved ? "は何度でも変更できます" : "に送信してください"}
              </p>
            </Card>

            <div className="space-y-2">
              {detail?.practices.map((practice) => {
                const selected = selectedIds.includes(practice.id);
                // 学年限定の日 (D-037)。対象外なら選べない。マネージャーは制限なし
                const votable =
                  user.is_manager ||
                  !practice.allowed_grades ||
                  practice.allowed_grades.includes(user.grade);
                if (!votable) {
                  return (
                    <div
                      key={practice.id}
                      className="flex w-full items-center gap-2.5 rounded-2xl border-2 border-transparent bg-white px-3 py-2.5 opacity-60"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-gray-100 text-transparent">
                        ✓
                      </span>
                      <span className="w-20 shrink-0 font-bold text-gray-400">
                        {formatDate(practice.practice_date)}
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-gray-400">
                        {formatTime(practice.starts_at)}〜{formatTime(practice.ends_at)}
                      </span>
                      <span className="ml-auto shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
                        {[...practice.allowed_grades!].sort().join("・")}年限定
                      </span>
                    </div>
                  );
                }
                return (
                  <button
                    key={practice.id}
                    type="button"
                    onClick={() => toggle(practice.id)}
                    className={`flex w-full items-center gap-2.5 rounded-2xl border-2 px-3 py-2.5 text-left transition-colors ${
                      selected
                        ? "border-brand-500 bg-brand-50"
                        : "border-transparent bg-white"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        selected
                          ? "bg-brand-600 text-white"
                          : "border-2 border-gray-200 text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    <span className="w-20 shrink-0 font-bold text-gray-900">
                      {formatDate(practice.practice_date)}
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-gray-600">
                      {formatTime(practice.starts_at)}〜{formatTime(practice.ends_at)}
                    </span>
                    <span className="truncate text-sm text-gray-500">
                      {practice.location}
                    </span>
                  </button>
                );
              })}
            </div>

            {submitError && <ErrorMessage message={submitError} />}
          </>
        )}
      </main>

      {/* 投票ボタン（投票期間中のみ） */}
      {currentMonth && editable && (
        <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 bg-brand-50 px-4 pb-5 pt-8">
          <button
            type="button"
            onClick={submit}
            disabled={isSubmitting}
            className="w-full rounded-full bg-brand-600 py-4 text-base font-bold text-white shadow-lg shadow-brand-200 active:scale-[0.98] disabled:opacity-60"
          >
            {isSubmitting
              ? "送信中..."
              : selectedIds.length === 0
                ? "選択せずに送信"
                : `${selectedIds.length}日を送信`}
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ userName, isRep }: { userName: string; isRep: boolean }) {
  return (
    <header className="px-4 pb-5 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Quasar mood="normal" size={44} className="shrink-0" />
          <div>
            <p className="text-lg font-bold text-brand-700">練習抽選bot クエーさん</p>
            <p className="mt-0.5 text-sm text-gray-500">{userName} さん</p>
          </div>
        </div>
        {isRep && (
          <Link
            href="/admin"
            className="rounded-full bg-white px-4 py-2 text-sm font-bold text-brand-600 shadow-sm"
          >
            管理画面
          </Link>
        )}
      </div>
    </header>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm">{children}</section>
  );
}
