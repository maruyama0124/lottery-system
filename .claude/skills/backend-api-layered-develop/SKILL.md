---
name: backend-api-layered-develop
description: "Hono.js レイヤード API 実装 — route/service/repository/domain を層ごとにフラット配置した機能単位の並列生成"
---

# /backend-api-layered-develop

## 概要
OpenAPI 仕様を読み込み、**1 機能 = 1 ファイル × 4 レイヤー** (route / service / repository / domain) でフラットに配置したレイヤードアーキテクチャで実装する。1 機能 = 1 Task サブエージェントで並列実装し、事前に DB スキーマとの整合性を検証する。

`backend-api-develop` との違い:
- **層分離**: route (Hono + zod + handler) / service (ドメインロジック) / repository (DB アクセス) / domain (ドメインモデル) を分離
- **DB 型とドメイン型の分離**: repository が DB ↔ ドメインのマッピング境界を担い、`isDeleted` / snake_case / nullable などの永続化事情を service 以上に漏らさない
- **フラット構成**: 機能ごとのサブディレクトリは切らず、層ごとのディレクトリにファイル名で機能を表現 (例: `src/api/routes/brands.ts`, `src/shared/services/brands.ts`)
- **repository の共有**: `src/shared/repositories/<feature>.repository.ts` に DB アクセスを隔離し、batch からも再利用可能

**例外**: 1 機能で 10 エンドポイントを超える等、1 ファイルで管理しにくい大規模機能のみ `src/api/routes/<feature>/` のようにサブディレクトリに分割可 (必要時のみ)。

## 引数
- 引数なし: OpenAPI に定義された全機能を実装
- 引数あり: 指定された機能のみ実装 (例: `/backend-api-layered-develop brands`, `/backend-api-layered-develop brands actions`)
  - 機能名は OpenAPI のエンドポイント一覧を論理的にグルーピングした単位 (例: `/brands/*` → `brands`, `/actions/*` + `/action` → `actions`)

## 入力ドキュメント
- `specification/docs/api-design/openapi.yaml` — OpenAPI 仕様
- `specification/docs/api-design/index.md` — API 設計書 (エンドポイント一覧・グルーピング図)
- `specification/docs/database-design/index.md` — DB 設計書
- `backend/src/shared/db/schema.ts` — Drizzle スキーマ

## 出力ドキュメント
- `backend/src/api/routes/<feature>.ts` — Hono ルーター + ハンドラー + zod バリデーション
- `backend/src/shared/services/<feature>.ts` — ドメインロジック
- `backend/src/shared/repositories/<feature>.repository.ts` — DB アクセス + マッピング
- `backend/src/shared/domain/<feature>.ts` — ドメインモデル (Entity, Input)
- `backend/src/api/routes/__tests__/<feature>.test.ts` — ルート統合テスト
- `backend/src/test/helpers/auth.ts` — テスト用トークン生成ヘルパー
- `backend/src/test/fixtures/<feature>.ts` — テスト用フィクスチャ (必要な場合)

## ワークフロー

### Phase 0: 入力読み込み + 共通ファイル生成 (メインエージェント)

1. openapi.yaml, index.md, schema.ts を読み込む
2. API 設計書のエンドポイント一覧から機能単位にグルーピング (例: `auth`, `account`, `brands`, `themes`, `actions`, `settings`)
   - 引数で特定の機能が指定されている場合は、該当機能のみを対象にする
   - 機能一覧の形式: `{ feature: string, paths: { path: string, methods: string[] }[] }[]`
3. 共通ファイル (存在しない場合のみ生成):
   - `backend/src/test/helpers/auth.ts` — `createTestToken()` (jose + HS256)
   - `backend/src/api/middleware/auth.ts` が no-op のままの場合は `jose` で JWT 検証に差し替える
     - ただし `authMiddleware` の署名 (MiddlewareHandler) は変えない

### Phase 1: DB スキーマ事前検証 (Task サブエージェント × 1)

Phase 2 の並列実装前に、OpenAPI 仕様と schema.ts の整合性を検証する。

**サブエージェント起動**:
```
Task サブエージェント (subagent_type: "general-purpose")
```

**入力 (プロンプトに含める)**:
- openapi.yaml の全文 (paths + schemas セクション)
- schema.ts の全文
- 対象機能一覧 (Phase 0 で抽出したもの)

**検証内容**:
1. OpenAPI の request body / response スキーマが参照するフィールドが schema.ts のテーブルに存在するか
2. 型の互換性チェック:
   - OpenAPI `string` ↔ Drizzle `varchar` / `text`
   - OpenAPI `integer` ↔ Drizzle `int` / `bigint`
   - OpenAPI `boolean` ↔ Drizzle `boolean`
   - OpenAPI `string (format: date-time)` ↔ Drizzle `timestamp` / `datetime`
