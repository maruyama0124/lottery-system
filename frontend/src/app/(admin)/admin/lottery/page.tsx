"use client";

// 抽選実行画面（代表のみ）
// D-015: 日ごと・学年ごとの投票状況を見ながら参加人数を決め、確定してから抽選する
import Link from "next/link";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/header";
import { ErrorMessage } from "@/components/ui/error-message";
import { CalendarDaysIcon, DicesIcon, TriangleAlertIcon } from "@/components/ui/icons";
import { Loading } from "@/components/ui/loading";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useRequireRepresentative } from "@/hooks/use-auth";
import type {
  LotteryExecution,
  PracticeMonth,
  PracticeVoteSummary,
  VoteSummary,
} from "@/types/api";

const GRADES = [3, 2, 1] as const;
const GRADE_COLOR: Record<number, string> = {
  3: "bg-brand-600",
  2: "bg-sky-500",
  1: "bg-emerald-500",
};
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatYearMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
}

function formatPracticeDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

/** practice_id -> 学年 -> 入力中の人数 */
// 入力中は文字列で持つ。数値で持つと空欄にできず「0」が残る（スマホで消せない）ため
type QuotaDraft = Record<string, Record<number, string>>;

function toDraft(summary: VoteSummary): QuotaDraft {
  const draft: QuotaDraft = {};
  for (const p of summary.practices) {
    draft[p.practice_id] = {};
    for (const g of p.grades) {
      // 未設定なら提案値（基準の等分に投票状況を反映した値: D-031）を初期表示する
      draft[p.practice_id][g.grade] = String(g.quota ?? g.suggested_quota);
    }
  }
  return draft;
}

