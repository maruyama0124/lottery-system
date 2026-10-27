"use client";

import { useState } from "react";

const BROWSER_URL = "https://liff.line.me/2010994046-WzxKysKA";

export function CopyHomeUrl() {
  const [message, setMessage] = useState("");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(BROWSER_URL);
      setMessage("コピー完了。Safari／Chromeのアドレス欄に貼り付けてください。");
    } catch {
      setMessage("上のURLを長押ししてコピーしてください。");
    }
  };

  return (
    <div className="mt-4">
      <input aria-label="ブラウザで開くURL（長押しでコピー）" readOnly value={BROWSER_URL} onFocus={(event) => event.currentTarget.select()} className="mb-3 w-full rounded-lg border border-brand-200 bg-white p-3 text-sm text-gray-700" />
      <button type="button" onClick={copy} className="min-h-11 w-full rounded-xl bg-brand-700 px-4 py-3 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">
        URLをコピー
      </button>
      <p role="status" className="mt-2 text-sm leading-relaxed text-brand-800">{message}</p>
    </div>
  );
}
