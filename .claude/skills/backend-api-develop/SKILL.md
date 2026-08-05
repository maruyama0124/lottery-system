---
name: backend-api-develop
description: "Hono.js APIルート実装 — OpenAPI仕様からルート・テストコードを並列生成"
---

# /backend-api-develop

## 概要
OpenAPI 仕様を読み込み、Hono.js ルートハンドラーとテストコードを生成する。1 API パス = 1 Task サブエージェントで並列実装し、事前に DB スキーマとの整合性を検証する。

## 引数
- 引数なし: OpenAPI に定義された全 API パスを実装
- 引数あり: 指定された API パスのみ実装 (例: `/backend-api-develop POST /users`, `/backend-api-develop /projects`)

## 入力ドキュメント
- `specification/docs/api-design/openapi.yaml` — OpenAPI 仕様
- `specification/docs/api-design/index.md` — API設計書
- `specification/docs/database-design/index.md` — DB設計書
- `backend/src/db/schema.ts` — Drizzle スキーマ

## 出力ドキュメント
- `backend/src/middleware/auth.ts` — JWT 認証ミドルウェア
- `backend/src/routes/` — ルートハンドラー群
- `backend/test/` — テストファイル群 + setup.ts, helpers.ts

## ワークフロー

### Phase 0: 入力読み込み + 共通ファイル生成 (メインエージェント)

1. openapi.yaml, index.md, schema.ts を読み込む
2. 共通ファイルを生成:
   - `backend/src/middleware/auth.ts` — JWT 認証ミドルウェア (jose 使用)
   - `backend/test/setup.ts` — テスト共通セットアップ (DB接続、トランザクション管理)
   - `backend/test/helpers.ts` — テストヘルパー (認証トークン生成、テストデータ作成)
3. OpenAPI から全 API パス一覧を抽出
   - 引数で特定の API パスが指定されている場合は、該当パスのみを対象にする
   - パス一覧の形式: `{ path: string, methods: string[] }[]`

### Phase 1: DB スキーマ事前検証 (Task サブエージェント × 1)

Phase 2 の並列実装前に、OpenAPI 仕様と schema.ts の整合性を検証する。

**サブエージェント起動**:
```
Task サブエージェント (subagent_type: "general-purpose")
```

**入力 (プロンプトに含める)**:
- openapi.yaml の全文 (paths + schemas セクション)
- schema.ts の全文
- 対象 API パス一覧 (Phase 0 で抽出したもの)

**検証内容**:
1. OpenAPI の request body / response スキーマが参照するフィールドが schema.ts のテーブルに存在するか
2. 型の互換性チェック:
   - OpenAPI `string` ↔ Drizzle `varchar` / `text`
   - OpenAPI `integer` ↔ Drizzle `int` / `bigint`
   - OpenAPI `boolean` ↔ Drizzle `boolean`
   - OpenAPI `string (format: date-time)` ↔ Drizzle `timestamp` / `datetime`
3. リレーション (外部キー) の整合性: OpenAPI のネストされたオブジェクトや参照が schema.ts のリレーション定義と一致するか
4. enum 値の一致: OpenAPI の enum 定義が schema.ts の enum / check 制約と一致するか

**出力**:
- 不整合がなければ: 「検証OK」を返す → Phase 2 へ進行
- 不整合があれば:
  1. schema.ts を修正して不整合を解消
  2. `docker compose -f backend/docker-compose.yaml run --rm api npx drizzle-kit generate` でマイグレーション生成
  3. 修正内容のサマリーを返す → Phase 2 へ進行

**重要ルール**: schema.ts の変更は **このフェーズでのみ** 許可される。

### Phase 2: API ルート並列実装 (Task サブエージェント × N)

**1 API パス = 1 サブエージェント** で並列実装する。
API パスとは OpenAPI の paths に定義された個々のパス (例: `/users`, `/users/{id}`, `/projects`) を指す。同一パスに複数メソッド (GET, POST) がある場合は1つのサブエージェントが全メソッドを実装する。

**サブエージェント起動**:
```
Phase 0 で抽出したパス一覧からパスごとに Task サブエージェント (subagent_type: "general-purpose") を起動
全サブエージェントを並列で起動すること (1つの応答で複数の Task ツールを呼ぶ)
```

**各サブエージェントへの入力 (プロンプトに含める)**:
1. openapi.yaml の対象パス定義 (paths セクションの該当パス + 関連する schemas)
2. schema.ts の関連テーブル定義 (対象パスが使うテーブルのみ抜粋)
3. 「制約・ルール」セクション全文
4. 「テンプレート」セクション全文 (ルートファイル・テストファイルのテンプレート)
5. 既存の `backend/src/routes/<resource>.ts` と `backend/test/routes/<resource>.test.ts` の内容 (ファイルが存在する場合 = 更新時)

**各サブエージェントの出力**:
- `backend/src/routes/<resource>.ts` — ルートハンドラー
- `backend/test/routes/<resource>.test.ts` — テストファイル

**ファイル名の決定**:
- パスの最初のセグメントをリソース名とする (例: `/users/{id}` → `users.ts`)
- 同一リソースの異なるパス (例: `/users` と `/users/{id}`) は同一ファイルにまとめる
  - この場合、同一リソースのパスは1つのサブエージェントにまとめて渡す

