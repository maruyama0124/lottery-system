"use client";

// 練習日程管理 — 月の作成・投票期間・練習日の追加/編集/削除 (D-009)
import { useState } from "react";
import { AdminHeader } from "@/components/admin/header";
import {
  ClockIcon,
  CopyIcon,
  MapPinIcon,
  PencilIcon,
  TrashIcon,
  UsersIcon,
  VoteIcon,
} from "@/components/ui/icons";
import { ErrorMessage } from "@/components/ui/error-message";
import { Loading } from "@/components/ui/loading";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useRequireRepresentative } from "@/hooks/use-auth";
import type {
  Gender,
  Practice,
  PracticeCreated,
  PracticeGenderEdit,
  PracticeCreateRequest,
  PracticeMonth,
  PracticeMonthDetail,
  PracticeSuggestion,
} from "@/types/api";

type GenderTarget = Gender | "both";
const targetGenders = (target: GenderTarget): Gender[] => target === "both" ? ["male", "female"] : [target];
const targetLabel = (target: GenderTarget) => target === "both" ? "男子・女子の両方" : target === "male" ? "男子" : "女子";

function GenderTargetField({ value, onChange, disabled = false }: {
  value: GenderTarget; onChange: (value: GenderTarget) => void; disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2">
      <legend className="mb-1 text-xs font-semibold text-gray-600">登録対象</legend>
      <div className="flex gap-2">
        {(["male", "female", "both"] as const).map((target) => (
          <button key={target} type="button" aria-pressed={value === target} onClick={() => onChange(target)}
            className={`flex-1 rounded-lg border py-2 text-sm font-bold disabled:opacity-50 ${value === target ? "border-brand-600 bg-brand-50 text-brand-700" : "border-gray-300 text-gray-500"}`}>
            {target === "both" ? "両方" : targetLabel(target)}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">両方の場合も定員・投票・抽選は男女別です</p>
    </fieldset>
  );
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}年${Number(m)}月`;
}

function formatPracticeDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

/** ISO 8601 → date 入力値 (ローカル日付 YYYY-MM-DD) */
function isoToDateInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 投票開始日 → その日の 0:00 の ISO 8601 (D-014: 時刻は入力させない) */
function voteStartToIso(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}

/** 投票締切日 → その日の 23:59 の ISO 8601。締切日は丸一日投票できる (D-014) */
function voteEndToIso(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59`).toISOString();
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.error.message;
  return "エラーが発生しました";
}

// type="date" は既定で最小幅を持ち、2列に並べると枠からはみ出す。
// min-w-0 で指定した幅に収める
const inputClass =
  "w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600";
const labelClass = "mb-1.5 block text-xs font-semibold text-gray-500";

// ---------- 練習日フォーム（追加・編集で共用） ----------

interface PracticeFormValues {
  practice_date: string;
  starts_at: string;
  ends_at: string;
  location: string;
  capacity: string;
  /** 参加できる学年 (D-037)。全選択 = 制限なし */
  allowed_grades: number[];
  /** 備考 (D-041) */
  note: string;
}

const ALL_GRADES = [3, 2, 1];

function emptyPracticeForm(): PracticeFormValues {
  return {
    practice_date: "",
    starts_at: "",
    ends_at: "",
    location: "",
    capacity: "20",
    allowed_grades: [...ALL_GRADES],
    note: "",
  };
}

function practiceToForm(p: Practice): PracticeFormValues {
  return {
    practice_date: p.practice_date,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    location: p.location,
    capacity: String(p.capacity),
    allowed_grades: p.allowed_grades ?? [...ALL_GRADES],
    note: p.note ?? "",
  };
}

function formToRequest(v: PracticeFormValues): PracticeCreateRequest {
  return {
    practice_date: v.practice_date,
    starts_at: v.starts_at,
    ends_at: v.ends_at,
    location: v.location,
    capacity: Number(v.capacity),
    allowed_grades:
      v.allowed_grades.length === ALL_GRADES.length
        ? null
        : [...v.allowed_grades].sort(),
    note: v.note.trim() || null,
  };
}

/** [1,2] → "1・2年限定" */
function gradeLimitLabel(grades: number[]): string {
  return `${[...grades].sort().join("・")}年限定`;
}

// 時刻は数字を直接打つ（電話番号用キーボード）。「1830」と打つと「18:30」に整形する。
// 30分単位の制限 (D-014) はそのままで、サーバー側でも検証している
function formatTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/** 有効な時刻 (HH:MM で 30分単位) か */
const isTime = (v: string) => /^([01]\d|2[0-3]):(00|30)$/.test(v);

/** 4桁まで打ち終わっているのに有効でない (例: 18:15) */
const timeLooksWrong = (v: string) => v.length === 5 && !isTime(v);

/** 対象月の初日と末日 (date 入力の min/max 用) */
function monthRange(yearMonth: string): [string, string] {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${yearMonth}-01`, `${yearMonth}-${String(last).padStart(2, "0")}`];
}

function PracticeForm({
  values,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
  suggestions,
  yearMonth,
  submitDisabled = false,
}: {
  values: PracticeFormValues;
  onChange: (v: PracticeFormValues) => void;
  /** 省略時はアクションボタンを表示しない（親フォームでまとめて送信） */
  onSubmit?: () => void;
  onCancel?: () => void;
  submitLabel?: string;
  busy?: boolean;
  /** 過去の登録実績。選ぶと場所・時刻・定員が埋まる (D-014) */
  suggestions?: PracticeSuggestion[];
  /** 対象月 (YYYY-MM)。指定するとその月の日付しか選べない (D-033) */
  yearMonth?: string;
  submitDisabled?: boolean;
}) {
  const range = yearMonth && /^\d{4}-\d{2}$/.test(yearMonth) ? monthRange(yearMonth) : null;
  const dateInMonth = !range || (values.practice_date >= range[0] && values.practice_date <= range[1]);
  const valid =
    values.practice_date && dateInMonth && isTime(values.starts_at) && isTime(values.ends_at) && values.location && Number(values.capacity) > 0 &&
    values.allowed_grades.length > 0;

  const applySuggestion = (index: string) => {
    const s = suggestions?.[Number(index)];
    if (!s) return;
    onChange({
      ...values,
      location: s.location,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      capacity: String(s.capacity),
    });
  };

  return (
    <div className="space-y-3">
      {suggestions && suggestions.length > 0 && (
        <div>
          <label className={labelClass}>よく使う練習から入力</label>
          <select value="" onChange={(e) => applySuggestion(e.target.value)} className={inputClass}>
            <option value="">選択してください</option>
            {suggestions.map((s, i) => (
              <option key={`${s.location}-${s.starts_at}-${i}`} value={i}>
                {s.location}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className={labelClass}>日付</label>
        <input
          type="date"
          value={values.practice_date}
          min={range?.[0]}
          max={range?.[1]}
          onChange={(e) => onChange({ ...values, practice_date: e.target.value })}
          className={inputClass}
        />
        {values.practice_date && !dateInMonth && yearMonth && (
          <p className="mt-1 text-xs font-semibold text-red-600">
            {formatYearMonth(yearMonth)}の日付を選んでください
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className={labelClass}>開始時刻</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="1830"
            value={values.starts_at}
            onChange={(e) => onChange({ ...values, starts_at: formatTimeInput(e.target.value) })}
            className={inputClass}
          />
          {timeLooksWrong(values.starts_at) && (
            <p className="mt-1 text-xs font-semibold text-red-600">30分単位で入力してください</p>
          )}
        </div>
        <div className="min-w-0">
          <label className={labelClass}>終了時刻</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="2130"
            value={values.ends_at}
            onChange={(e) => onChange({ ...values, ends_at: formatTimeInput(e.target.value) })}
            className={inputClass}
          />
          {timeLooksWrong(values.ends_at) && (
            <p className="mt-1 text-xs font-semibold text-red-600">30分単位で入力してください</p>
          )}
        </div>
      </div>
      <div>
        <label className={labelClass}>場所</label>
        <input
          type="text"
          value={values.location}
          onChange={(e) => onChange({ ...values, location: e.target.value })}
          placeholder="第一体育館"
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>定員</label>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={values.capacity}
          onChange={(e) => onChange({ ...values, capacity: e.target.value.replace(/\D/g, "") })}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>参加できる学年</label>
        <div className="flex gap-2">
          {ALL_GRADES.map((g) => {
            const on = values.allowed_grades.includes(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() =>
                  onChange({
                    ...values,
                    allowed_grades: on
                      ? values.allowed_grades.filter((x) => x !== g)
                      : [...values.allowed_grades, g],
                  })
                }
                className={`flex-1 rounded-lg border py-2.5 text-sm font-bold ${
                  on
                    ? "border-brand-600 bg-brand-50 text-brand-700"
                    : "border-gray-300 bg-white text-gray-400"
                }`}
              >
                {g}年
              </button>
            );
          })}
        </div>
        {values.allowed_grades.length === 0 ? (
          <p className="mt-1 text-xs font-semibold text-red-600">
            参加できる学年を1つ以上選んでください
          </p>
        ) : values.allowed_grades.length < ALL_GRADES.length ? (
          <p className="mt-1 text-xs text-gray-500">
            選んだ学年のメンバーだけが投票できます
          </p>
        ) : null}
      </div>
      <div>
        <label className={labelClass}>備考（任意）</label>
        <input
          type="text"
          maxLength={255}
          value={values.note}
          onChange={(e) => onChange({ ...values, note: e.target.value })}
          placeholder="練習試合の予定"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-gray-500">メンバーの投票画面と参加表に表示されます</p>
      </div>
      {onSubmit && onCancel && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!valid || busy || submitDisabled}
            className="flex-1 rounded-lg bg-brand-600 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- 練習日カード ----------

function PracticeCard({
  practice,
  onUpdated,
  suggestions,
  onDuplicate,
  yearMonth,
  readOnly = false,
}: {
  practice: Practice;
  onUpdated: () => void;
  suggestions?: PracticeSuggestion[];
  /** この練習の内容を追加フォームに引き継ぐ (D-014) */
  onDuplicate?: (practice: Practice) => void;
  /** 対象月。編集時もこの月の日付しか選べない (D-033) */
  yearMonth?: string;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PracticeFormValues>(practiceToForm(practice));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [genderContext, setGenderContext] = useState<PracticeGenderEdit | null>(null);
  const [target, setTarget] = useState<GenderTarget>("both");
  const openEditor = async () => {
    setBusy(true);
    setError(null);
    try {
      const context = await apiClient.get<PracticeGenderEdit>(`/v1/practices/${practice.id}/genders`);
      setGenderContext(context);
      setTarget(context.genders.length === 2 ? "both" : context.genders[0]);
      setForm(practiceToForm(context.practice));
      setEditing(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!genderContext || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.put<void>(`/v1/practices/${practice.id}/genders`, {
        genders: targetGenders(target), practice: formToRequest(form),
        expected_versions: genderContext.versions,
      });
      setEditing(false);
      onUpdated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`${formatPracticeDate(practice.practice_date)} の練習を削除しますか？`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.delete<void>(`/v1/practices/${practice.id}`);
      onUpdated();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        if (window.confirm("抽選実行済みです。それでも削除しますか？")) {
          try {
            await apiClient.delete<void>(`/v1/practices/${practice.id}?force=true`);
            onUpdated();
          } catch (err2) {
            setError(errorMessage(err2));
          }
        }
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      {editing ? (
        <fieldset disabled={busy} className="space-y-4">
        <GenderTargetField value={target} onChange={setTarget} disabled={busy} />
        <p className="text-xs text-gray-500">同じ日付の男女の練習をまとめて編集します。選択を外した側は削除します。投票・参加割当がある側や固定済みの日は削除・男女変更できません。</p>
        {genderContext && targetGenders(target).some((g) => !genderContext.available_genders.includes(g)) && (
          <p role="status" className="text-xs text-amber-700">選択した性別の対象月が未作成です。先にその月を作成してください。</p>
        )}
        <PracticeForm
          values={form}
          onChange={setForm}
          suggestions={suggestions}
          yearMonth={yearMonth}
          onSubmit={save}
          onCancel={() => {
            setForm(practiceToForm(practice));
            setEditing(false);
          }}
          submitLabel="保存する"
          busy={busy}
          submitDisabled={!genderContext || targetGenders(target).some((g) => !genderContext.available_genders.includes(g))}
        />
        </fieldset>
      ) : (
        <>
          <div className="flex items-start justify-between">
            <p className="text-base font-bold text-gray-900">
              {formatPracticeDate(practice.practice_date)}
              {practice.allowed_grades && (
                <span className="ml-2 rounded bg-accent-100 px-1.5 py-0.5 align-middle text-[10px] font-bold text-accent-700">
                  {gradeLimitLabel(practice.allowed_grades)}
                </span>
              )}
            </p>
            <div className="flex gap-2">
              {/* 同じ内容で別日を登録する導線 (D-014) */}
              {onDuplicate && (
                <button
                  type="button"
                  aria-label="同じ内容で別日を追加"
                  onClick={() => onDuplicate(practice)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-brand-100 hover:text-brand-600"
                >
                  <CopyIcon width={16} height={16} />
                </button>
              )}
              <button
                type="button"
                aria-label="編集"
                onClick={openEditor}
                disabled={busy}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200"
              >
                <PencilIcon width={16} height={16} />
              </button>
              {!readOnly && <button
                type="button"
                aria-label="削除"
                onClick={remove}
                disabled={busy}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-600 disabled:opacity-50"
              >
                <TrashIcon width={16} height={16} />
              </button>}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
            <span className="inline-flex items-center gap-1">
              <ClockIcon width={14} height={14} /> {practice.starts_at}〜{practice.ends_at}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPinIcon width={14} height={14} /> {practice.location}
            </span>
            <span className="inline-flex items-center gap-1">
              <UsersIcon width={14} height={14} /> 定員 {practice.capacity}名
            </span>
            <span className="inline-flex items-center gap-1">
              <VoteIcon width={14} height={14} /> {practice.vote_count}票
            </span>
          </div>
          {practice.note && (
            <p className="mt-1 text-sm text-gray-500">※ {practice.note}</p>
          )}
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ---------- 新しい月の作成フォーム ----------

function NewMonthForm({
  onCreated,
  onCancel,
  suggestions,
  defaultGender,
}: {
  onCreated: (months: PracticeMonth[]) => void;
  onCancel: () => void;
  suggestions?: PracticeSuggestion[];
  defaultGender: Gender;
}) {
  const [yearMonth, setYearMonth] = useState("");
  const [voteStart, setVoteStart] = useState("");
  const [voteEnd, setVoteEnd] = useState("");
  const [practices, setPractices] = useState<(PracticeFormValues & { target: GenderTarget })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 送信前に内容を一覧で見せる確認ステップ (D-016)
  const [confirming, setConfirming] = useState(false);
  const genders: Gender[] = practices.length
    ? [...new Set(practices.flatMap((p) => targetGenders(p.target)))].sort()
    : [defaultGender];
  const creationLabel = genders.length === 2 ? targetLabel("both") : targetLabel(genders[0]);

  const valid =
    /^\d{4}-\d{2}$/.test(yearMonth) &&
    voteStart &&
    voteEnd &&
    practices.every(
      (p) =>
        p.practice_date && isTime(p.starts_at) && isTime(p.ends_at) && p.location &&
        Number(p.capacity) > 0 && p.allowed_grades.length > 0,
    );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await apiClient.post<PracticeMonth[]>("/v1/practice-months/batch", {
        genders,
        year_month: yearMonth,
        vote_starts_at: voteStartToIso(voteStart),
        vote_ends_at: voteEndToIso(voteEnd),
        practices: practices.map((p) => ({ ...formToRequest(p), genders: targetGenders(p.target) })),
      });
      onCreated(created);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const updatePractice = (index: number, v: PracticeFormValues) => {
    setPractices((prev) => prev.map((p, i) => (i === index ? { ...v, target: p.target } : p)));
  };

  /** 場所・時刻・定員を引き継ぎ、日付だけ空にして直後に挿入する (D-014) */
  const duplicatePractice = (index: number) => {
    setPractices((prev) => {
      const copy = { ...prev[index], practice_date: "" };
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
    });
  };

  // 確認画面: 送信前に内容を一覧で見せる (D-016)
  if (confirming) {
    const sorted = [...practices].sort((a, b) =>
      a.practice_date.localeCompare(b.practice_date),
    );
    return (
      <section>
        <h3 className="mb-2 text-sm font-bold text-gray-900">この内容で保存します</h3>
        <div className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">登録対象</dt>
              <dd className="font-bold text-gray-900">{creationLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">対象月</dt>
              <dd className="font-bold text-gray-900">{formatYearMonth(yearMonth)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">投票期間</dt>
              <dd className="text-right font-semibold text-gray-900">
                {voteStart} 0:00
                <br />〜 {voteEnd} 23:59
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">練習日</dt>
              <dd className="font-bold text-gray-900">{practices.length}件</dd>
            </div>
          </dl>
          <p className="text-xs text-gray-600">男女それぞれで、同じ日付があれば入力内容に更新し、なければ追加します。同じ内容は変更しません。既存月の投票期間・投票・割当は維持します。</p>

          <div className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {sorted.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">
                練習日は登録されません（あとから追加できます）
              </p>
            ) : (
              sorted.map((p, i) => (
                <div key={`${p.practice_date}-${i}`} className="p-3">
                  <p className="text-sm font-bold text-gray-900">
                    {formatPracticeDate(p.practice_date)} {p.location}
                    <span className="ml-2 text-xs text-brand-600">{targetLabel(p.target)}</span>
                    {p.allowed_grades.length < ALL_GRADES.length && (
                      <span className="ml-2 rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-bold text-accent-700">
                        {gradeLimitLabel(p.allowed_grades)}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-600">
                    {p.starts_at}〜{p.ends_at} ／ 定員 {p.capacity}名
                  </p>
                </div>
              ))
            )}
          </div>

          {/* 同じ日を二重に登録していないか気づけるようにする */}
          {sorted.length > 1 &&
            sorted.some((p, i) => i > 0 && p.practice_date === sorted[i - 1].practice_date) && (
              <p className="rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                同じ日付の候補があります。同じ性別・日付では、入力欄の下にある最後の候補を保存します。
              </p>
            )}

          {error && <ErrorMessage message={error} />}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="flex-1 rounded-lg border border-gray-300 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              修正する
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="flex-1 rounded-lg bg-brand-600 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存する"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h3 className="mb-2 text-sm font-bold text-gray-900">月・練習日を登録</h3>
      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label className={labelClass}>対象月</label>
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className={labelClass}>投票開始日</label>
            <input
              type="date"
              value={voteStart}
              onChange={(e) => setVoteStart(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="min-w-0">
            <label className={labelClass}>投票締切日</label>
            <input
              type="date"
              value={voteEnd}
              onChange={(e) => setVoteEnd(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <p className="-mt-2 text-xs text-gray-500">
          新規月は開始日の0:00から締切日の23:59まで投票できます。作成済みの月は現在の投票期間を維持します。
        </p>

        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500">練習日（{practices.length}件）</p>
          {practices.map((p, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3">
              <div className="mb-4">
                <GenderTargetField value={p.target} disabled={busy}
                  onChange={(target) => setPractices((prev) => prev.map((entry, j) => j === i ? { ...entry, target } : entry))} />
              </div>
              <PracticeForm
                values={p}
                onChange={(v) => updatePractice(i, v)}
                suggestions={suggestions}
                yearMonth={yearMonth}
              />
              <div className="mt-3 flex gap-2">
                {/* 同じ体育館・時間帯の練習を月に何度も登録するため、日付だけ空にして複製する (D-014) */}
                <button
                  type="button"
                  onClick={() => duplicatePractice(i)}
                  className="flex-1 rounded-lg border border-brand-300 py-2 text-xs font-semibold text-brand-600 hover:bg-brand-50"
                >
                  同じ内容で別日を追加
                </button>
                <button
                  type="button"
                  onClick={() => setPractices((prev) => prev.filter((_, j) => j !== i))}
                  className="flex-1 rounded-lg border border-gray-300 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50"
                >
                  この練習日を削除
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPractices((prev) => [...prev, { ...emptyPracticeForm(), target: defaultGender }])}
            className="w-full rounded-xl border-2 border-dashed border-gray-300 py-3 text-sm font-semibold text-gray-500 hover:border-brand-400 hover:text-brand-600"
          >
            ＋ 練習日を追加
          </button>
          {practices.length === 0 && <p className="text-xs text-gray-500">練習日を追加すると、日ごとに男子・女子・両方を選べます。練習日なしで作成する場合は{targetLabel(defaultGender)}の月のみ作成します。</p>}
        </div>

        {error && <ErrorMessage message={error} />}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-300 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!valid || busy}
            className="flex-1 rounded-lg bg-brand-600 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            入力内容を確認
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- 投票期間フォーム ----------

function VotePeriodForm({
  month,
  onSaved,
}: {
  month: PracticeMonthDetail;
  onSaved: () => void;
}) {
  const [voteStart, setVoteStart] = useState(isoToDateInput(month.vote_starts_at));
  const [voteEnd, setVoteEnd] = useState(isoToDateInput(month.vote_ends_at));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await apiClient.put<PracticeMonth>(`/v1/practice-months/${month.id}`, {
        vote_starts_at: voteStartToIso(voteStart),
        vote_ends_at: voteEndToIso(voteEnd),
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-sm font-bold text-gray-900">投票受付期間</h3>
      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label htmlFor="vote-start" className={labelClass}>
              開始日
            </label>
            <input
              id="vote-start"
              type="date"
              value={voteStart}
              onChange={(e) => setVoteStart(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="vote-end" className={labelClass}>
              締切日
            </label>
            <input
              id="vote-end"
              type="date"
              value={voteEnd}
              onChange={(e) => setVoteEnd(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <p className="-mt-2 text-xs text-gray-500">
          開始日の0:00から締切日の23:59まで投票できます
        </p>
        {error && <ErrorMessage message={error} />}
        {saved && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
            投票期間を保存しました
          </p>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!voteStart || !voteEnd || busy}
          className="w-full rounded-lg bg-brand-600 py-3.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          投票期間を保存
        </button>
      </div>
    </section>
  );
}

// ---------- ページ本体 ----------

export default function AdminSchedulePage() {
  const { user, isLoading: authLoading } = useRequireRepresentative();
  const [viewGender, setViewGender] = useState<Gender | null>(null);
  const gender = viewGender ?? user?.gender ?? "male";
  const otherGender: Gender = gender === "male" ? "female" : "male";
  const {
    data: months,
    error: monthsError,
    isLoading: monthsLoading,
    mutate: mutateMonths,
  } = useApi<PracticeMonth[]>(user ? `/v1/practice-months?gender=${gender}` : null);
  const { data: otherMonths, error: otherMonthsError, mutate: mutateOtherMonths } = useApi<PracticeMonth[]>(
    user ? `/v1/practice-months?gender=${otherGender}` : null,
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<PracticeFormValues>(emptyPracticeForm());
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<GenderTarget | null>(null);

  // 未選択時は先頭の月を表示する
  const resolvedId = selectedId ?? months?.[0]?.id ?? null;

  const {
    data: detail,
    error: detailError,
    isLoading: detailLoading,
    mutate: mutateDetail,
  } = useApi<PracticeMonthDetail>(resolvedId ? `/v1/practice-months/${resolvedId}` : null);

  // 過去の登録実績（場所・時刻・定員）。入力の手間を減らすため (D-014)
  const { data: suggestions } = useApi<PracticeSuggestion[]>("/v1/practices/suggestions");

  if (authLoading || !user) {
    return (
      <>
        <AdminHeader title="練習日程管理" />
        <Loading />
      </>
    );
  }

  const addPractice = async () => {
    if (!resolvedId || !detail || detail.id !== resolvedId || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const genders = targetGenders(addTarget ?? gender);
      await apiClient.post<PracticeCreated[]>("/v1/practices/batch", {
        year_month: detail.year_month, genders, practice: formToRequest(addForm),
      });
      setAdding(false);
      setAddForm(emptyPracticeForm());
      mutateDetail();
      mutateOtherMonths();
      if (!genders.includes(gender)) {
        const destination = otherMonths?.find((m) => m.year_month === detail.year_month);
        setViewGender(genders[0]); setSelectedId(destination?.id ?? null);
      }
    } catch (err) {
      setAddError(errorMessage(err));
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <>
      <AdminHeader title="練習日程管理" />
      <main className="space-y-6 px-4 py-4">
        <div className="flex gap-2" aria-label="表示する性別">
          {(["male", "female"] as const).map((g) => (
            <button key={g} type="button" disabled={addBusy || creating} aria-pressed={gender === g}
              onClick={() => { setViewGender(g); setSelectedId(null); setAdding(false); setAddTarget(null); setAddError(null); }}
              className={`flex-1 rounded-lg border py-2 text-sm font-bold disabled:opacity-50 ${gender === g ? "border-brand-600 bg-brand-50 text-brand-700" : "border-gray-300 text-gray-500"}`}>
              {targetLabel(g)}の日程
            </button>
          ))}
        </div>
        {monthsLoading ? (
          <Loading />
        ) : monthsError ? (
          <ErrorMessage message="データの取得に失敗しました" onRetry={() => mutateMonths()} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <select
                disabled={addBusy || creating}
                value={creating ? "" : (resolvedId ?? "")}
                onChange={(e) => {
                  setCreating(false);
                  setSelectedId(e.target.value || null);
                  setAdding(false); setAddTarget(null); setAddError(null);
                }}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-bold text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                {(!months || months.length === 0) && <option value="">月がありません</option>}
                {months?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatYearMonth(m.year_month)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={addBusy || creating}
                onClick={() => { setCreating(true); setAdding(false); }}
                className="flex-none rounded-lg border border-brand-600 px-3 py-2.5 text-sm font-semibold text-brand-600 hover:bg-brand-50"
              >
                ＋ 月・日程を登録
              </button>
            </div>

            {creating ? (
              <NewMonthForm
                defaultGender={gender}
                onCreated={(created) => {
                  const selected = created.find((m) => m.gender === gender) ?? created[0];
                  setCreating(false);
                  setViewGender(selected.gender);
                  setSelectedId(selected.id);
                  mutateMonths();
                  mutateOtherMonths();
                }}
                onCancel={() => setCreating(false)}
                suggestions={suggestions}
              />
            ) : !resolvedId ? (
              <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                「＋ 月・日程を登録」から練習月を作成してください
              </p>
            ) : detailLoading ? (
              <Loading />
            ) : detailError ? (
              <ErrorMessage message="データの取得に失敗しました" onRetry={() => mutateDetail()} />
            ) : detail ? (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-gray-900">
                    {formatYearMonth(detail.year_month)}
                    <span className="ml-2 text-sm text-gray-500">{targetLabel(detail.gender)}</span>
                  </h2>
                  <span className="text-xs text-gray-500">代表: {user.name}</span>
                </div>

                {detail.gender === user.gender ? <VotePeriodForm
                  key={detail.id}
                  month={detail}
                  onSaved={() => mutateDetail()}
                /> : <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">練習日の追加・編集・男女変更ができます。単独の削除・投票期間の変更と抽選は、担当の代表が行います。</p>}

                <section>
                  <h3 className="mb-2 text-sm font-bold text-gray-900">
                    練習日一覧（{detail.practices.length}件）
                  </h3>
                  <div className="space-y-3">
                    {detail.practices.map((p) => (
                      <PracticeCard
                        key={p.id}
                        practice={p}
                        readOnly={detail.gender !== user.gender}
                        onUpdated={() => { mutateDetail(); mutateOtherMonths(); }}
                        suggestions={suggestions}
                        yearMonth={detail.year_month}
                        onDuplicate={(src) => {
                          // 日付だけ空にして追加フォームを開く
                          setAddForm({ ...practiceToForm(src), practice_date: "" });
                          setAddError(null);
                          setAddTarget(detail.gender);
                          setAdding(true);
                        }}
                      />
                    ))}

                    {adding ? (
                      <div className="rounded-xl border border-gray-200 bg-white p-4">
                        <div className="mb-4">
                          <GenderTargetField value={addTarget ?? gender} onChange={setAddTarget} disabled={addBusy} />
                          <p className="mt-2 text-xs text-gray-500">同じ日付の練習は入力内容に更新し、未登録の日付は追加します。投票・割当は維持します。</p>
                          {targetGenders(addTarget ?? gender).includes(otherGender) && !otherMonths?.some((m) => m.year_month === detail.year_month) && (
                            <p role="status" className="mt-2 text-xs text-amber-700">
                              {otherMonthsError ? "もう一方の月情報を取得できません。一覧を更新してください。" : `${targetLabel(otherGender)}の対象月が未作成、または確認中です。先にその月を作成してください。`}
                            </p>
                          )}
                        </div>
                        <PracticeForm
                          values={addForm}
                          onChange={setAddForm}
                          suggestions={suggestions}
                          yearMonth={detail.year_month}
                          onSubmit={addPractice}
                          onCancel={() => {
                            setAdding(false);
                            setAddForm(emptyPracticeForm());
                            setAddError(null);
                          }}
                          submitLabel="追加・更新する"
                          busy={addBusy}
                          submitDisabled={targetGenders(addTarget ?? gender).includes(otherGender) && !otherMonths?.some((m) => m.year_month === detail.year_month)}
                        />
                        {addError && <p className="mt-2 text-xs text-red-600">{addError}</p>}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setAdding(true); setAddTarget(detail.gender); }}
                        className="w-full rounded-xl border-2 border-dashed border-gray-300 py-3.5 text-sm font-semibold text-gray-500 hover:border-brand-400 hover:text-brand-600"
                      >
                        ＋ 練習日を追加
                      </button>
                    )}
                  </div>
                </section>
              </>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
