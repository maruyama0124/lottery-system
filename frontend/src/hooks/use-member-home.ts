"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getMemberHomeStore, type HomeState } from "@/lib/member-cache";
import type { Gender, UserProfile } from "@/types/api";

const EMPTY: HomeState = { refreshing: false, stale: true, error: null };
const emptySnapshot = () => EMPTY;
const emptySubscribe = () => () => {};

export function useMemberHome(user: UserProfile | null, gender: Gender | null, month: string | null) {
  // 認証確認前にはストレージを読まない。
  const store = useMemo(() => user && gender ? getMemberHomeStore(user, gender, month) : null, [user, gender, month]);
  const state = useSyncExternalStore(store?.subscribe ?? emptySubscribe, store?.getSnapshot ?? emptySnapshot, emptySnapshot);
  useEffect(() => {
    if (!store) return;
    void store.refresh();
    const refresh = () => { if (document.visibilityState === "visible") void store.refresh(); };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [store]);
  return { ...state, refresh: store?.refresh ?? (async () => {}) };
}