3. リレーション (外部キー) の整合性
4. enum 値の一致

**出力**:
- 不整合がなければ: 「検証OK」を返す → Phase 2 へ進行
- 不整合があれば:
  1. schema.ts を修正
  2. `docker compose -f backend/docker-compose.yaml run --rm api npx drizzle-kit generate` でマイグレーション生成
  3. 修正内容のサマリーを返す → Phase 2 へ進行

**重要ルール**: DB schema.ts の変更は **このフェーズでのみ** 許可される。

### Phase 2: 機能別レイヤード並列実装 (Task サブエージェント × N)

**1 機能 = 1 サブエージェント** で並列実装する。

**サブエージェント起動**:
```
Phase 0 で抽出した機能一覧から機能ごとに Task サブエージェント (subagent_type: "general-purpose") を起動
全サブエージェントを並列で起動すること (1つの応答で複数の Task ツールを呼ぶ)
```

**各サブエージェントへの入力 (プロンプトに含める)**:
1. openapi.yaml の対象機能配下の全パス定義 + 関連する schemas
2. DB schema.ts の関連テーブル定義 (対象機能が使うテーブルのみ抜粋)
3. 「制約・ルール」セクション全文
4. 「テンプレート」セクション全文 (route / service / repository / domain / test)
5. 既存ファイルの内容 (ファイルが存在する場合 = 更新時)

**各サブエージェントの出力**:
- `backend/src/shared/domain/<feature>.ts`
- `backend/src/api/routes/<feature>.ts`
- `backend/src/shared/services/<feature>.ts`
- `backend/src/shared/repositories/<feature>.repository.ts`
- `backend/src/api/routes/__tests__/<feature>.test.ts`
- `backend/src/test/fixtures/<feature>.ts` (必要な場合)

**重要ルール**: Phase 2 のサブエージェントは DB schema.ts (`src/shared/db/schema.ts`) を **絶対に変更してはならない (READ ONLY)**。

### Phase 3: 統合 (メインエージェント)

1. `src/api/index.ts` に全機能ルーターの import と `api.route('/<path-prefix>', xxxRouter)` を追加
2. 型チェック: `docker compose -f backend/docker-compose.yaml run --rm api npx tsc --noEmit`
3. テスト実行: `docker compose -f backend/docker-compose.yaml run --rm api npx vitest run`

## テンプレート

`<feature>` は小文字複数形 or 機能語 (例: `brands`, `actions`, `auth`)。
`<Feature>` は PascalCase 単数形 (例: `Brand`, `Action`)。
ESM (NodeNext) のため、相対 import には **`.js` 拡張子を必ず付ける**。

### `src/shared/domain/<feature>.ts` — ドメインモデル
```typescript
// ドメインエンティティ: DB 由来のフラグ (is_deleted など) やスネークケースを含めない
export type Brand = {
  code: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// 作成入力: 監査カラムは含めない
export type NewBrand = {
  code: string;
  name: string;
  description?: string;
};

// 更新入力: 部分更新
export type BrandUpdate = Partial<Omit<NewBrand, 'code'>>;
```

### `src/api/routes/<feature>.ts` — ルーター + ハンドラー + zod
```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../../shared/errors/index.js';
import * as service from '../../shared/services/brands.js';
import type { NewBrand, BrandUpdate } from '../../shared/domain/brands.js';

// zod スキーマ — `satisfies` でドメイン入力型と一致することを型レベルで保証
const newBrandSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
}) satisfies z.ZodType<NewBrand>;

const brandUpdateSchema = newBrandSchema
  .omit({ code: true })
  .partial() satisfies z.ZodType<BrandUpdate>;

export const brandsRouter = new Hono();

brandsRouter.get('/', authMiddleware, async (c) => {
  const brands = await service.list();
  return c.json(brands);
});

brandsRouter.get('/:code/overview', authMiddleware, async (c) => {
  const { code } = c.req.param();
  const overview = await service.getOverview(code);
  if (!overview) throw new AppError(404, 'NOT_FOUND', 'Brand not found');
  return c.json(overview);
});

brandsRouter.post('/', authMiddleware, async (c) => {
  const body = newBrandSchema.parse(await c.req.json());
  await service.create(body);
  return c.body(null, 204);
});

brandsRouter.put('/:code', authMiddleware, async (c) => {
  const { code } = c.req.param();
  const body = brandUpdateSchema.parse(await c.req.json());
  await service.update(code, body);
  return c.body(null, 204);
});
```