**重要ルール**: Phase 2 のサブエージェントは schema.ts を **絶対に変更してはならない (READ ONLY)**。schema.ts の変更が必要な場合は Phase 1 で対応済みのはず。

### Phase 3: 統合 (メインエージェント)

1. `src/app.ts` に全ルートの import と route 登録を追加:
   ```typescript
   import { xxxRoutes } from './routes/xxx';
   app.route('/api/v1', xxxRoutes);
   ```
2. 型チェック: `docker compose -f backend/docker-compose.yaml run --rm api npx tsc --noEmit`

## テンプレート

### ルートファイル (`src/routes/<resource>.ts`)
```typescript
import { Hono } from 'hono';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { generateId } from '../lib/id-generator';

const app = new Hono();

// GET /resources — 一覧取得
app.get('/resources', authMiddleware, async (c) => {
  const results = await db
    .select()
    .from(schema.resources)
    .where(eq(schema.resources.isDeleted, false));
  return c.json(results);
});

// GET /resources/:id — 詳細取得
app.get('/resources/:id', authMiddleware, async (c) => {
  const { id } = c.req.param();
  const [result] = await db
    .select()
    .from(schema.resources)
    .where(and(eq(schema.resources.id, id), eq(schema.resources.isDeleted, false)));
  if (!result) {
    throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  }
  return c.json(result);
});

// POST /resources — 新規作成
app.post('/resources', authMiddleware, async (c) => {
  const body = await c.req.json();
  const id = generateId('res');
  await db.insert(schema.resources).values({ id, ...body });
  return c.body(null, 204);
});

// PUT /resources/:id — 更新
app.put('/resources/:id', authMiddleware, async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  await db.update(schema.resources).set(body).where(eq(schema.resources.id, id));
  return c.body(null, 204);
});

// DELETE /resources/:id — 削除 (論理削除)
app.delete('/resources/:id', authMiddleware, async (c) => {
  const { id } = c.req.param();
  await db
    .update(schema.resources)
    .set({ isDeleted: true })
    .where(eq(schema.resources.id, id));
  return c.body(null, 204);
});

export const resourceRoutes = app;
```

### テストファイル (`test/routes/<resource>.test.ts`)
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../../src/app';

describe('GET /api/v1/resources', () => {
  it('should return 200 with resource list', async () => {
    const res = await app.request('/api/v1/resources', {
      headers: { Authorization: 'Bearer <valid-token>' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('should return 401 without auth header', async () => {
    const res = await app.request('/api/v1/resources');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/resources', () => {
  it('should return 204 on success', async () => {
    const res = await app.request('/api/v1/resources', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer <valid-token>',
      },
      body: JSON.stringify({ name: 'test' }),
    });
    expect(res.status).toBe(204);
  });
});
```

### auth.ts
```typescript
import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';
import { AppError } from '../lib/errors';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid authorization header');
  }
  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    c.set('jwtPayload', payload);
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
  await next();
});
```

### test/setup.ts
```typescript
import 'dotenv/config';
```

### test/helpers.ts
```typescript
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'test-secret');

export async function createTestToken(payload: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ sub: 'test-user', ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}
```

## 制約・ルール

### ルート設計
- Hono ルートは `new Hono()` で個別作成し、`app.route()` で統合
- パスプレフィックスは `app.route('/api/v1', xxxRoutes)` で app.ts 側で設定
- ルートファイル内のパスは `/api/v1` を含めない (例: `/resources`, `/resources/:id`)

### レスポンス規則
- POST/PUT/DELETE は `204 No Content` が基本 (`c.body(null, 204)`)
- 200 レスポンスは OpenAPI に明示的に定義がある場合のみ
- エラーレスポンス形式: `{ error: { code: string, message: string, details?: object } }`

### 認証
- OpenAPI の `security` 指定があるエンドポイントに `authMiddleware` を適用
- JWT ペイロードは `c.get('jwtPayload')` で取得

### データアクセス
- `is_deleted` フラグがあるテーブルは一覧取得時に `where(eq(table.isDeleted, false))` で除外
- ID 生成は `generateId(prefix)` を使用 (テーブルごとにプレフィックスを変える)

### テスト
- テストフレームワーク: Vitest
- テストパターン: `app.request()` でHTTPリクエストをシミュレート
- 認証が必要なテストでは `createTestToken()` でトークン生成
- テストファイルはルートファイルと同じリソース名 (`test/routes/<resource>.test.ts`)

### schema.ts 変更ルール
- schema.ts を変更できるのは **Phase 1 (DB スキーマ事前検証) のみ**
- Phase 2 (API ルート並列実装) では schema.ts は **READ ONLY**
- Phase 2 のサブエージェントのプロンプトには「schema.ts を変更してはならない」を必ず明記すること

### 並列実装
- **1 API パス = 1 Task サブエージェント** で並列実装 (同一リソースのパスは1エージェントにまとめる)
- 各サブエージェントは独立して動作し、他のパスに依存しない
- 引数で API パスが指定されている場合は該当パスのみ実装
