"use client";

// メンバー画面 — これ1枚だけ (D-022)
// 投票受付中は投票フォーム、締切後は抽選待ち、公開後は当選日。
// 確定日だけ先行公開した月は、公開結果と未確定日の投票を併せて表示する。
// メンバーがやることは「投票する」「結果を見る」の2つだけなので画面を分けない。
import Link from "next/link";
import { useEffect, useState } from "react";
import { ParticipationTable } from "@/components/member/participation-table";
import { Quasar } from "@/components/quasar";
import { ErrorMessage } from "@/components/ui/error-message";
import { Loading } from "@/components/ui/loading";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { useMemberHome } from "@/hooks/use-member-home";
import { useRequireAuth } from "@/hooks/use-auth";
import type { MemberHome } from "@/lib/member-home";

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

/** "2026-09" → "2026年9月" */
function formatYearMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
}

export default function MemberPage() {
  const { user, isLoading: authLoading } = useRequireAuth();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 男女どちらの予定を見るか (D-038)。既定は自分の性別
  const [viewGender, setViewGender] = useState<"male" | "female" | null>(null);
  const gender = viewGender ?? user?.gender ?? null;
  // 閲覧専用 (D-039) は自分の性別でも読み取り表示にする
  const ownView = !!user && gender === user.gender && !user.is_observer;
  // 過去の月も選べる (既定は最新月)
  const [selectedMonthId, setSelectedMonthId] = useState<string | null>(null);

  const home = useMemberHome(user, gender, selectedMonthId);
  const refreshHome = home.refresh;
  const { months, detail, voteStatus, myResults, participation } = home.data ?? {};
  const currentMonth = detail;
  const selectionKey = `${user?.id}:${gender}:${currentMonth?.id}`;

  // ユーザーが触るまではサーバー上の投票内容を表示する
  const [localSelection, setLocalSelection] = useState<{
    key: string; ids: string[]; dirty: boolean; baseline: MemberHome | undefined;
  } | null>(null);
  const keepSelection = localSelection?.key === selectionKey &&
    (localSelection.dirty || home.stale || home.refreshing || localSelection.baseline === home.data);
  const lockedIds = voteStatus?.locked_practice_ids ?? [];
  const draftIds = keepSelection ? localSelection.ids : voteStatus?.voted_practice_ids ?? [];
  // 編集中に固定日が増えても、その日だけは最新のサーバー投票へ追従する。
  // 未確定日の編集中の選択は保持する。
  const selectedIds = [
    ...draftIds.filter((id) => !lockedIds.includes(id)),
    ...(voteStatus?.voted_practice_ids ?? []).filter((id) => lockedIds.includes(id)),
  ];
  const editableSelectedCount = selectedIds.filter((id) => !lockedIds.includes(id)).length;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // 結果公開後の表示切り替え。既定は自分の参加日
  const [resultTab, setResultTab] = useState<"mine" | "all">("mine");

  const inVoteWindow = currentMonth && now >= Date.parse(currentMonth.vote_starts_at) && now <= Date.parse(currentMonth.vote_ends_at);
  const editable = ownView && inVoteWindow && (voteStatus?.editable ?? false);
  const published = currentMonth?.status === "published";
  const showVoting = ownView && currentMonth && inVoteWindow && (!published || editable);

  // ページを開いたまま受付開始時刻を迎えた場合も、公開月の投票可否を取得する。
  useEffect(() => {
    if (ownView && published && inVoteWindow) void refreshHome();
  }, [ownView, published, inVoteWindow, refreshHome]);

  const switchView = () => {
    setLocalSelection(null);
    setSaved(false);
    setSubmitError(null);
  };

  const toggle = (practiceId: string) => {
    if (!editable || isSubmitting || lockedIds.includes(practiceId)) return;
    setSaved(false);
    setLocalSelection({ key: selectionKey, dirty: true, baseline: home.data, ids:
      selectedIds.includes(practiceId)
        ? selectedIds.filter((id) => id !== practiceId)
        : [...selectedIds, practiceId],
    });
  };

  const submit = async () => {
    if (!currentMonth || !editable || isSubmitting || home.stale || home.refreshing) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await apiClient.put<void>(
        `/v1/practice-months/${currentMonth.id}/votes/me`,
        { practice_ids: selectedIds },
      );
      // 204で保存確定。保存前に開始した再取得では選択を戻さない。
      setLocalSelection({ key: selectionKey, ids: [...selectedIds], dirty: false, baseline: home.data });
      setSaved(true);
    } catch (e) {
      setSubmitError(
        e instanceof ApiClientError ? e.message : "投票の保存に失敗しました",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || !user || (!home.data && !home.error)) {
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
        <Link
          href="/help/home-screen"
          className="flex min-h-14 items-center gap-3 rounded-2xl border border-brand-200 bg-white px-4 py-3 text-brand-800 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600"
        >
          <span aria-hidden="true" className="text-2xl">⌂</span>
          <span className="flex-1">
            <span className="block text-sm font-bold">クエーさんをiOS/Androidアプリのように使う方法</span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
        {home.refreshing && <p role="status" className="text-sm text-gray-500">最新の状態を確認中…</p>}
        {home.error && (
          <ErrorMessage
            message={home.data ? `${home.error}。保存済みの古い情報を表示しているため、変更が反映されていない場合があります。` : home.error}
            onRetry={() => void home.refresh()}
          />
        )}
        {home.stale && home.data && !home.error && <p className="text-xs text-gray-500">保存済みの情報を表示しています</p>}

        {/* 男女の切り替えと月の切り替え (D-038) */}
        <div className="flex items-center gap-2">
          <div className="flex shrink-0 rounded-full border-2 border-gray-200 bg-white p-0.5">
            {(["male", "female"] as const).map((g) => (
              <button
                key={g}
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setViewGender(g);
                  setSelectedMonthId(null);
                  switchView();
                }}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                  gender === g ? "bg-brand-600 text-white" : "text-gray-500"
                }`}
              >
                {g === "male" ? "男子" : "女子"}
              </button>
            ))}
          </div>
          {months && months.length > 1 && (
            <select
              disabled={isSubmitting}
              value={currentMonth?.id ?? ""}
              onChange={(e) => {
                setSelectedMonthId(e.target.value);
                switchView();
              }}
              className="min-w-0 flex-1 rounded-full border-2 border-gray-200 bg-white px-3 py-1.5 text-sm font-bold text-gray-700 focus:outline-none"
            >
              {months.map((m) => (
                <option key={m.id} value={m.id}>
                  {formatYearMonth(m.year_month)}
                </option>
              ))}
            </select>
          )}
        </div>

        {!home.error && !currentMonth && (
          <Card>
            <div className="py-6 text-center">
              <p className="font-bold text-gray-700">練習が登録されていません</p>
              <p className="mt-1 text-sm text-gray-500">
                代表が登録すると表示されます
              </p>
            </div>
          </Card>
        )}

        {/* 異性の月 — 閲覧のみ (D-038)。日程一覧と、公開後は参加表を見せる */}
        {currentMonth && !ownView && (
          <>
            <Card>
              <p className="font-bold text-gray-900">
                {gender === "male" ? "男子" : "女子"}の練習日程
              </p>
              <p className="mt-0.5 text-sm text-gray-500">閲覧のみ（投票はできません）</p>
            </Card>
            <Card>
              {detail && detail.practices.length > 0 ? (
                <ul className="divide-y divide-gray-100">
                  {detail.practices.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-baseline gap-x-3 py-2.5">
                      <span className="w-20 shrink-0 font-bold text-gray-900">
                        {formatDate(p.practice_date)}
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-gray-700">
                        {formatTime(p.starts_at)}〜{formatTime(p.ends_at)}
                      </span>
                      <span className="truncate text-sm text-gray-500">{p.location}</span>
                      {p.note && (
                        <span className="w-full text-xs text-gray-400">※ {p.note}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-center text-sm text-gray-500">
                  練習日が登録されていません
                </p>
              )}
            </Card>
            {published && participation && (
              <ParticipationTable
                data={participation}
                currentUserId={user.id}
                currentUserGrade={user.grade}
                currentUserIsManager={user.is_manager}
                viewGender={gender ?? user.gender}
              />
            )}
          </>
        )}

        {/* 結果公開後 — 自分の参加日と全員の参加表をタブで切り替える (D-025)。
            縦に並べると参加表まで毎回スクロールすることになるため */}
        {currentMonth && ownView && published && (
          <>
            {showVoting && (
              <p className="text-sm font-semibold text-brand-700">
                確定済みの参加日を表示しています。未確定の日程は下から投票できます。
              </p>
            )}
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
                viewGender={gender ?? user.gender}
              />
            ) : (
              <Card>
                <Loading />
              </Card>
            )}
          </>
        )}

        {/* 締切後・結果未公開 — 抽選待ち */}
        {currentMonth && ownView && !published && !showVoting && (
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
        {currentMonth && showVoting && (
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
                const locked = lockedIds.includes(practice.id);
                // 学年限定の日 (D-037)。対象外なら選べない。マネージャーは制限なし
                const votable =
                  user.is_manager ||
                  !practice.allowed_grades ||
                  practice.allowed_grades.includes(user.grade);
                if (!votable && !locked) {
                  return (
                    <div
                      key={practice.id}
                      className="flex w-full flex-wrap items-center gap-2.5 rounded-2xl border-2 border-transparent bg-white px-3 py-2.5 opacity-60"
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
                      {practice.note && (
                        <span className="w-full pl-[34px] text-xs text-gray-400">
                          ※ {practice.note}
                        </span>
                      )}
                    </div>
                  );
                }
                return (
                  <button
                    key={practice.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={locked || !editable || isSubmitting}
                    onClick={() => toggle(practice.id)}
                    className={`flex w-full flex-wrap items-center gap-2.5 rounded-2xl border-2 px-3 py-2.5 text-left transition-colors ${
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
                    {locked && (
                      <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-gray-500">
                        確定済み（変更不可）
                      </span>
                    )}
                    {/* 備考 (D-041)。練習試合の予定などを投票前に知らせる */}
                    {practice.note && (
                      <span className="w-full pl-[34px] text-xs font-semibold text-accent-700">
                        ※ {practice.note}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {submitError && <ErrorMessage message={submitError} />}
          </>
        )}
      </main>

      {/* 投票ボタン（投票期間中のみ） */}
      {currentMonth && showVoting && (
        <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 bg-brand-50 px-4 pb-5 pt-8">
          <button
            type="button"
            onClick={submit}
            disabled={isSubmitting || !editable || home.stale || home.refreshing}
            className="w-full rounded-full bg-brand-600 py-4 text-base font-bold text-white shadow-lg shadow-brand-200 active:scale-[0.98] disabled:opacity-60"
          >
            {isSubmitting
              ? "送信中..."
              : editableSelectedCount === 0
                ? "選択せずに送信"
                : `${editableSelectedCount}日を送信`}
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
