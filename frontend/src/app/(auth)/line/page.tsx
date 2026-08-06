"use client";

// LINE ログインの入口 (D-021)
// LIFF の Endpoint URL にこのページを指定する。LINE アプリ内で開かれた場合は
// ログイン済みのため、画面を出さずにそのまま投票画面へ遷移する。
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/hooks/use-auth";
import { VolleyballIcon } from "@/components/ui/icons";

type Phase = "loading" | "register" | "error";

export default function LineLoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  // 登録フォーム
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("1");
  const [gender, setGender] = useState("male");
  const [isManager, setIsManager] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ID トークンは登録時にも必要になるため保持する (再取得は不可)
  const idTokenRef = useRef<string | null>(null);

  const goHome = useCallback(async () => {
    await refresh();
    router.replace("/");
  }, [refresh, router]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      if (!liffId) {
        setErrorMessage("LIFF ID が設定されていません");
        setPhase("error");
        return;
      }

      try {
        // SSR 時に window を参照して落ちるため、ブラウザ側でのみ読み込む
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId });

        if (!liff.isLoggedIn()) {
          // 外部ブラウザで開かれた場合はここで LINE の認可画面へ飛ぶ。
          // LINE アプリ内であればログイン済みのため、この分岐には入らない
          liff.login();
          return;
        }

        const idToken = liff.getIDToken();
        if (!idToken) {
          setErrorMessage("LINE の認証情報を取得できませんでした");
          setPhase("error");
          return;
        }
        idTokenRef.current = idToken;

        const res = await fetch("/api/auth/line", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_token: idToken }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message ?? "ログインに失敗しました");
        }

        const data = await res.json();
        if (cancelled) return;

        if (data.registered) {
          await goHome();
          return;
        }
        setDisplayName(data.display_name ?? null);
        setPhase("register");
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : "ログインに失敗しました");
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [goHome]);

  const handleRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/line/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_token: idTokenRef.current,
          name,
          grade: Number(grade),
          gender,
          is_manager: isManager,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? "登録に失敗しました");
      }
      await goHome();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "登録に失敗しました");
      setIsSubmitting(false);
    }
  };

  if (phase === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
        <div className="mb-4 text-brand-600">
          <VolleyballIcon width={48} height={48} />
        </div>
        <p className="text-sm text-gray-500">読み込んでいます...</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
        <div className="w-full rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-600">{errorMessage}</p>
          <p className="mt-3 text-xs text-red-500">
            LINE アプリから開き直してみてください
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-white px-6 py-12">
      <div className="mb-8 text-center">
        <div className="mb-4 flex justify-center text-brand-600">
          <VolleyballIcon width={60} height={60} />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">はじめての登録</h1>
        <p className="mt-2 text-sm text-gray-500">
          {displayName ? `${displayName} さん、こんにちは` : "こんにちは"}
        </p>
        <p className="mt-1 text-sm text-gray-500">最初の1回だけ入力をお願いします</p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        {errorMessage && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">{errorMessage}</p>
          </div>
        )}
        <form onSubmit={handleRegister}>
          <div className="mb-4">
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
              名前（本名）
            </label>
            <input
              type="text"
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="山田 太郎"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <p className="mt-1 text-xs text-gray-500">
              代表が抽選結果を確認するため、本名で入力してください
            </p>
          </div>

          <div className="mb-4">
            <label htmlFor="grade" className="mb-1 block text-sm font-medium text-gray-700">
              学年
            </label>
            <select
              id="grade"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="1">1年</option>
              <option value="2">2年</option>
              <option value="3">3年</option>
            </select>
          </div>

          <div className="mb-4">
            <label htmlFor="gender" className="mb-1 block text-sm font-medium text-gray-700">
              男子 / 女子
            </label>
            <select
              id="gender"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="male">男子</option>
              <option value="female">女子</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">抽選は男女それぞれ別に行われます</p>
          </div>

          <div className="mb-6">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={isManager}
                onChange={(e) => setIsManager(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600"
              />
              マネージャーです
            </label>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="h-12 w-full rounded-lg bg-brand-600 font-bold text-white transition-colors hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50"
          >
            {isSubmitting ? "登録中..." : "登録して投票へ"}
          </button>
        </form>
      </div>
    </div>
  );
}
