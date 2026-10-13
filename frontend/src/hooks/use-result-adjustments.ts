"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { apiClient } from "@/lib/api-client";
import { ResultAdjustments } from "@/lib/result-adjustments";

export function useResultAdjustments(monthId: string | null) {
  const store = useMemo(() => new ResultAdjustments(monthId, apiClient), [monthId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  useEffect(() => {
    if (!state.saving.size) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.saving.size]);
  return { ...state, store };
}
