"use client";

// 認証コンテキスト — login/logout/me は BFF (/api/auth/*) 経由。JWT には触らない
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { UserProfile } from "@/types/api";

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** ログイン失敗を error.code つきで通知する (例: EMAIL_NOT_VERIFIED → 確認画面へ誘導) */
export class LoginError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "LoginError";
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
    if (res.ok) setUser(await res.json());
    else setUser(null);
  }, []);

  useEffect(() => {
    // 外部システム (BFF セッション) との同期。完了コールバックで setState する
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new LoginError(
        body?.error?.code ?? "UNAUTHORIZED",
        body?.error?.message ?? "ログインに失敗しました",
      );
    }
    const profile: UserProfile = await res.json();
    setUser(profile);
    return profile;
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
