"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createHomeGuidePreference, HOME_GUIDE_HIDDEN_KEY } from "@/lib/home-guide-preference";

const preference = createHomeGuidePreference(() => window.localStorage);
function subscribe(listener: () => void) {
  const unsubscribe = preference.subscribe(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === HOME_GUIDE_HIDDEN_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => { unsubscribe(); window.removeEventListener("storage", onStorage); };
}

export function HomeScreenGuide() {
  // ブラウザの設定が読めるまで表示せず、非表示設定済みの案内のちらつきを防ぐ。
  const hidden = useSyncExternalStore(subscribe, preference.getSnapshot, () => true);
  if (hidden) return null;
  return (
    <section aria-label="ホーム画面への追加ガイド" className="overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-sm">
      <Link href="/help/home-screen"
        className="flex min-h-14 items-center gap-3 px-4 py-3 text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-600">
        <span aria-hidden="true" className="text-2xl">⌂</span>
        <span className="flex-1 text-sm font-bold">クエーさんをiOS/Androidアプリのように使う方法</span>
        <span aria-hidden="true">→</span>
      </Link>
      <label className="flex min-h-11 cursor-pointer items-center justify-end gap-2 border-t border-brand-100 px-4 py-2 text-xs text-gray-600">
        <input type="checkbox" checked={false} onChange={(event) => { if (event.target.checked) preference.dismiss(); }}
          className="h-4 w-4 accent-brand-600" />
        今後表示しない（このブラウザ）
      </label>
    </section>
  );
}
