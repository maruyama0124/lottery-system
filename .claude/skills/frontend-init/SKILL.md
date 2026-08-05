---
description: "Next.jsフロントエンド初期構築 — Docker Compose/TypeScript/Tailwind CSS設定を一括生成"
---

# /frontend-init

## 概要
`npx create-next-app@latest` (最新CLI) で Next.js プロジェクトを `frontend/` にスキャフォールド。Docker Compose (開発サーバー)、TypeScript、Tailwind CSS、共通レイアウト・ユーティリティを設定する。

## 入力ドキュメント
- `specification/docs/ui-design/index.md` — 画面設計書 (共通レイアウト参照)
- `specification/docs/ui-design/screen-designs.yaml` — 画面定義YAML (layout 種別参照)

## 出力ドキュメント
- `frontend/` 配下のプロジェクト一式:
  - `package.json`, `tsconfig.json`, `Dockerfile`, `docker-compose.yaml`
  - `.env.example`, `.env.local`, `.gitignore`
  - `next.config.ts`, `tailwind.config.ts`
- `frontend/src/app/layout.tsx` — ルートレイアウト
- `frontend/src/app/(customer)/layout.tsx` — モバイル顧客レイアウト
- `frontend/src/app/(admin)/layout.tsx` — デスクトップ管理画面レイアウト
- `frontend/src/lib/api-client.ts` — API クライアントユーティリティ (Cookie ベース)
- `frontend/src/lib/auth-context.tsx` — 認証コンテキストプロバイダー
- `frontend/src/lib/auth/dal.ts` — Data Access Layer (Server only: `getSessionUser` / `getValidAccessToken` / `refreshAccessToken`)
- `frontend/src/app/api/auth/login/route.ts` — BFF ログイン (Cookie 発行)
- `frontend/src/app/api/auth/refresh/route.ts` — BFF リフレッシュ
- `frontend/src/app/api/auth/logout/route.ts` — BFF ログアウト (Cookie 削除)
- `frontend/src/app/api/auth/me/route.ts` — 現在セッション取得
- `frontend/src/app/api/[...proxy]/route.ts` — `/api/v1/*` を Bearer 付与でバックエンドに中継 (401 時 refresh 再試行)
- `frontend/proxy.ts` — 未ログイン時のリダイレクト (Next.js 16 `proxy.ts` file convention、旧 middleware.ts は deprecated)
- `frontend/src/components/ui/loading.tsx` — 共通ローディングコンポーネント
- `frontend/src/components/ui/error-message.tsx` — 共通エラーメッセージコンポーネント

## ワークフロー

1. **スキャフォールド**: `npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"` を実行
   - プロンプトが出る場合は全てデフォルトを選択
2. **追加パッケージインストール**:
   ```bash
   cd frontend && npm install swr
   ```
3. **Docker Compose 生成** (`frontend/docker-compose.yaml`):
   - `web` サービス: Node.js 22, ポート 3000, ホットリロード対応
   - volumes でソースコードをマウント (node_modules, .next は除外)
4. **Dockerfile 生成** (`frontend/Dockerfile`):
   - Node.js 22-slim ベース
   - npm ci → next dev (開発用)
5. **環境変数ファイル生成**:
   - `.env.example` に全環境変数のテンプレート
   - `.env.local` に開発用デフォルト値をコピー
   - `.gitignore` に `.env.local` を追加 (create-next-app のデフォルトで含まれているが確認)
6. **BFF Route Handler 作成**: `src/app/api/[...proxy]/route.ts` で `/api/v1/*` をバックエンドに中継 (Cookie の `access_token` を Bearer に載せ替え)。`next.config.ts` の rewrites は使わない
7. **tailwind.config.ts 更新**: ブランドカラー (brand = purple 系)、日本語フォント設定
8. **共通ディレクトリ構造生成**:
   ```
   frontend/src/
   ├── app/
   │   ├── layout.tsx           # ルートレイアウト
   │   ├── globals.css          # Tailwind globals (create-next-app で生成済み)
   │   ├── (customer)/          # 顧客向けモバイル画面
   │   │   └── layout.tsx
   │   └── (admin)/             # 管理者向けデスクトップ画面
   │       └── layout.tsx
   ├── components/
   │   ├── ui/                  # 共通UIコンポーネント
   │   │   ├── loading.tsx
   │   │   └── error-message.tsx
   │   ├── customer/            # 顧客向け共通コンポーネント
   │   │   └── header.tsx
   │   └── admin/               # 管理者向け共通コンポーネント
   │       └── sidebar.tsx
   └── lib/
       ├── api-client.ts        # API クライアント
       └── auth-context.tsx     # 認証コンテキスト
   ```