/** 定員を学年数で等分した「基準」。端数は 3年 → 2年 → 1年 の順に1ずつ足す */
/** 学年別の投票数を積み上げ棒で表す */
function VoteBar({ practice }: { practice: PracticeVoteSummary }) {
  const total = practice.grades.reduce((sum, g) => sum + g.voters, 0);
  if (total === 0) {
    return <p className="text-xs text-gray-400">投票なし</p>;
  }
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
        {practice.grades.map((g) => (
          <div
            key={g.grade}
            className={GRADE_COLOR[g.grade]}
            style={{ width: `${(g.voters / total) * 100}%` }}
            title={`${g.grade}年 ${g.voters}人`}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">
        {practice.grades.map((g) => (
          <span key={g.grade} className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${GRADE_COLOR[g.grade]}`} />
            {g.grade}年 {g.voters}人
          </span>
        ))}
        <span className="ml-auto font-semibold text-gray-600">
          計 {total}人 / 定員 {practice.capacity}名
        </span>
      </div>
    </div>
  );
}

export default function AdminLotteryPage() {
  const { user, isLoading: authLoading } = useRequireRepresentative();

  const { data: months, error: monthsError } = useApi<PracticeMonth[]>(
    user ? "/v1/practice-months" : null,
  );
  // 過去の月も選べるようにする (既定は最新月)
  const [selectedMonthId, setSelectedMonthId] = useState<string | null>(null);
  const monthId = selectedMonthId ?? months?.[0]?.id ?? null;

  const {
    data: summary,
    error: summaryError,
    mutate: mutateSummary,
  } = useApi<VoteSummary>(monthId ? `/v1/practice-months/${monthId}/vote-summary` : null);

  // 代表が編集中の人数。null のあいだは取得した投票状況（保存値か提案値）を表示する。
  // effect で取得値を書き戻す方式だと、再取得のたびに編集中の値が消えるのでこの形にする
  const [edited, setEdited] = useState<QuotaDraft | null>(null);
  const draft: QuotaDraft | null = edited ?? (summary ? toDraft(summary) : null);
  const [saving, setSaving] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [lastExecution, setLastExecution] = useState<LotteryExecution | null>(null);

  if (authLoading || !user) return <Loading />;

  const setQuota = (practiceId: string, grade: number, value: string) => {
    if (!draft) return;
    // 数字以外は捨てる (電話番号用キーボードでの入力を想定)
    const digits = value.replace(/\D/g, "");
    setEdited({
      ...draft,
      [practiceId]: { ...draft[practiceId], [grade]: digits },
    });
  };

  const totalOf = (practiceId: string): number =>
    GRADES.reduce((sum, g) => sum + (Number(draft?.[practiceId]?.[g]) || 0), 0);

  // 画面の人数を保存する。抽選の直前に必ず呼び、画面に見えている値で抽選する (D-046)
  const saveQuotas = async (): Promise<boolean> => {
    if (!monthId || !summary || !draft) return false;
    setSaving(true);
    setQuotaError(null);
    try {
      await apiClient.put<void>(`/v1/practice-months/${monthId}/quotas`, {
        practices: summary.practices.map((p) => ({
          practice_id: p.practice_id,
          grades: GRADES.map((g) => ({
            grade: g,
            quota: Number(draft[p.practice_id][g]) || 0, // 空欄は 0 として保存
          })),
        })),
      });
      await mutateSummary();
      return true;
    } catch (e) {
      setQuotaError(e instanceof ApiClientError ? e.error.message : "保存に失敗しました");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const runLottery = (confirmRerun: boolean) =>
    apiClient.post<LotteryExecution>(
      `/v1/practice-months/${monthId}/lottery`,
      confirmRerun ? { confirm_rerun: true } : {},
    );

  const handleExecute = async () => {
    if (!monthId || executing || saving) return;
    setExecError(null);
    setLastExecution(null);
    // 画面に入っている人数をそのまま使う。保存し忘れた古い値で抽選しないため
    if (!(await saveQuotas())) return;
    setExecuting(true);
    try {
      setLastExecution(await runLottery(false));
    } catch (e) {
      const rerun =
        e instanceof ApiClientError &&
        e.status === 409 &&
        (e.error.message.includes("実行済") || e.error.message.includes("再実行"));
      if (rerun && window.confirm("前回の結果を破棄して再実行しますか？")) {
        try {
          setLastExecution(await runLottery(true));
        } catch (e2) {
          setExecError(
            e2 instanceof ApiClientError ? e2.error.message : "抽選の実行に失敗しました",
          );
        }
      } else if (!rerun) {
        setExecError(
          e instanceof ApiClientError ? e.error.message : "抽選の実行に失敗しました",
        );
      }
    } finally {
      setExecuting(false);
    }
  };

  const month = months?.find((m) => m.id === monthId);

  return (
    <div className="flex min-h-screen flex-col">
      <AdminHeader title="抽選実行" />

      <main className="flex-1 space-y-5 px-4 py-4 pb-44">
        {monthsError && <ErrorMessage message="対象月の取得に失敗しました" />}
        {months && months.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">対象の月がありません</p>
        )}

        {/* 月の切り替え */}
        {months && months.length > 1 && (
          <select
            value={monthId ?? ""}
            onChange={(e) => {
              setSelectedMonthId(e.target.value);
              setEdited(null); // 月をまたいで編集中の値を持ち越さない
              setLastExecution(null);
              setExecError(null);
                      }}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-bold text-gray-900 focus:border-brand-600 focus:outline-none"
          >
            {months.map((m) => (
              <option key={m.id} value={m.id}>
                {formatYearMonth(m.year_month)}
              </option>
            ))}
          </select>
        )}

        {month && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-gray-900">抽選の前提</h2>
            <p className="flex items-center gap-2 text-sm text-gray-700">
              <CalendarDaysIcon width={18} height={18} />
              対象: <strong>{formatYearMonth(month.year_month)}</strong>
              （練習{summary?.practices.length ?? 0}回）
            </p>
            <p className="mt-2 text-xs text-gray-500">
              日ごとに学年別の参加人数を決めてから抽選します。マネージャーは定員外で全参加です。
            </p>
          </section>
        )}

        {summaryError && <ErrorMessage message="投票状況の取得に失敗しました" />}

        {/* 投票状況と学年別人数の調整 (D-015) */}
        {summary && draft && (
          <section>
            <h2 className="mb-2 text-sm font-bold text-gray-500">
              投票状況と参加人数の調整
            </h2>
            <div className="space-y-3">
              {summary.practices.map((p) => {
                const total = totalOf(p.practice_id);
                return (
                  <div
                    key={p.practice_id}
                    className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="mb-2 flex items-baseline justify-between">
                      <p className="text-sm font-bold text-gray-900">
                        {formatPracticeDate(p.practice_date)} {p.location}
                      </p>
                      <p className="text-xs text-gray-500">
                        {p.starts_at}〜{p.ends_at}
                      </p>
                    </div>

                    <VoteBar practice={p} />

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {p.grades.map((g) => {
                        // 学年限定の日 (D-037)。対象外の学年は投票できないため入力も閉じる
                        const inPlay =
                          !p.allowed_grades || p.allowed_grades.includes(g.grade);
                        return (
                          <div key={g.grade}>
                            <label
                              htmlFor={`${p.practice_id}-${g.grade}`}
                              className="mb-1 block text-xs font-semibold text-gray-500"
                            >
                              {g.grade}年（{inPlay ? `投票${g.voters}` : "対象外"}）
                            </label>
                            <input
                              id={`${p.practice_id}-${g.grade}`}
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              disabled={!inPlay}
                              value={draft[p.practice_id]?.[g.grade] ?? ""}
                              onChange={(e) => setQuota(p.practice_id, g.grade, e.target.value)}
                              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-center text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-gray-100 disabled:text-gray-400"
                            />
                          </div>
                        );
                      })}
                    </div>

                    {/* 合計と定員の一致は求めない。代表が意図的にずらすことがある (D-045) */}
                    <p className="mt-2 text-xs font-semibold text-gray-500">
                      合計 {total} / 定員 {p.capacity}
                    </p>
                  </div>
                );
              })}
            </div>

            {quotaError && (
              <div className="mt-3">
                <ErrorMessage message={quotaError} />
              </div>
            )}
          </section>
        )}

        {execError && <ErrorMessage message={execError} />}

        {lastExecution && (
          <section className="rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-bold text-green-800">抽選が完了しました</p>
            {lastExecution.warnings.length > 0 && (
              <ul className="mt-2 space-y-1">
                {lastExecution.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-1.5 text-xs text-yellow-800">
                    <span className="mt-0.5 shrink-0">
                      <TriangleAlertIcon width={12} height={12} />
                    </span>
                    {w}
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/admin/results"
              className="mt-3 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
            >
              結果画面へ
            </Link>
          </section>
        )}

      </main>

      {/* 下部固定: 実行ボタン（タブバーの上） */}
      <div className="fixed bottom-14 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t border-gray-200 bg-white/95 px-4 pt-3 pb-3 backdrop-blur">
        <p className="mb-2 text-center text-xs text-gray-500">
          上の参加人数をそのまま使って抽選します
        </p>
        <button
          onClick={handleExecute}
          disabled={executing || saving || !monthId || !draft}
          className="w-full rounded-xl bg-brand-600 py-4 text-lg font-bold text-white shadow-lg hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-2">
            <DicesIcon width={22} height={22} />
            {saving ? "保存中…" : executing ? "実行中…" : "抽選を実行する"}
          </span>
        </button>
      </div>
    </div>
  );
}