### `src/shared/services/<feature>.ts` — ドメインロジック
```typescript
import * as repo from '../repositories/brands.repository.js';
import type { Brand, NewBrand, BrandUpdate } from '../domain/brands.js';

export const list = (): Promise<Brand[]> => repo.findAll();

export const get = (code: string): Promise<Brand | undefined> => repo.findByCode(code);

export const getOverview = async (code: string) => {
  const brand = await repo.findByCode(code);
  if (!brand) return undefined;
  // 他リポジトリ / サービスを組み合わせるドメインロジックをここに書く
  return brand;
};

export const create = (input: NewBrand): Promise<void> => repo.insert(input);

export const update = (code: string, input: BrandUpdate): Promise<void> =>
  repo.update(code, input);
```

### `src/shared/repositories/<feature>.repository.ts` — DB アクセス + マッピング
```typescript
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as dbSchema from '../db/schema.js';
import type { Brand, NewBrand, BrandUpdate } from '../domain/brands.js';

type BrandRow = typeof dbSchema.brands.$inferSelect;

// DB 行 → ドメイン型 (is_deleted などを削ぎ落とし、camelCase に正規化)
const toDomain = (row: BrandRow): Brand => ({
  code: row.code,
  name: row.name,
  description: row.description,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const findAll = async (): Promise<Brand[]> => {
  const rows = await db
    .select()
    .from(dbSchema.brands)
    .where(eq(dbSchema.brands.isDeleted, false));
  return rows.map(toDomain);
};

export const findByCode = async (code: string): Promise<Brand | undefined> => {
  const [row] = await db
    .select()
    .from(dbSchema.brands)
    .where(and(eq(dbSchema.brands.code, code), eq(dbSchema.brands.isDeleted, false)));
  return row ? toDomain(row) : undefined;
};

export const insert = async (input: NewBrand): Promise<void> => {
  await db.insert(dbSchema.brands).values(input);
};

export const update = async (code: string, input: BrandUpdate): Promise<void> => {
  await db.update(dbSchema.brands).set(input).where(eq(dbSchema.brands.code, code));
};
```

### `src/api/routes/__tests__/<feature>.test.ts` — テスト
```typescript
import { describe, it, expect } from 'vitest';
import { app } from '../../../app.js';
import { createTestToken } from '../../../test/helpers/auth.js';

describe('GET /brands', () => {
  it('returns 200 with list', async () => {
    const token = await createTestToken();
    const res = await app.request('/brands', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await app.request('/brands');
    expect(res.status).toBe(401);
  });
});

describe('POST /brands', () => {
  it('returns 204 on success', async () => {
    const token = await createTestToken();
    const res = await app.request('/brands', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code: 'nike', name: 'Nike' }),
    });
    expect(res.status).toBe(204);
  });
});
```

### `src/test/helpers/auth.ts` — テストヘルパー
```typescript
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'test-secret');

export const createTestToken = (payload: Record<string, unknown> = {}) =>
  new SignJWT({ sub: 'test-user', ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
```

### `src/api/middleware/auth.ts` — JWT 検証 (no-op から差し替え)
```typescript
import type { MiddlewareHandler } from 'hono';
import { jwtVerify } from 'jose';
import { AppError } from '../../shared/errors/index.js';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'test-secret');

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid authorization header');
  }
  try {
    const { payload } = await jwtVerify(header.slice(7), JWT_SECRET);
    c.set('jwtPayload', payload);
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
  await next();
};
```

## 制約・ルール

### レイヤー責務
- **ドメインモデル (`src/shared/domain/<feature>.ts`)**: エンティティと入力型を定義。DB カラム名 (snake_case) やフラグ (`isDeleted` など) を含めない。永続化事情から独立した業務語彙で表現する。
- **route (`src/api/routes/<feature>.ts`)**: Hono ルート定義 + zod バリデーション + ハンドラー処理 (リクエスト取り出し → parse → service 呼び出し → レスポンス整形) を 1 ファイルに集約。DB 型に触れない。
- **service (`src/shared/services/<feature>.ts`)**: ドメインロジック。引数も戻り値も **ドメイン型** のみを使用する。DB 型 (`$inferSelect` / `$inferInsert`) を import してはならない。複数リポジトリを組み合わせたり ID 生成などを担う。
- **repository (`src/shared/repositories/<feature>.repository.ts`)**: Drizzle クエリ + DB 型 ↔ ドメイン型のマッピングのみ。ビジネスルールを書かない。`toDomain(row)` のようなプライベートマッパーを置き、戻り値は必ずドメイン型にする。

