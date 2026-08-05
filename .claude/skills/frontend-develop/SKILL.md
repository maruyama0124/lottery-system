---
description: "Next.js画面実装 — 画面設計書・OpenAPI仕様から画面コードを並列生成"
---

# /frontend-develop

## 概要
画面設計書 (screen-designs.yaml + index.md) と OpenAPI 仕様を読み込み、Next.js の画面コード (ページ + コンポーネント) を生成する。1 画面 = 1 Task サブエージェントで並列実装し、事前に共通型定義と API フックを生成する。

## 引数
- 引数なし: screen-designs.yaml に定義された全画面を実装
- 引数あり: 指定された画面 ID のみ実装 (例: `/frontend-develop login`, `/frontend-develop booking-menu admin-dashboard`)

## 入力ドキュメント
- `specification/docs/ui-design/index.md` — 画面設計書
- `specification/docs/ui-design/screen-designs.yaml` — 画面定義YAML
- `specification/docs/ui-design/snippets/*.html` — HTML モックアップ
- `specification/docs/api-design/openapi.yaml` — OpenAPI 仕様

## 出力ドキュメント
- `frontend/src/types/api.ts` — OpenAPI 由来の型定義
- `frontend/src/hooks/` — SWR ベースの API フック群
- `frontend/src/app/(customer)/` — 顧客向け画面ページ群
- `frontend/src/app/(admin)/` — 管理者向け画面ページ群
- `frontend/src/components/` — 画面固有コンポーネント群

## ワークフロー

### Phase 0: 入力読み込み + 共通ファイル生成 (メインエージェント)

