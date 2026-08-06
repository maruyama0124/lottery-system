"use client";

// LINE ログインの入口 (D-021)
// LIFF の Endpoint URL にこのページを指定する。LINE アプリ内で開かれた場合は
// ログイン済みのため、画面を出さずにそのまま投票画面へ遷移する。
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Quasar } from "@/components/quasar";

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
      <div className="flex min-h-screen flex-col items-center justify-center bg-brand-50 px-6">
        <Quasar mood="wait" size={120} className="animate-pulse" />
        <p className="mt-4 text-sm font-semibold text-gray-500">読み込んでいます...</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-brand-50 px-6">
        <Quasar mood="sad" size={120} />
        <div className="mt-5 w-full rounded-3xl bg-white p-6 text-center shadow-sm">
          <p className="font-bold text-gray-800">{errorMessage}</p>
          <p className="mt-2 text-sm text-gray-500">
            LINE アプリから開き直してください
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-50 px-5 py-10">
      <div className="mb-6 text-center">
        <Quasar mood="happy" size={120} className="mx-auto" />
        <p className="mt-3 text-xl font-bold text-brand-700">
          練習抽選bot クエーさん
        </p>
        <p className="mt-2 font-bold text-gray-800">
          {displayName ? `${displayName} さん` : "ようこそ"}
        </p>
        <p className="mt-1 text-sm text-gray-500">初回のみ登録をお願いします</p>
      </div>

      <div className="rounded-3xl bg-white p-6 shadow-sm">
        {errorMessage && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">{errorMessage}</p>
          </div>
        )}
        <form onSubmit={handleRegister}>
          <div className="mb-4">
            <label htmlFor="name" className="mb-1.5 block text-sm font-bold text-gray-700">
              名前（本名）
            </label>
            <input
              type="text"
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="山田 太郎"
              className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3.5 text-base focus:border-brand-500 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-gray-500">
              代表が抽選結果を確認するため、本名で入力してください
            </p>
          </div>

          <div className="mb-4">
            <span className="mb-1.5 block text-sm font-bold text-gray-700">学年</span>
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3"].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrade(g)}
                  className={`rounded-2xl py-3.5 text-base font-bold transition-colors ${
                    grade === g
                      ? "bg-brand-600 text-white"
                      : "border-2 border-gray-200 text-gray-500"
                  }`}
                >
                  {g}年
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <span className="mb-1.5 block text-sm font-bold text-gray-700">
              男子 / 女子
            </span>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "male", label: "男子" },
                { value: "female", label: "女子" },
              ].map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGender(g.value)}
                  className={`rounded-2xl py-3.5 text-base font-bold transition-colors ${
                    gender === g.value
                      ? "bg-brand-600 text-white"
                      : "border-2 border-gray-200 text-gray-500"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">抽選は男女それぞれ別に行われます</p>
          </div>

          <div className="mb-6">
            <button
              type="button"
              onClick={() => setIsManager(!isManager)}
              className={`flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-colors ${
                isManager ? "bg-brand-50" : "bg-gray-50"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  isManager
                    ? "bg-brand-600 text-white"
                    : "border-2 border-gray-200 text-transparent"
                }`}
              >
                ✓
              </span>
              <span className="text-sm font-bold text-gray-700">マネージャーです</span>
            </button>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-brand-600 py-4 text-base font-bold text-white shadow-lg shadow-brand-200 active:scale-[0.98] disabled:opacity-60"
          >
            {isSubmitting ? "登録中..." : "登録する"}
          </button>
        </form>
      </div>
    </div>
  );
}
