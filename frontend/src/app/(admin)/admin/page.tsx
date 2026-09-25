"use client";

// 管理ホーム — 今月の進行状況・投票状況・次のアクション・メニュー (D-009)
import Link from "next/link";
import { AdminHeader } from "@/components/admin/header";
import {
  ChevronRightIcon,
  DicesIcon,
  SettingsIcon,
  CheckIcon,
} from "@/components/ui/icons";
import { ErrorMessage } from "@/components/ui/error-message";
import { Loading } from "@/components/ui/loading";
import { useApi } from "@/hooks/use-api";
import { useRequireRepresentative } from "@/hooks/use-auth";
import type { PracticeMonth, PracticeMonthDetail } from "@/types/api";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}年${Number(m)}月`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${hh}:${mm}`;
}

function formatPracticeDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

function isVoteStarted(month: PracticeMonthDetail): boolean {
  return new Date(month.vote_starts_at).getTime() <= Date.now();
}

function isVoteEnded(month: PracticeMonthDetail): boolean {
  return new Date(month.vote_ends_at).getTime() < Date.now();
}

const STEP_LABELS = ["日程登録", "投票受付", "抽選", "微調整", "公開"];

/** 現在アクティブなステップ番号 (1-5)。全完了なら 6 */
function currentStep(month: PracticeMonthDetail): number {
  if (month.status === "published") return 6;
  if (month.status === "drawn") return 4;
  if (month.status === "closed" || (month.status === "voting" && isVoteEnded(month))) return 3;
  if (month.practices.length > 0) return 2;
  return 1;
}

function StepIndicator({ month }: { month: PracticeMonthDetail }) {
  const active = currentStep(month);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-xs font-semibold text-gray-500">今月の進行状況</p>
      <div className="flex items-start">
        {STEP_LABELS.map((label, i) => {
          const step = i + 1;
          const done = step < active;
          const isActive = step === active;
          return (
            <div key={label} className="contents">
              {i > 0 && (
                <div
                  className={`mt-4 h-0.5 w-4 flex-none ${
                    step <= active ? "bg-brand-600" : "bg-gray-300"
                  }`}
                />
              )}
              <div className="flex flex-1 flex-col items-center">
                {done ? (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white">
                    <CheckIcon width={16} height={16} />
                  </div>
                ) : isActive ? (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-brand-600 bg-white text-sm font-bold text-brand-600 ring-4 ring-brand-100">
                    {step}
                  </div>
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-bold text-gray-400">
                    {step}
                  </div>
                )}
                <span
                  className={`mt-1.5 text-center text-[10px] leading-tight ${
                    done
                      ? "font-semibold text-brand-600"
                      : isActive
                        ? "font-bold text-brand-600"
                        : "text-gray-400"
                  }`}
                >
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VoteStatusCard({ month }: { month: PracticeMonthDetail }) {
  const started = isVoteStarted(month);
  const ended = isVoteEnded(month);
  const badge = !started ? "受付開始前" : ended ? "締切済み" : "受付中";
  const maxCount = Math.max(1, ...month.practices.map((p) => p.vote_count));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">投票状況</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            badge === "受付中"
              ? "bg-brand-100 text-brand-700"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {badge}
        </span>
      </div>
      {month.practices.length === 0 ? (
        <p className="text-sm text-gray-500">練習日が登録されていません</p>
      ) : (
        <ul className="space-y-2">
          {month.practices.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="w-16 flex-none text-xs text-gray-600">
                {formatPracticeDate(p.practice_date)}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-brand-600"
                  style={{ width: `${(p.vote_count / maxCount) * 100}%` }}
                />
              </div>
              <span className="w-10 flex-none text-right text-xs font-semibold text-gray-700">
                {p.vote_count}票
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-gray-500">
        締切: {formatDateTime(month.vote_ends_at)}
        {ended ? "（締切済み）" : ""}
      </p>
    </div>
  );
}

function NextActionCard({ month }: { month: PracticeMonthDetail }) {
  const ended = isVoteEnded(month);

  let message: string;
  let buttonLabel: string | null = null;
  let buttonHref = "";

  if (month.status === "published") {
    message = "今月の結果は公開済みです";
  } else if (month.status === "drawn") {
    message = "抽選が完了しました。微調整して公開しましょう";
    buttonLabel = "結果の確認・微調整へ";
    buttonHref = "/admin/results";
  } else if (month.status === "closed" || (month.status === "voting" && ended)) {
    message = "投票が締め切られました。抽選を実行しましょう";
    buttonLabel = "抽選へ進む";
    buttonHref = "/admin/lottery";
  } else if (month.status === "voting" && !ended) {
    message = "投票受付中です。締切までお待ちください";
  } else if (month.practices.length === 0) {
    message = "練習日程を登録しましょう";
    buttonLabel = "日程管理へ";
    buttonHref = "/admin/schedule";
  } else {
    message = "投票開始までお待ちください";
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
      <div className="flex items-start gap-3">
        <span className="text-brand-600">
          <DicesIcon width={24} height={24} />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold leading-relaxed text-gray-900">{message}</p>
          {buttonLabel && (
            <Link
              href={buttonHref}
              className="mt-3 block w-full rounded-lg bg-brand-600 py-3 text-center text-sm font-bold text-white shadow-sm hover:bg-brand-700"
            >
              {buttonLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// 日程・抽選・結果は下のナビゲーションバーから行けるので、ここには設定だけ置く
const MENU_ITEMS = [
  { href: "/admin/settings", label: "設定", Icon: SettingsIcon },
];

function MenuList() {
  return (
    <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
      {MENU_ITEMS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50">
          <span className="flex w-7 justify-center text-gray-500">
            <Icon width={20} height={20} />
          </span>
          <span className="flex-1 text-sm font-medium text-gray-900">{label}</span>
          <span className="text-gray-400">
            <ChevronRightIcon width={18} height={18} />
          </span>
        </Link>
      ))}
    </div>
  );
}

export default function AdminHomePage() {
  const { user, isLoading: authLoading } = useRequireRepresentative();
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

  if (authLoading || !user) {
    return (
      <>
        <AdminHeader title="管理ホーム" />
        <Loading />
      </>
    );
  }

  return (
    <>
      <AdminHeader title="管理ホーム" />
      <main className="space-y-4 px-4 py-4">
        {monthsLoading || (currentMonth && detailLoading) ? (
          <Loading />
        ) : monthsError ? (
          <ErrorMessage message="データの取得に失敗しました" onRetry={() => mutateMonths()} />
        ) : !currentMonth ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
            <p className="text-sm text-gray-600">練習月がまだ作成されていません</p>
            <Link
              href="/admin/schedule"
              className="mt-4 block w-full rounded-lg bg-brand-600 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
            >
              月を作成する
            </Link>
          </div>
        ) : detailError ? (
          <ErrorMessage message="データの取得に失敗しました" onRetry={() => mutateDetail()} />
        ) : detail ? (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">
                {formatYearMonth(detail.year_month)}
              </h2>
              <span className="text-xs text-gray-500">代表: {user.name}</span>
            </div>
            <StepIndicator month={detail} />
            <VoteStatusCard month={detail} />
            <NextActionCard month={detail} />
          </>
        ) : null}
        <MenuList />
      </main>
    </>
  );
}
