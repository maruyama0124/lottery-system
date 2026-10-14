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
  return { ...state, store };
}