1. screen-designs.yaml, index.md, snippets/*.html, openapi.yaml を読み込む
2. 共通ファイルを生成:
   - `frontend/src/types/api.ts` — OpenAPI の components/schemas から TypeScript 型定義を生成
   - `frontend/src/hooks/use-api.ts` — SWR ベースの汎用 API フック
   - `frontend/src/hooks/use-auth.ts` — 認証関連フック (useAuth の re-export + 認証ガード)
3. screen-designs.yaml から全画面一覧を抽出
   - 引数で特定の画面 ID が指定されている場合は、該当画面のみを対象にする
   - 画面一覧の形式: `{ screenId: string, name: string, path: string, layout: string }[]`
4. 画面ごとに layout フィールドから Route Group を決定:
   - `layout: "default"` / `layout: "auth"` → `(customer)` Route Group
   - `layout: "dashboard"` → `(admin)` Route Group

### Phase 1: レイアウト更新 (メインエージェント)

screen-designs.yaml の画面一覧を元に、レイアウトコンポーネントを更新する。

1. `src/components/customer/header.tsx` — 顧客向けヘッダーのナビゲーションリンクを画面一覧から生成
2. `src/components/admin/sidebar.tsx` — 管理画面サイドバーのメニュー項目を画面一覧から生成
3. 認証画面 (`layout: "auth"`) 用の専用レイアウトが必要な場合:
   - `src/app/(customer)/(auth)/layout.tsx` — ヘッダーなし、中央カードレイアウト

### Phase 2: 画面並列実装 (Task サブエージェント × N)

**1 画面 = 1 サブエージェント** で並列実装する。
画面とは screen-designs.yaml の各エントリ (screen-id) を指す。

**サブエージェント起動**:
```
Phase 0 で抽出した画面一覧から画面ごとに Task サブエージェント (subagent_type: "general-purpose") を起動
全サブエージェントを並列で起動すること (1つの応答で複数の Task ツールを呼ぶ)
```

**各サブエージェントへの入力 (プロンプトに含める)**:
1. screen-designs.yaml の対象画面定義 (elements, states, references セクション)
2. index.md の対象画面詳細セクション (概要、画面要素、API連携、状態管理)
3. 対象画面の HTML モックアップ (`snippets/<screen-id>-*.html` の全文)
4. openapi.yaml の関連 API パス定義 (references.apis から特定したパス + 関連 schemas)
5. `frontend/src/types/api.ts` の全文 (Phase 0 で生成した型定義)
6. `frontend/src/hooks/use-api.ts` の全文 (Phase 0 で生成したフック)
7. 「制約・ルール」セクション全文
8. 「テンプレート」セクション全文 (ページ・コンポーネントのテンプレート)
9. 既存の画面ファイル (ファイルが存在する場合 = 更新時)

**各サブエージェントの出力**:
- `frontend/src/app/(<route-group>)/<path>/page.tsx` — ページコンポーネント
- `frontend/src/components/<customer|admin>/<screen-id>/` — 画面固有コンポーネント群 (必要に応じて)
- `frontend/src/hooks/<screen-id>.ts` — 画面固有フック (必要に応じて)

**ファイルパスの決定**:
- screen-designs.yaml の `path` フィールドからディレクトリ構造を決定
  - 例: `path: "/booking/confirm"` → `src/app/(customer)/booking/confirm/page.tsx`
  - 例: `path: "/admin/dashboard"` → `src/app/(admin)/admin/dashboard/page.tsx`
- `layout` フィールドから Route Group を決定:
  - `"default"` / `"auth"` → `(customer)`
  - `"dashboard"` → `(admin)`

**重要ルール**: Phase 2 のサブエージェントは `types/api.ts` と `hooks/use-api.ts` を **絶対に変更してはならない (READ ONLY)**。共通型やフックの変更が必要な場合は Phase 0 で対応済みのはず。

### Phase 3: 統合 (メインエージェント)

1. 全画面の実装結果を確認
2. ナビゲーション更新:
   - `src/components/customer/header.tsx` のリンクを最終確認
   - `src/components/admin/sidebar.tsx` のメニューを最終確認
3. 型チェック: `docker compose -f frontend/docker-compose.yaml run --rm web npx tsc --noEmit`
4. ビルド確認: `docker compose -f frontend/docker-compose.yaml run --rm web npx next build`

## テンプレート

### types/api.ts (構造例)
```typescript
// OpenAPI components/schemas から自動生成

export interface Menu {
  id: string;
  name: string;
  description: string;
  duration: number;
  price: number;
  isActive: boolean;
}

export interface Staff {
  id: string;
  name: string;
}

// リクエスト型
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
}

// ページネーション
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
}

// エラー
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
```

### hooks/use-api.ts
```typescript
import useSWR, { type SWRConfiguration } from 'swr';
import { apiClient, ApiClientError } from '@/lib/api-client';

export function useApi<T>(path: string | null, options?: SWRConfiguration) {
  const { data, error, isLoading, mutate } = useSWR<T, ApiClientError>(
    path,
    (url: string) => apiClient.get<T>(url),
    {
      revalidateOnFocus: false,
      ...options,
    },
  );

  return {
    data,
    error,
    isLoading,
    mutate,
  };
}

export function useApiList<T>(path: string | null, options?: SWRConfiguration) {
  return useApi<T[]>(path, options);
}
```

### hooks/use-auth.ts
```typescript
'use client';

export { useAuth } from '@/lib/auth-context';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

export function useRequireAuth(redirectTo = '/login') {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push(redirectTo);
    }
  }, [user, isLoading, router, redirectTo]);

  return { user, isLoading };
}
```

### ページファイル (顧客画面: 一覧系)
```typescript
'use client';

import { useApi } from '@/hooks/use-api';
import { Loading } from '@/components/ui/loading';
import { ErrorMessage } from '@/components/ui/error-message';
import type { Resource } from '@/types/api';

export default function ResourceListPage() {
  const { data, error, isLoading, mutate } = useApi<Resource[]>('/v1/resources');

  if (isLoading) return <Loading />;
  if (error) return <ErrorMessage message={error.message} onRetry={() => mutate()} />;
  if (!data || data.length === 0) {
    return (
      <div className="py-12 text-center text-gray-500">
        データがありません
      </div>
    );
  }

  return (
    <div className="space-y-4 py-4">
      <h1 className="text-xl font-bold">リソース一覧</h1>
      <div className="space-y-3">
        {data.map((item) => (
          <div key={item.id} className="rounded-lg bg-white p-4 shadow-sm">
            {/* HTML モックアップに基づくレイアウト */}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### ページファイル (顧客画面: フォーム系)
```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiClientError } from '@/lib/api-client';

export default function ResourceFormPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    // screen-designs.yaml の fields から初期値を設定
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await apiClient.post('/v1/resources', formData);
      router.push('/resources');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.error.message);
      } else {
        setError('予期しないエラーが発生しました');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 py-4">
      <h1 className="text-xl font-bold">リソース作成</h1>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* screen-designs.yaml の fields に基づくフォームフィールド */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          ラベル
        </label>
        <input
          type="text"
          value={formData.field || ''}
          onChange={(e) => setFormData({ ...formData, field: e.target.value })}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          required
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
      >
        {isSubmitting ? '送信中...' : '送信'}
      </button>
    </form>
  );
}
```

