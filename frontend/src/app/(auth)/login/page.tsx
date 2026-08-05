"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/hooks/use-auth";
import { LoginError } from "@/lib/auth-context";
import { VolleyballIcon } from "@/components/ui/icons";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const profile = await login(email, password);
      router.push(profile.role === "representative" ? "/admin" : "/");
    } catch (err) {
      // メール未確認はエラー表示ではなく確認画面へ誘導する (D-012)
      if (err instanceof LoginError && err.code === "EMAIL_NOT_VERIFIED") {
        router.push(`/verify?email=${encodeURIComponent(email)}`);
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : "ログインに失敗しました");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-white px-6 py-12">
      {/* ロゴ・タイトル */}
      <div className="mb-8 text-center">
        <div className="mb-4 flex justify-center text-brand-600">
          <VolleyballIcon width={60} height={60} />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">練習抽選システム</h1>
        <p className="mt-2 text-sm text-gray-500">サークル練習参加抽選システム</p>
      </div>

      {/* ログインカード */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        {errorMessage && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">{errorMessage}</p>
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
              メールアドレス
            </label>
            <input
              type="email"
              id="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="taro.yamada@example.com"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
          <div className="mb-6">
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
              パスワード
            </label>
            <input
              type="password"
              id="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="h-12 w-full rounded-lg bg-brand-600 font-bold text-white transition-colors hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50"
          >
            {isSubmitting ? "ログイン中..." : "ログイン"}
          </button>
        </form>
      </div>

      {/* リンク */}
      <div className="mt-6 space-y-3 text-center">
        <p>
          <Link href="/register" className="text-sm font-medium text-brand-600 hover:underline">
            新規登録はこちら
          </Link>
        </p>
        <p>
          <button type="button" className="cursor-default text-sm text-brand-600">
            パスワードを忘れた方
          </button>
        </p>
      </div>
    </div>
  );
}
