"use client";

// メンバーホーム — 画面設計書 home-mobile.html 対応
import Link from "next/link";
import { MemberHeader } from "@/components/member/header";
import { ErrorMessage } from "@/components/ui/error-message";
import { Loading } from "@/components/ui/loading";
import { useApi } from "@/hooks/use-api";
import { useRequireAuth } from "@/hooks/use-auth";
import type { MyResults, PracticeMonth, VoteStatus } from "@/types/api";

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

/** "2026-08" → "2026年8月" */
function formatYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}年${Number(m)}月`;
}

export default function HomePage() {
  const { user, isLoading: authLoading } = useRequireAuth();

  const {
    data: months,
    error: monthsError,
    isLoading: monthsLoading,
    mutate: mutateMonths,
  } = useApi<PracticeMonth[]>("/v1/practice-months");

  const currentMonth = months?.[0];

  const { data: voteStatus } = useApi<VoteStatus>(
    currentMonth ? `/v1/practice-months/${currentMonth.id}/votes/me` : null,
  );

  const { data: myResults, error: resultsError } = useApi<MyResults>(
    currentMonth ? `/v1/practice-months/${currentMonth.id}/results/me` : null,
  );

  if (authLoading || !user) {
    return (
      <>
        <MemberHeader title="練習抽選システム" />
        <Loading />
      </>
    );
  }

  const resultsNotPublished = resultsError?.status === 404;
  const assignments = myResults?.assignments ?? [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextPractice =
    assignments
      .map((a) => a.practice)
      .filter((p) => new Date(`${p.practice_date}T00:00:00`) >= today)
      .sort((a, b) => a.practice_date.localeCompare(b.practice_date))[0] ?? null;

  return (
    <>
      <MemberHeader title="練習抽選システム" />
      <main className="space-y-4 px-4 pt-4 pb-24">
        {/* あいさつ */}
        <p className="text-base text-gray-700">
          こんにちは、<span className="font-bold text-gray-900">{user.name}</span>さん
        </p>

        {monthsLoading && <Loading />}
        {monthsError && (
          <ErrorMessage
            message="練習情報の取得に失敗しました"
            onRetry={() => mutateMonths()}
          />
        )}

        {!monthsLoading && !monthsError && !currentMonth && (
          <section className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm text-gray-500">練習が登録されていません</p>
          </section>
        )}

        {currentMonth && (
          <>
            {/* カード1: 今月の投票 */}
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold text-gray-900">
                  {formatYearMonth(currentMonth.year_month)}の投票
                </h2>
                {currentMonth.status === "published" ? (
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    結果公開済み
                  </span>
                ) : voteStatus?.editable ? (
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
                    投票受付中
                  </span>
                ) : null}
              </div>
              <div className="mb-4 space-y-1">
                <p className="text-sm text-gray-700">
                  投票済み:{" "}
                  <span className="font-semibold text-brand-600">
                    {voteStatus ? voteStatus.voted_practice_ids.length : 0}日選択
                  </span>
                </p>
                <p className="text-sm text-gray-500">
                  締切: {formatDateTime(currentMonth.vote_ends_at)} まで
                </p>
              </div>
              <Link
                href="/vote"
                className="block w-full rounded-lg bg-brand-600 py-3 text-center text-sm font-semibold text-white hover:bg-brand-700 active:bg-brand-800"
              >
                投票内容を変更する
              </Link>
            </section>

            {/* カード2: 次の参加練習 */}
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-bold text-gray-900">次の参加練習</h2>
              {resultsNotPublished || !myResults ? (
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-center">
                  <p className="text-sm text-gray-500">抽選結果はまだ公開されていません</p>
                </div>
              ) : nextPractice ? (
                <div className="rounded-lg border border-brand-100 bg-brand-50 p-4 text-center">
                  <p className="text-2xl font-bold text-brand-700">
                    {formatDate(nextPractice.practice_date)}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-gray-800">
                    {nextPractice.starts_at}-{nextPractice.ends_at}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">{nextPractice.location}</p>
                </div>
              ) : (
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-center">
                  <p className="text-sm text-gray-500">参加予定の練習はありません</p>
                </div>
              )}
            </section>

            {/* カード3: 今月の参加予定 */}
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-bold text-gray-900">今月の参加予定</h2>
              {resultsNotPublished || !myResults ? (
                <p className="py-2 text-sm text-gray-500">
                  抽選結果はまだ公開されていません
                </p>
              ) : assignments.length === 0 ? (
                <p className="py-2 text-sm text-gray-500">参加予定はありません</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {assignments.map(({ practice }) => (
                    <li
                      key={practice.id}
                      className="flex items-center justify-between py-2.5"
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-800">
                          {formatDate(practice.practice_date)} {practice.starts_at}-
                          {practice.ends_at}
                        </p>
                        <p className="text-xs text-gray-500">{practice.location}</p>
                      </div>
                      <span className="text-xs font-medium text-brand-600">参加確定</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