### 型の分離ルール
- **DB 型 (`$inferSelect` / `$inferInsert`)** は `src/shared/repositories/` 以下でのみ使用可。他の層から import してはならない。
- **ドメイン型** は `src/shared/domain/<feature>.ts` に定義し、どの層からも import 可能。
- `src/shared/types/` は汎用ユーティリティ型専用とし、ドメインモデルは置かない。
- ドメイン型には以下を含めない:
  - `isDeleted` (永続化の都合)
  - DB カラム名 (snake_case)
  - nullable な監査カラムで業務上意味がないもの
- ドメイン型に含めるべきもの:
  - 業務的に意味のあるフィールド
  - 監査情報 (createdAt / updatedAt) — 業務で使う場合のみ
- enum は DB schema の enum をそのまま再 export せず、ドメイン型側で別途定義する (値は同じでよい)
- zod スキーマは `satisfies z.ZodType<DomainInput>` でドメイン入力型と一致することを型レベルで保証する

### 依存方向
- route → service → repository (片方向)
- route は repository を直接 import してはならない
- repository は service / route を import してはならない
- service は他機能の service を呼んでよい (cross-feature domain logic も `src/shared/services/` 配下に置く)
- ドメイン型はすべての層から参照可能

### import 規則
- 相対 import には **必ず `.js` 拡張子** を付ける (ESM NodeNext 要件)
- ルーターは `src/api/routes/<feature>.ts` に 1 ファイル 1 機能
- service は `src/shared/services/<feature>.ts` に 1 ファイル 1 機能
- repository は `src/shared/repositories/<feature>.repository.ts` に 1 ファイル 1 機能
- ドメイン型は `src/shared/domain/<feature>.ts` に 1 ファイル 1 機能

### ルート登録
- 機能ごとに `new Hono()` でルーターを作成し、`xxxRouter` の名前で export
- `src/api/index.ts` で `api.route('/<path-prefix>', xxxRouter)` で統合
  - path prefix は OpenAPI のパス先頭セグメント (例: `/brands`, `/actions`, `/settings/brand-aliases` → ルーター内で階層を持つ場合あり)
- ルートファイル内のパスは path-prefix を含めない

### 大規模機能の例外
- 1 機能で **10 エンドポイントを超える** 等、単一ファイルで管理しにくい場合のみサブディレクトリ化を許可:
  - `src/api/routes/<feature>/index.ts` (ルーター集約 + re-export)
  - `src/api/routes/<feature>/<sub-feature>.ts` (サブルーター + zod)
- ただし service / repository / domain は分割せず、フラット (`src/shared/services/<feature>.ts` 等) のまま維持する
- デフォルトはあくまでフラット配置。分割は例外として扱う

### レスポンス規則
- POST / PUT / DELETE は `204 No Content` が基本 (`c.body(null, 204)`)
- 200 は OpenAPI に明示的に定義がある場合のみ
- エラー形式: `{ error: { code: string, message: string, details?: object } }`
- AppError を throw すれば `error-handler.ts` が整形する
- JSON レスポンスはドメイン型をそのまま返す (`Date` は自動で ISO 文字列化される)

### 認証
- OpenAPI の `security` 指定があるルートに `authMiddleware` を適用
- JWT ペイロードは `c.get('jwtPayload')` で取得
- service 層に渡す場合は route で取り出して明示的に引数で渡す (service は Context に依存しない)

### データアクセス
- `is_deleted` フラグのあるテーブルは repository の `findAll` / `findByXxx` で `isDeleted = false` を必ず条件に含める
- ID 生成は service 層で `generateId(prefix)` を使用 (`src/shared/utils/id-generator.ts`)
- repository の戻り値は必ずドメイン型 (配列なら `rows.map(toDomain)`, 単体なら `row ? toDomain(row) : undefined`)

### テスト
- テストフレームワーク: Vitest
- 配置: `src/api/routes/__tests__/<feature>.test.ts` (ルート層とコロケート)
- パターン: `app.request()` で HTTP リクエストをシミュレート
- 認証必要: `createTestToken()` でトークン生成
- フィクスチャは `src/test/fixtures/<feature>.ts` にドメイン型で定義

### schema 変更ルール
- DB schema.ts (`src/shared/db/schema.ts`) を変更できるのは **Phase 1 のみ**
- ドメインモデル (`src/shared/domain/<feature>.ts`) と route 内 zod は Phase 2 で自由に生成 / 更新してよい
- Phase 2 のサブエージェントのプロンプトには「DB schema.ts を変更してはならない」を必ず明記すること

### 並列実装
- **1 機能 = 1 Task サブエージェント** で並列実装
- 各サブエージェントは独立して動作し、他機能の実装に依存しない
- cross-feature な共有ロジックがある場合は Phase 0 で検出し、`src/shared/services/<name>.ts` にあらかじめ切り出してから Phase 2 を起動する
- 引数で機能が指定されている場合は該当機能のみ実装