9. **ルートレイアウト生成** (`src/app/layout.tsx`):
   - 日本語 (`lang="ja"`) 設定
   - AuthProvider ラップ
10. **顧客レイアウト生成** (`src/app/(customer)/layout.tsx`):
    - モバイル向け: `max-width: 480px`, `margin: 0 auto`
    - sticky ヘッダー、ブランドカラー `brand-600`
11. **管理画面レイアウト生成** (`src/app/(admin)/layout.tsx`):
    - サイドバーレイアウト (`w-64` 固定幅)
    - デスクトップ幅前提
12. **共通ユーティリティ生成**:
    - `src/lib/api-client.ts` — fetch ラッパー (Cookie 自動送信 `credentials: 'include'`、エラーハンドリング)。Authorization ヘッダは付けない
    - `src/lib/auth-context.tsx` — `login/logout/refresh/me` を `/api/auth/*` BFF 経由で呼ぶ。JWT は触らない
    - `src/lib/auth/dal.ts` — Server only。`getSessionUser` / `getValidAccessToken` / `refreshAccessToken`
    - `src/app/api/auth/login/route.ts`、`.../refresh/route.ts`、`.../logout/route.ts`、`.../me/route.ts` — BFF
    - `src/app/api/[...proxy]/route.ts` — `/api/v1/*` を Bearer に載せ替えてバックエンドに中継
    - `proxy.ts` — `matcher` で保護ルートを指定、Cookie の有無だけで軽量チェック
    - `src/components/ui/loading.tsx` — スピナー + スケルトン
    - `src/components/ui/error-message.tsx` — エラー表示
    - `src/components/customer/header.tsx` — 顧客向け sticky ヘッダー
    - `src/components/admin/sidebar.tsx` — 管理画面サイドバー
13. **動作確認**: `docker compose -f frontend/docker-compose.yaml build`

## テンプレート

### docker-compose.yaml
```yaml
services:
  web:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
      - /app/.next
    env_file:
      - .env.local
    working_dir: /app
```

### Dockerfile
```dockerfile
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npx", "next", "dev"]
```

### .env.example
```
# バックエンド API 転送先 (BFF `/api/[...proxy]/route.ts` が読む)
API_URL=http://host.docker.internal:8080
# フロントのブラウザ側で公開して良い値のみここに置く (API_URL はサーバー専用)
NEXT_PUBLIC_API_URL=/api
```

### next.config.ts
```typescript
import type { NextConfig } from 'next';

// rewrites は使わない (BFF Route Handler で中継)
const nextConfig: NextConfig = {};

export default nextConfig;
```

### tailwind.config.ts (追加設定部分)
```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7e22ce',
          800: '#6b21a8',
          900: '#581c87',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Hiragino Sans"',
          '"Hiragino Kaku Gothic ProN"',
          'Meiryo',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
```

### src/app/layout.tsx
```typescript
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'サロン予約システム',
  description: 'サロン予約管理システム',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

### src/app/(customer)/layout.tsx
```typescript
import { CustomerHeader } from '@/components/customer/header';

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[480px] min-h-screen bg-gray-50">
      <CustomerHeader />
      <main className="px-4 pb-8">{children}</main>
    </div>
  );
}
```

### src/app/(admin)/layout.tsx
```typescript
import { AdminSidebar } from '@/components/admin/sidebar';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1 p-6 bg-gray-50">{children}</main>
    </div>
  );
}
```

### src/lib/api-client.ts
```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

