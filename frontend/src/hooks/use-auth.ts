"use client";

// 認証フック — 共通基盤。画面実装で変更しないこと (READ ONLY)
export { useAuth } from "@/lib/auth-context";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

export function useRequireAuth(redirectTo = "/line") {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.push(redirectTo);
  }, [user, isLoading, router, redirectTo]);

  return { user, isLoading };
}

/** 代表権限ガード — member がアクセスしたらメンバーホームへ戻す */
export function useRequireRepresentative() {
  const { user, isLoading } = useRequireAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user && user.role !== "representative") router.push("/");
  }, [user, isLoading, router]);

  return { user, isLoading };
}
