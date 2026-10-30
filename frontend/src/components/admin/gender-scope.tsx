"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { Gender } from "@/types/api";

const GenderScope = createContext<{
  gender: Gender;
  setGender: (gender: Gender) => void;
  busy: boolean;
  setLock: (id: string, locked: boolean) => void;
} | null>(null);

/** 対象性別は管理画面だけの状態。本人の性別・投票先は変更しない。 */
export function AdminGenderProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [selection, setSelection] = useState<{ userId: string; gender: Gender } | null>(null);
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const setLock = useCallback((id: string, locked: boolean) => setLocks((previous) => {
    if (previous.has(id) === locked) return previous;
    const next = new Set(previous);
    if (locked) next.add(id); else next.delete(id);
    return next;
  }), []);
  const gender = selection && selection.userId === user?.id ? selection.gender : user?.gender ?? "male";
  const value = useMemo(() => ({
    gender,
    busy: locks.size > 0,
    setGender: (next: Gender) => {
      if (user) setSelection({ userId: user.id, gender: next });
    },
    setLock,
  }), [gender, locks, user, setLock]);
  return <GenderScope.Provider value={value}>
    {/* 性別切替時は編集中の月・人数・微調整・エラーを持ち越さない。 */}
    <div key={`${user?.id}:${gender}`}>{children}</div>
  </GenderScope.Provider>;
}

export function useAdminGender() {
  const scope = useContext(GenderScope);
  if (!scope) throw new Error("AdminGenderProvider is required");
  return scope;
}

export function useAdminGenderLock(busy: boolean) {
  const { setLock } = useAdminGender();
  const id = useId();
  useEffect(() => {
    setLock(id, busy);
    return () => setLock(id, false);
  }, [id, busy, setLock]);
}

export function AdminGenderSelector() {
  const { gender, setGender, busy } = useAdminGender();
  return <div className="mt-3 flex gap-2" role="group" aria-label="管理対象の性別">
    {(["male", "female"] as const).map((g) => <button key={g} type="button"
      disabled={busy} aria-pressed={gender === g} onClick={() => setGender(g)}
      className={`flex-1 rounded-lg border py-2 text-sm font-bold disabled:opacity-50 ${gender === g ? "border-brand-600 bg-brand-50 text-brand-700" : "border-gray-300 text-gray-500"}`}>
      {g === "male" ? "男子を管理" : "女子を管理"}
    </button>)}
  </div>;
}