### ページファイル (管理画面: テーブル系)
```typescript
'use client';

import { useApi } from '@/hooks/use-api';
import { useRequireAuth } from '@/hooks/use-auth';
import { Loading } from '@/components/ui/loading';
import { ErrorMessage } from '@/components/ui/error-message';
import type { Resource } from '@/types/api';

export default function AdminResourceListPage() {
  const { user, isLoading: authLoading } = useRequireAuth('/admin/login');
  const { data, error, isLoading, mutate } = useApi<Resource[]>(
    user ? '/v1/admin/resources' : null,
  );

  if (authLoading || isLoading) return <Loading />;
  if (error) return <ErrorMessage message={error.message} onRetry={() => mutate()} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">リソース管理</h1>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          新規作成
        </button>
      </div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                名前
              </th>
              {/* OpenAPI スキーマに基づくカラム */}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {data?.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                  {item.name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

### ページファイル (認証画面: ログイン)
```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { ApiClientError } from '@/lib/api-client';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await login(email, password);
      router.push('/admin');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.error.message);
      } else {
        setError('ログインに失敗しました');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-6 text-center text-2xl font-bold text-gray-900">ログイン</h1>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">メールアドレス</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {isSubmitting ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

## 制約・ルール

### ページ構成
- Next.js App Router を使用 (Pages Router 不使用)
- ページファイルは `page.tsx` (App Router の規約)
- Route Group: `(customer)` = 顧客向け画面、`(admin)` = 管理者向け画面
- パス決定: screen-designs.yaml の `path` フィールドに従う
- `layout` フィールドによる Route Group 振り分け:
  - `"default"` / `"auth"` → `(customer)`
  - `"dashboard"` → `(admin)`

### コンポーネント設計
- 画面固有コンポーネントは `src/components/<customer|admin>/<screen-id>/` に配置
- 共通 UI コンポーネントは `src/components/ui/` に配置
- `'use client'` は状態管理・イベントハンドラーが必要なコンポーネントにのみ付与
- Server Components をデフォルトとし、必要な場合のみ Client Components にする

### データ取得
- 一覧・詳細の GET 系: SWR (`useApi` フック) を使用
- POST/PUT/DELETE 系: `apiClient` を直接呼び出し
- 認証チェック: `useRequireAuth()` フックを使用
- 認証が必要な API フックは `user ? '/v1/...' : null` パターンで条件付き取得

### 認証 (Cookie ベース)
- 認証トークンは **httpOnly Cookie** (`access_token` 1h / `refresh_token` 7d、`sameSite=strict`、`secure`) に格納され、JS からは参照しない
- すべての API 呼び出しは `/api/v1/*` 経由 (BFF Route Handler `src/app/api/[...proxy]/route.ts` が Cookie → Bearer に載せ替えてバックエンドへ中継)
- クライアント側:
  - `fetch` や `apiClient` には `credentials: 'include'` を付ける (デフォルト実装済み)
  - **`Authorization` ヘッダや `localStorage`/`sessionStorage` に token を保存するコードは書かない**
  - ログインは `await login(email, password)` (内部で `POST /api/auth/login`)、ログアウトは `await logout()` (`POST /api/auth/logout`)
- Server Component (RSC) 側:
  - セッションを取る場合は `import { getSessionUser } from '@/lib/auth/dal'` を使う (DAL が `access_token` の失効を検出し自動 refresh)
  - 未認証なら `redirect('/login')` で送り返す
- `useRequireAuth()` は client-side ガード。server-side ガードは `proxy.ts` の matcher + DAL 側で行う

### フォーム
- 制御コンポーネント (controlled components) パターン
- `useState` でフォーム状態管理
- screen-designs.yaml の `fields` に基づくバリデーション:
  - `required: true` → HTML `required` 属性 + submit 前チェック
  - `validation` → 対応するバリデーションロジック
- 送信中は `isSubmitting` でボタン無効化

### スタイリング
- Tailwind CSS のみ使用
- HTML モックアップ (`snippets/*.html`) のクラスを**そのまま移植**する
- 顧客画面: モバイルファースト (`max-w-[480px]`)、ブランドカラー `brand-600`
- 管理画面: デスクトップ前提、サイドバー `w-64`
- 状態表現:
  - `states: ["loading"]` → `<Loading />` コンポーネント
  - `states: ["error"]` → `<ErrorMessage />` コンポーネント
  - `states: ["empty"]` → 空状態メッセージ

### 型安全
- API レスポンスの型は `types/api.ts` から import
- `useApi<Type>` で型パラメータを必ず指定
- `any` 型の使用禁止

### types/api.ts 変更ルール
- types/api.ts を変更できるのは **Phase 0 (共通ファイル生成) のみ**
- Phase 2 (画面並列実装) では types/api.ts は **READ ONLY**
- Phase 2 のサブエージェントのプロンプトには「types/api.ts を変更してはならない」を必ず明記すること

### 並列実装
- **1 画面 = 1 Task サブエージェント** で並列実装
- 各サブエージェントは独立して動作し、他の画面に依存しない
- 引数で画面 ID が指定されている場合は該当画面のみ実装
- 各サブエージェントには HTML モックアップの全文を渡し、見た目を忠実に再現させること
