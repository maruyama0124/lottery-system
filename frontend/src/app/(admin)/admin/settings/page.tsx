"use client";

// 設定 — 抽選設定・代表権限の引き継ぎ・メンバーの無効化 (D-009)
import { useState } from "react";
import { AdminHeader } from "@/components/admin/header";
import { ErrorMessage } from "@/components/ui/error-message";
import { Loading } from "@/components/ui/loading";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useRequireRepresentative } from "@/hooks/use-auth";
import type { LotterySettings, RosterPage, UserProfile } from "@/types/api";

function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.error.message;
  return "エラーが発生しました";
}

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-600";
const selectClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-600";

function SuccessMessage({ text }: { text: string }) {
  return (
    <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
      {text}
    </p>
  );
}

// ---------- セクション1: 抽選設定 ----------

function AlphaForm({ initial }: { initial: string | number }) {
  const [alpha, setAlpha] = useState(String(initial));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setSaved(false);
    setSaveError(null);
    try {
      await apiClient.put<LotterySettings>("/v1/settings", {
        rescue_alpha: Number(alpha),
      });
      setSaved(true);
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label htmlFor="rescue-alpha" className="mb-1 block text-sm font-medium text-gray-700">
        落選救済係数 α
      </label>
      <input
        id="rescue-alpha"
        type="number"
        step={0.1}
        min={0}
        value={alpha}
        onChange={(e) => setAlpha(e.target.value)}
        className={inputClass}
      />
      <p className="mt-2 text-xs text-gray-500">
        前月あまり参加できなかった人への優遇（当選枠の優先確保と並び順）は自動で働きます。
        α は当選率が同点で並んだ人どうしのくじ引きの重み（1 + α × 前月落選数）で、
        結果への影響はわずかです。通常は変更不要です
      </p>
      {saveError && <p className="mt-2 text-xs text-red-600">{saveError}</p>}
      {saved && <SuccessMessage text="抽選設定を保存しました" />}
      <button
        type="button"
        onClick={save}
        disabled={alpha === "" || Number(alpha) < 0 || busy}
        className="mt-4 w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        保存する
      </button>
    </>
  );
}

function LotterySettingsSection() {
  const { data, error, isLoading, mutate } = useApi<LotterySettings>("/v1/settings");

  return (
    <section className="rounded-xl border border-gray-200 p-4 shadow-sm">
      <h2 className="mb-3 font-bold text-gray-900">抽選設定</h2>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorMessage message="設定の取得に失敗しました" onRetry={() => mutate()} />
      ) : data ? (
        <AlphaForm initial={data.rescue_alpha} />
      ) : null}
    </section>
  );
}

// ---------- セクション2/3 共通: メンバー選択 ----------

function memberLabel(u: UserProfile): string {
  return `${u.name}（${u.grade}年・${u.gender === "male" ? "男" : "女"}）`;
}

// ---------- セクション2: 代表権限の引き継ぎ ----------

function TransferSection({
  members,
  onChanged,
}: {
  members: UserProfile[];
  onChanged: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transfer = async () => {
    const target = members.find((m) => m.id === selectedId);
    if (!target) return;
    if (!window.confirm(`${memberLabel(target)} に代表権限を付与しますか？`)) return;
    setBusy(true);
    setDone(false);
    setError(null);
    try {
      await apiClient.put<UserProfile>(`/v1/users/${target.id}/role`, {
        role: "representative",
      });
      setDone(true);
      setSelectedId("");
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 p-4 shadow-sm">
      <h2 className="mb-3 font-bold text-gray-900">代表権限の引き継ぎ</h2>
      <label htmlFor="transfer-target" className="mb-1 block text-sm font-medium text-gray-700">
        引き継ぎ先メンバー
      </label>
      <select
        id="transfer-target"
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className={selectClass}
      >
        <option value="">メンバーを選択</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {memberLabel(m)}
          </option>
        ))}
      </select>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {done && <SuccessMessage text="代表権限を付与しました" />}
      <button
        type="button"
        onClick={transfer}
        disabled={!selectedId || busy}
        className="mt-4 w-full rounded-lg border border-brand-600 py-2.5 text-sm font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50"
      >
        代表権限を付与
      </button>
      <p className="mt-2 text-xs text-gray-500">付与すると相手も代表として全機能を使えます</p>
    </section>
  );
}

// ---------- セクション3: メンバーの無効化 ----------

function DeactivateSection({
  members,
  onChanged,
}: {
  members: UserProfile[];
  onChanged: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deactivate = async () => {
    const target = members.find((m) => m.id === selectedId);
    if (!target) return;
    if (
      !window.confirm(
        `${memberLabel(target)} を無効化しますか？\nこの操作は取り消せません。`,
      )
    )
      return;
    setBusy(true);
    setDone(false);
    setError(null);
    try {
      await apiClient.delete<void>(`/v1/users/${target.id}`);
      setDone(true);
      setSelectedId("");
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
      <h2 className="mb-2 font-bold text-red-700">メンバーの無効化</h2>
      <p className="mb-4 text-sm text-red-600">卒業・退会したメンバーを抽選対象から外します</p>
      <label htmlFor="deactivate-target" className="mb-1 block text-sm font-medium text-gray-700">
        無効化するメンバー
      </label>
      <select
        id="deactivate-target"
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className={selectClass}
      >
        <option value="">メンバーを選択</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {memberLabel(m)}
          </option>
        ))}
      </select>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {done && <SuccessMessage text="メンバーを無効化しました" />}
      <button
        type="button"
        onClick={deactivate}
        disabled={!selectedId || busy}
        className="mt-4 w-full rounded-lg border border-red-500 bg-white py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50"
      >
        無効化する
      </button>
    </section>
  );
}

// ---------- ページ本体 ----------

export default function AdminSettingsPage() {
  const { user, isLoading: authLoading } = useRequireRepresentative();
  const {
    data: roster,
    error: rosterError,
    isLoading: rosterLoading,
    mutate: mutateRoster,
  } = useApi<RosterPage>("/v1/users?per_page=200");

  if (authLoading || !user) {
    return (
      <>
        <AdminHeader title="設定" />
        <Loading />
      </>
    );
  }

  const members = (roster?.items ?? []).filter(
    (u) => u.role === "member" && u.id !== user.id,
  );
  // 権限付与は男女全体 (D-040)。無効化は担当性別のみ (NFR-002.4)
  const sameGender = members.filter((u) => u.gender === user.gender);

  return (
    <>
      <AdminHeader title="設定" />
      <main className="space-y-4 px-4 py-4">
        <LotterySettingsSection />

        {rosterLoading ? (
          <Loading />
        ) : rosterError ? (
          <ErrorMessage message="名簿の取得に失敗しました" onRetry={() => mutateRoster()} />
        ) : (
          <>
            <TransferSection members={members} onChanged={() => mutateRoster()} />
            <DeactivateSection members={sameGender} onChanged={() => mutateRoster()} />
          </>
        )}

        <p className="pt-4 text-center text-xs text-gray-400">練習抽選システム v1.0</p>
      </main>
    </>
  );
}