class ApiClientError extends Error {
  constructor(
    public status: number,
    public error: ApiError,
  ) {
    super(error.message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // 認証は httpOnly Cookie 経由 — Authorization ヘッダは付けない
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include', // 同一オリジン Cookie を自動送信
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({
      error: { code: 'UNKNOWN', message: res.statusText },
    }));
    throw new ApiClientError(res.status, body.error);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export { ApiClientError };
export type { ApiError };
```

### src/lib/auth-context.tsx
```typescript
'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';

interface AuthUser {
  userId: number;
  workspaceId: number;
  role: string;
  email?: string;
  displayName?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 起動時に BFF で現在セッションを取得。Cookie は httpOnly のため JS から直接読まない。
  const refresh = useCallback(async () => {
    const res = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
    if (res.ok) setUser(await res.json());
    else setUser(null);
  }, []);

  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? 'ログインに失敗しました');
    }
    setUser(await res.json());
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
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
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
```

### src/app/api/auth/login/route.ts (BFF)
ブラウザ ↔ Next.js 間は Cookie のみ。Next.js ↔ バックエンド間は Bearer でトークンを中継。

```typescript
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const BACKEND_URL = process.env.API_URL ?? 'http://localhost:8080';
const ACCESS_MAX_AGE = 60 * 60;             // 1h
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;   // 7d
const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { code: 'UNAUTHORIZED', message: '認証失敗' } }));
    return NextResponse.json(err, { status: res.status });
  }
  const data = await res.json(); // { accessToken, refreshToken, user }
  const store = await cookies();
  store.set('access_token', data.accessToken, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
  store.set('refresh_token', data.refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
  return NextResponse.json(data.user);
}
```

### src/app/api/auth/refresh/route.ts
```typescript
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const BACKEND_URL = process.env.API_URL ?? 'http://localhost:8080';
const ACCESS_MAX_AGE = 60 * 60;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;
const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

export async function POST() {
  const store = await cookies();
  const refreshToken = store.get('refresh_token')?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'no refresh' } }, { status: 401 });
  }
  const res = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!res.ok) {
    store.delete('access_token');
    store.delete('refresh_token');
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'refresh failed' } }, { status: 401 });
  }
  const data = await res.json();
  store.set('access_token', data.accessToken, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
  if (data.refreshToken) {
    store.set('refresh_token', data.refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
  }
  return NextResponse.json({ ok: true });
}
```

### src/app/api/auth/logout/route.ts
```typescript
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  const store = await cookies();
  store.delete('access_token');
  store.delete('refresh_token');
  return NextResponse.json({ ok: true });
}
```

### src/app/api/auth/me/route.ts
```typescript
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/dal';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  return NextResponse.json(user);
}
```

### src/app/api/[...proxy]/route.ts (BFF transparent proxy)
`/api/v1/...` 以下のリクエストを、有効な `access_token` Cookie を Bearer に載せ替えてバックエンドへ中継。401 時は 1 度だけ refresh して再試行。

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getValidAccessToken, refreshAccessToken } from '@/lib/auth/dal';

const BACKEND_URL = process.env.API_URL ?? 'http://localhost:8080';

async function forward(req: NextRequest, path: string[]) {
  const token = await getValidAccessToken();
  const url = `${BACKEND_URL}/api/${path.join('/')}${req.nextUrl.search}`;

  const init: RequestInit = {
    method: req.method,
    headers: {
      'Content-Type': req.headers.get('content-type') ?? 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text(),
    cache: 'no-store',
  };

  let res = await fetch(url, init);
  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      (init.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
      res = await fetch(url, init);
    }
  }
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export const GET    = (req: NextRequest, ctx: { params: Promise<{ proxy: string[] }> }) => ctx.params.then(p => forward(req, p.proxy));
export const POST   = (req: NextRequest, ctx: { params: Promise<{ proxy: string[] }> }) => ctx.params.then(p => forward(req, p.proxy));
export const PUT    = (req: NextRequest, ctx: { params: Promise<{ proxy: string[] }> }) => ctx.params.then(p => forward(req, p.proxy));
export const PATCH  = (req: NextRequest, ctx: { params: Promise<{ proxy: string[] }> }) => ctx.params.then(p => forward(req, p.proxy));
export const DELETE = (req: NextRequest, ctx: { params: Promise<{ proxy: string[] }> }) => ctx.params.then(p => forward(req, p.proxy));
```

