"use client";

// 投票画面 — 画面設計書 vote-mobile.html 対応
import { useState } from "react";
import { MemberHeader } from "@/components/member/header";
import { ErrorMessage } from "@/components/ui/error-message";
import { CheckIcon, ClockIcon } from "@/components/ui/icons";
import { Loading } from "@/components/ui/loading";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useRequireAuth } from "@/hooks/use-auth";
import type { PracticeMonth, PracticeMonthDetail, VoteStatus } from "@/types/api";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** "2026-08-24" → "8/24(月)" */
function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

/** ISO日時 → "8/20(木) 23:59" */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${hh}:${mm}`;
}

export default function VotePage() {
  const { user, isLoading: authLoading } = useRequireAuth();

  const {
    data: months,
    error: monthsError,
    isLoading: monthsLoading,
    mutate: mutateMonths,
  } = useApi<PracticeMonth[]>("/v1/practice-months");

  const currentMonth = months?.[0];

  const {
    data: detail,
    error: detailError,
    isLoading: detailLoading,
    mutate: mutateDetail,
  } = useApi<PracticeMonthDetail>(
    currentMonth ? `/v1/practice-months/${currentMonth.id}` : null,
  );

  const { data: voteStatus, mutate: mutateVoteStatus } = useApi<VoteStatus>(
    currentMonth ? `/v1/practice-months/${currentMonth.id}/votes/me` : null,
  );

  // ユーザーが変更するまでは既存投票 (VoteStatus) を初期選択として表示する
  const [localSelection, setLocalSelection] = useState<string[] | null>(null);
  const selectedIds = localSelection ?? voteStatus?.voted_practice_ids ?? [];
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const editable = voteStatus?.editable ?? false;

  const toggle = (practiceId: string) => {
    if (!editable) return;
    setSuccessMessage(null);
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
    setSuccessMessage(null);
    try {
      await apiClient.put<VoteStatus>(
        `/v1/practice-months/${currentMonth.id}/votes/me`,
        { practice_ids: selectedIds },
      );
      await mutateVoteStatus();
      setLocalSelection(null); // サーバー側の最新投票内容に同期
      setSuccessMessage("投票内容を保存しました");
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
      <>
        <MemberHeader title="投票" />
        <Loading />
      </>
    );
  }

  if (monthsError) {
    return (
      <>
        <MemberHeader title="投票" />
        <main className="px-4 pt-4">
          <ErrorMessage
            message="練習情報の取得に失敗しました"
            onRetry={() => mutateMonths()}
          />
        </main>
      </>
    );
  }

  if (!currentMonth) {
    return (
      <>
        <MemberHeader title="投票" />
        <main className="px-4 pt-4">
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm text-gray-500">練習が登録されていません</p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <MemberHeader title="投票" />

      {/* 締切バナー */}
      <div className="flex items-center gap-2 border-b border-yellow-200 bg-yellow-50 px-4 py-2.5">
        <ClockIcon width={18} height={18} className="shrink-0 text-yellow-700" />
        <p className="text-sm font-semibold text-yellow-800">
          投票締切: {formatDateTime(currentMonth.vote_ends_at)}
          {!editable && "（締切済み）"}
        </p>
      </div>

      <main className="space-y-3 px-4 pt-4 pb-40">
        <p className="text-sm text-gray-600">
          {editable
            ? "参加したい練習日を選んでください（複数選択可）"
            : "投票は締切済みのため変更できません"}
        </p>

        {detailLoading && <Loading />}
        {detailError && (
          <ErrorMessage
            message="練習日の取得に失敗しました"
            onRetry={() => mutateDetail()}
          />
        )}

        {detail && detail.practices.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm text-gray-500">練習が登録されていません</p>
          </div>
        )}

        {detail?.practices.map((practice) => {
          const selected = selectedIds.includes(practice.id);
          return (
            <button
              key={practice.id}
              type="button"
              onClick={() => toggle(practice.id)}
              disabled={!editable}
              className={`block w-full rounded-xl border-2 p-4 text-left ${
                selected
                  ? "border-brand-600 bg-brand-50"
                  : "border-gray-200 bg-white"
              } ${editable ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    selected
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-gray-300 bg-white"
                  }`}
                >
                  {selected && <CheckIcon width={14} height={14} />}
                </span>
                <span className="flex-1">
                  <span className="block text-base font-bold text-gray-900">
                    {formatDate(practice.practice_date)} {practice.starts_at}-
                    {practice.ends_at}
                  </span>
                  <span className="mt-0.5 block text-sm text-gray-600">
                    {practice.location} ・ 定員{practice.capacity}名
                  </span>
                </span>
              </div>
            </button>
          );
        })}

        {submitError && <ErrorMessage message={submitError} />}
        {successMessage && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-sm text-green-800">{successMessage}</p>
          </div>
        )}
      </main>

      {/* 下部固定ボタン（タブバーの上） */}
      <div className="fixed bottom-[57px] left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t border-gray-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={submit}
          disabled={!editable || isSubmitting}
          className="w-full rounded-lg bg-brand-600 py-3.5 text-sm font-semibold text-white hover:bg-brand-700 active:bg-brand-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {!editable
            ? "締切済み"
            : isSubmitting
              ? "送信中..."
              : `この内容で投票する（${selectedIds.length}日選択中）`}
        </button>
      </div>
    </>
  );
}
