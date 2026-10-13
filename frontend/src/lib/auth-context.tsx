"use client";

// 認証コンテキスト — logout/me は BFF (/api/auth/*) 経由。JWT には触らない
// ログインは LINE ログイン (/line) が担う (D-042)
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import type { UserProfile } from "@/types/api";
import { clearMemberHomes, listenForMemberInvalidation } from "@/lib/member-cache";
import { userScope } from "@/lib/member-home";

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  acceptLogin: (user: UserProfile) => void;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const revision = useRef(0);
  const current = useRef<UserProfile | null>(null);
  const applyUser = useCallback((next: UserProfile | null) => {
    if (!next || (current.current && userScope(current.current) !== userScope(next))) clearMemberHomes();
    current.current = next;
    setUser(next);
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (pending.current) return pending.current;
    const version = revision.current;
    pending.current = (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        if (!res.ok && res.status !== 401) throw new Error("ログイン状態を確認できませんでした");
        const next = res.ok ? await res.json() : null;
        if (version !== revision.current) return;
        applyUser(next);
        setError(null);
      } catch {
        if (version === revision.current) setError("ログイン状態を確認できませんでした");
      } finally {
        pending.current = null;
        if (version === revision.current) setIsLoading(false);
      }
    })();
    return pending.current;
  }, [applyUser]);

  const acceptLogin = useCallback((next: UserProfile) => {
    revision.current++;
    applyUser(next);
    setIsLoading(false);
    setError(null);
    try { localStorage.setItem("lottery:auth:changed", String(Date.now())); } catch { /* optional */ }
  }, [applyUser]);

  useEffect(() => {
    void refresh();
    const resetSession = () => {
      revision.current++;
      applyUser(null);
      setIsLoading(true);
      const previous = pending.current;
      void Promise.resolve(previous).then(refresh);
    };
    const onAuth = (event: StorageEvent) => {
      if (event.key === "lottery:auth:changed") resetSession();
    };
    window.addEventListener("storage", onAuth);
    window.addEventListener("lottery:session-expired", resetSession);
    const stop = listenForMemberInvalidation(() => {});
    return () => {
      window.removeEventListener("storage", onAuth);
      window.removeEventListener("lottery:session-expired", resetSession);
      stop();
    };
  }, [refresh, applyUser]);

  const logout = useCallback(async () => {
    const res = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    if (!res.ok) throw new Error("ログアウトに失敗しました");
    revision.current++;
    applyUser(null);
    try { localStorage.setItem("lottery:auth:changed", String(Date.now())); } catch { /* optional */ }
  }, [applyUser]);

  return (
    <AuthContext.Provider value={{ user, isLoading, logout, refresh, acceptLogin, error }}>
      {error ? (
        <div role="alert" className="p-6 text-center">
          <p>{error}</p>
          <button className="mt-3 text-brand-600" onClick={() => void refresh()}>再試行</button>
        </div>
      ) : (
        <SWRConfig key={user ? userScope(user) : "anonymous"} value={{ provider: () => new Map() }}>
          {children}
        </SWRConfig>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