### src/lib/auth/dal.ts (Data Access Layer — Server only)
```typescript
import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';

const BACKEND_URL = process.env.API_URL ?? 'http://localhost:8080';

function decodeJwt<T = unknown>(token: string): T | null {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function isExpiringSoon(exp: number, bufferMs = 60_000) {
  return Date.now() + bufferMs >= exp * 1000;
}

export const getSessionUser = cache(async () => {
  const token = await getValidAccessToken();
  if (!token) return null;
  const payload = decodeJwt<{ userId: number; workspaceId: number; role: string; email?: string; displayName?: string }>(token);
  return payload ?? null;
});

export async function getValidAccessToken(): Promise<string | null> {
  const store = await cookies();
  const access = store.get('access_token')?.value;
  if (access) {
    const payload = decodeJwt<{ exp: number }>(access);
    if (payload?.exp && !isExpiringSoon(payload.exp)) return access;
  }
  return refreshAccessToken();
}

export async function refreshAccessToken(): Promise<string | null> {
  const store = await cookies();
  const refresh = store.get('refresh_token')?.value;
  if (!refresh) return null;
  const res = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json();
  // Route Handler から呼ばれた場合のみ Cookie 更新可能。Server Component 中は更新できない。
  try {
    store.set('access_token', data.accessToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60,
    });
    if (data.refreshToken) {
      store.set('refresh_token', data.refreshToken, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 7,
      });
    }
  } catch {
    // RSC 中は set 不可。Route Handler 経由で再試行することを想定。
  }
  return data.accessToken as string;
}
```

### proxy.ts (Next.js 16 file convention — 旧 middleware.ts)
```typescript
import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard', '/projects', '/interviews', '/interview-sessions'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  // Cookie は軽量チェックのみ — 有効性検証は DAL 側で行う。
  if (!request.cookies.has('refresh_token') && !request.cookies.has('access_token')) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/projects/:path*', '/interviews/:path*', '/interview-sessions/:path*'],
};
```

### src/components/ui/loading.tsx
```typescript
export function Loading() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-200 ${className}`} />
  );
}
```

### src/components/ui/error-message.tsx
```typescript
interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm text-red-800">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 text-sm font-medium text-red-600 hover:text-red-500"
        >
          再試行
        </button>
      )}
    </div>
  );
}
```

### src/components/customer/header.tsx
```typescript
'use client';

import Link from 'next/link';

export function CustomerHeader() {
  return (
    <header className="sticky top-0 z-50 bg-brand-600 px-4 py-3 text-white shadow-md">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-lg font-bold">
          サロン予約
        </Link>
      </div>
    </header>
  );
}
```

### src/components/admin/sidebar.tsx
```typescript
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const menuItems = [
  { href: '/admin', label: 'ダッシュボード' },
  // メニュー項目は画面実装時 (/frontend-develop) に追加
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <aside className="w-64 min-h-screen bg-gray-900 text-gray-100">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-lg font-bold">管理画面</h1>
      </div>
      <nav className="p-2 flex-1">
        {menuItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname === item.href
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="p-2 border-t border-gray-700">
        <button
          onClick={logout}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-800 hover:text-white"
        >
          ログアウト
        </button>
      </div>
    </aside>
  );
}
```

## 制約・ルール
- Node.js 22 / Next.js (latest)
- ポート: フロントエンド=3000, バックエンド=3010
- バックエンド API へは `/api/[...proxy]/route.ts` (BFF) で中継。`next.config.ts` の rewrites は使わない
  - `/api/v1/*` → DAL 経由で `access_token` Cookie を Bearer に載せ替え → バックエンド
  - `API_URL` 環境変数で転送先指定 (Docker 内: `http://host.docker.internal:8080`、ローカル: `http://localhost:8080`)
- 認証は **httpOnly Cookie** (`access_token` 1h / `refresh_token` 7d、`sameSite=strict`、`secure`)。localStorage / Authorization ヘッダは使わない
- すべての `fetch` には `credentials: 'include'` を付ける
- `/api/auth/login` で Cookie 発行、`/api/auth/refresh` で再発行、`/api/auth/logout` で削除
- `proxy.ts` は保護ルートで Cookie 有無のみチェック (matcher で対象限定)。中身の検証・refresh は DAL / Route Handler 側
- `frontend/.env.local` は `.gitignore` に含める
- App Router を使用 (Pages Router は使用しない)
- Route Group: `(customer)` = 顧客向けモバイル画面、`(admin)` = 管理者向けデスクトップ画面
- レイアウト分離: 顧客画面はモバイルファースト (`max-w-[480px]`)、管理画面はデスクトップ (`flex` + `w-64` サイドバー)
- Tailwind CSS でスタイリング (CSS Modules / styled-components は不使用)
- ブランドカラー: `brand-600` = `purple-600` 相当 (Tailwind 設定で拡張)
- 日本語フォント: `-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif`
- 全コマンドはプロジェクトルートから実行 (`cd frontend && ...` パターン)
- `create-next-app` のプロンプトが出る場合はフラグで回避 (`--typescript --tailwind --eslint --app --src-dir --import-alias "@/*"`)
