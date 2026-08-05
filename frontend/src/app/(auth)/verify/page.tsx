"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { FormEvent } from "react";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { MailIcon } from "@/components/ui/icons";
import type {
  ResendVerificationRequest,
  UserProfile,
  VerifyEmailRequest,
} from "@/types/api";

const CODE_LENGTH = 6;

function VerifyForm() {
  const router = useRouter();
  const { refresh } = useAuth();
  const searchParams = useSearchParams();
  // 登録直後・ログイン失敗時にクエリで渡される。直接開かれた場合は自分で入力してもらう
  const emailFromQuery = searchParams.get("email") ?? "";

  const [email, setEmail] = useState(emailFromQuery);
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);
    setIsSubmitting(true);

    const body: VerifyEmailRequest = { email, code };
    try {
      // BFF が確認と同時に JWT を Cookie に格納する。ログインし直す必要はない (D-014)
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new ApiClientError(res.status, payload?.error ?? {
          code: "UNKNOWN",
          message: "確認に失敗しました",
        });
      }
      const profile: UserProfile = await res.json();
      await refresh(); // AuthProvider に新しいログイン状態を反映させる
      router.push(profile.role === "representative" ? "/admin" : "/");
    } catch (err) {
      // CODE_EXPIRED / CODE_LOCKED は再送しないと復旧できないため、案内を添える
      if (err instanceof ApiClientError) {
        const needsResend = ["CODE_EXPIRED", "CODE_LOCKED"].includes(err.error.code);
        setErrorMessage(
          needsResend
            ? `${err.error.message}（下の「コードを再送する」から新しいコードを取得してください）`
            : err.error.message,
        );
      } else {
        setErrorMessage(err instanceof Error ? err.message : "確認に失敗しました");
      }
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setErrorMessage(null);
    setInfoMessage(null);

    if (!email) {
      setErrorMessage("メールアドレスを入力してください");
      return;
    }

    setIsResending(true);
    const body: ResendVerificationRequest = { email };
    try {
      await apiClient.post<void>("/v1/auth/verify/resend", body);
      setCode("");
      setInfoMessage("新しい確認コードを送信しました。以前のコードは無効になります");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "再送に失敗しました");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-white px-6 py-12">
      {/* ロゴ・タイトル */}
      <div className="mb-8 text-center">
        <div className="mb-4 flex justify-center text-brand-600">
          <MailIcon width={48} height={48} />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">メールアドレスの確認</h1>
        <p className="mt-2 text-sm text-gray-500">
          {emailFromQuery ? (
            <>
              <span className="font-medium text-gray-700">{emailFromQuery}</span> 宛に
              <br />
              6桁の確認コードを送信しました
            </>
          ) : (
            "登録したメールアドレスに届いた6桁のコードを入力してください"
          )}
        </p>
      </div>

      {/* 入力カード */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        {errorMessage && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">{errorMessage}</p>
          </div>
        )}
        {infoMessage && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-sm text-green-700">{infoMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* クエリでメールが渡らなかった場合のみ入力させる */}
          {!emailFromQuery && (
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
          )}

          <div className="mb-6">
            <label htmlFor="code" className="mb-1 block text-sm font-medium text-gray-700">
              確認コード
            </label>
            <input
              type="text"
              id="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              pattern="\d{6}"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] indent-[0.5em] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <p className="mt-1 text-xs text-gray-500">有効期限は15分です</p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || code.length !== CODE_LENGTH}
            className="h-12 w-full rounded-lg bg-brand-600 font-bold text-white transition-colors hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50"
          >
            {isSubmitting ? "確認中..." : "確認する"}
          </button>
        </form>
      </div>

      {/* 再送・戻る */}
      <div className="mt-6 space-y-3 text-center">
        <p>
          <button
            type="button"
            onClick={handleResend}
            disabled={isResending}
            className="text-sm font-medium text-brand-600 hover:underline disabled:opacity-50"
          >
            {isResending ? "送信中..." : "コードを再送する"}
          </button>
        </p>
        <p className="text-xs text-gray-500">
          メールが届かない場合は迷惑メールフォルダもご確認ください
        </p>
        <p>
          <Link href="/login" className="text-sm text-brand-600 hover:underline">
            ログイン画面に戻る
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  // useSearchParams は Suspense 境界が必要 (Next.js App Router)
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}
