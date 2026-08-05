"use client";

// 抽選結果画面 — 画面設計書 my-results-mobile.html 対応
import { useState } from "react";
import { MemberHeader } from "@/components/member/header";
import { ErrorMessage } from "@/components/ui/error-message";
import { MapPinIcon } from "@/components/ui/icons";
import { Loading } from "@/components/ui/loading";
import { useApi } from "@/hooks/use-api";
import { useRequireAuth } from "@/hooks/use-auth";
import type {
  MyResults,
  PracticeMonth,
  PracticeMonthDetail,
  VoteStatus,
} from "@/types/api";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** "2026-08-24" → { md: "8/24", dow: "(月)" } */
function splitDate(dateStr: string): { md: string; dow: string } {
  const d = new Date(`${dateStr}T00:00:00`);
  return {
    md: `${d.getMonth() + 1}/${d.getDate()}`,
    dow: `(${WEEKDAYS[d.getDay()]})`,
  };
}

/** "2026-08-24" → "8/24(月)" */
function formatDate(dateStr: string): string {
  const { md, dow } = splitDate(dateStr);
  return `${md}${dow}`;
}

/** "2026-08" → "2026年8月" */
function formatYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}年${Number(m)}月`;
}

export default function ResultsPage() {
  const { user, isLoading: authLoading } = useRequireAuth();

  const {
    data: months,
    error: monthsError,
    isLoading: monthsLoading,
    mutate: mutateMonths,
  } = useApi<PracticeMonth[]>("/v1/practice-months");

  const [selectedMonthId, setSelectedMonthId] = useState<string | null>(null);
  // 初期値 = 先頭 (year_month 降順)
  const monthId = selectedMonthId ?? months?.[0]?.id ?? null;

  const {
    data: myResults,
    error: resultsError,
    isLoading: resultsLoading,
  } = useApi<MyResults>(monthId ? `/v1/practice-months/${monthId}/results/me` : null);

  const { data: voteStatus } = useApi<VoteStatus>(
    monthId ? `/v1/practice-months/${monthId}/votes/me` : null,
  );

  const { data: detail } = useApi<PracticeMonthDetail>(
    monthId ? `/v1/practice-months/${monthId}` : null,
  );

  if (authLoading || !user || monthsLoading) {
    return (
      <>
        <MemberHeader title="抽選結果" />
        <Loading />
      </>
    );
  }

  if (monthsError) {
    return (
      <>
        <MemberHeader title="抽選結果" />
        <main className="px-4 py-5">
          <ErrorMessage
            message="練習情報の取得に失敗しました"
            onRetry={() => mutateMonths()}
          />
        </main>
      </>
    );
  }

  if (!months || months.length === 0) {
    return (
      <>
        <MemberHeader title="抽選結果" />
        <main className="px-4 py-5">
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm text-gray-500">練習が登録されていません</p>
          </div>
        </main>
      </>
    );
  }

  const notPublished = resultsError?.status === 404;
  const assignments = myResults?.assignments ?? [];
  const wonPracticeIds = new Set(assignments.map((a) => a.practice.id));
  const lostPractices = (detail?.practices ?? []).filter(
    (p) =>
      (voteStatus?.voted_practice_ids ?? []).includes(p.id) &&
      !wonPracticeIds.has(p.id),
  );

  return (
    <>
      <MemberHeader title="抽選結果" />
      <main className="px-4 py-5">
        {/* 月セレクタ */}
        <div className="mb-4 flex items-center justify-between">
          <label htmlFor="month-select" className="text-sm font-semibold text-gray-700">
            対象月
          </label>
          <select
            id="month-select"
            value={monthId ?? ""}
            onChange={(e) => setSelectedMonthId(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:ring-2 focus:ring-brand-600 focus:outline-none"
          >
            {months.map((m) => (
              <option key={m.id} value={m.id}>
                {formatYearMonth(m.year_month)}
              </option>
            ))}
          </select>
        </div>

        {resultsLoading && <Loading />}

        {!resultsLoading && resultsError && !notPublished && (
          <ErrorMessage message="抽選結果の取得に失敗しました" />
        )}

        {!resultsLoading && notPublished && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
            <p className="text-sm text-gray-500">結果はまだ公開されていません</p>
          </div>
        )}

        {!resultsLoading && myResults && (
          <>
            {/* 公開ステータス */}
            <div className="mb-4">
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                公開済み
              </span>
            </div>

            {/* サマリー */}
            <div className="mb-6 rounded-xl border border-brand-100 bg-brand-50 p-4">
              <p className="text-sm text-brand-900">
                あなたは{" "}
                <span className="text-2xl font-bold text-brand-700">
                  {detail ? `${detail.practices.length}日中 ` : ""}
                  {assignments.length}日
                </span>{" "}
                当選しました
                {voteStatus && (
                  <span className="ml-1 text-xs text-brand-600">
                    （投票: {voteStatus.voted_practice_ids.length}日）
                  </span>
                )}
              </p>
            </div>

            {/* 当選した参加日 */}
            <h2 className="mb-3 text-sm font-semibold text-gray-500">当選した参加日</h2>
            {assignments.length === 0 && (
              <p className="mb-6 text-sm text-gray-500">当選した練習はありません</p>
            )}
            {assignments.map(({ practice }, i) => {
              const { md, dow } = splitDate(practice.practice_date);
              return (
                <div
                  key={practice.id}
                  className={`flex items-center gap-4 rounded-r-xl border-l-4 border-brand-600 bg-white p-4 shadow-sm ring-1 ring-gray-100 ${
                    i === assignments.length - 1 ? "mb-6" : "mb-3"
                  }`}
                >
                  <div className="shrink-0 text-center">
                    <div className="text-3xl leading-none font-bold text-brand-600">
                      {md}
                    </div>
                    <div className="mt-1 text-xs text-brand-500">{dow}</div>
                  </div>
                  <div className="border-l border-gray-200 pl-4">
                    <div className="text-sm font-semibold text-gray-900">
                      {practice.starts_at}-{practice.ends_at}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-sm text-gray-600">
                      <MapPinIcon width={14} height={14} className="shrink-0" />
                      {practice.location}
                    </div>
                    <span className="mt-1.5 inline-block rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
                      当選
                    </span>
                  </div>
                </div>
              );
            })}

            {/* 落選した日 */}
            {lostPractices.length > 0 && (
              <>
                <h2 className="mb-3 text-sm font-semibold text-gray-500">落選した日</h2>
                <ul className="divide-y divide-gray-200 rounded-xl bg-gray-50">
                  {lostPractices.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <span className="text-sm text-gray-500">
                        {formatDate(p.practice_date)} — 落選
                      </span>
                      <span className="text-xs text-gray-400">
                        次回の当選確率が上がります
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
