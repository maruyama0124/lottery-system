---
name: backend-db-init
description: "Drizzle ORMスキーマ生成 — DB設計書からスキーマ・マイグレーション・シードを生成"
---

# /backend-db-init

## 概要
DB設計書 (schema.dbml + index.md) を読み込み、Drizzle ORM の PostgreSQL 向けスキーマ定義、マイグレーション、シードスクリプトを生成する。

## 入力ドキュメント
- `specification/docs/database-design/index.md` — DB設計書
- `specification/docs/database-design/schema.dbml` — DBMLスキーマ

## 出力ドキュメント
- `backend/src/db/schema.ts` — Drizzle テーブル定義 (drizzle-orm/pg-core)
- `backend/src/db/seed.ts` — 初期データ投入スクリプト
- `backend/drizzle/` — drizzle-kit generate で生成されるマイグレーションファイル

## ワークフロー

1. **入力読み込み**: `schema.dbml` と `index.md` を読み込み、テーブル構造・リレーション・初期データを把握
2. **スキーマ変換**: DBML → Drizzle PostgreSQL スキーマへ変換
   - 各テーブルを `pgTable()` で定義
   - 型変換ルール (制約・ルール参照) に従って PostgreSQL 型にマッピング
   - リレーション定義 (`relations()`) を追加
3. **schema.ts 生成**: `backend/src/db/schema.ts` に全テーブル定義を出力
4. **seed.ts 生成**: DB設計書の「初期データ」セクションを参照し、初期データ投入スクリプトを生成
5. **マイグレーション生成**:
   ```bash
   docker compose -f backend/docker-compose.yaml run --rm api npx drizzle-kit generate
   ```
6. **型チェック**: 生成されたコードの整合性を確認

## テンプレート

### schema.ts 構造
```typescript
import {
  pgTable,
  pgEnum,
  varchar,
  timestamp,
  boolean,
  integer,
  text,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// --- テーブル定義 ---
export const users = pgTable('users', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
});

// --- リレーション定義 ---
export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));
```

### seed.ts 構造
```typescript
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

async function seed() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const db = drizzle(pool);

  console.log('Seeding database...');

  // 初期データ投入
  await db.insert(schema.users).values([
    // DB設計書の初期データセクションに基づく
  ]);

  console.log('Seeding complete.');
  await pool.end();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

## 制約・ルール

### 型変換ルール (DBML → Drizzle PostgreSQL)
| DBML | Drizzle PostgreSQL |
|---|---|
| `timestamp` | `timestamp()` |
| `now()` | `` sql`CURRENT_TIMESTAMP` `` |
| `serial` | `serial()` |
| `text` | `text()` |
| `varchar` | `varchar({ length: 255 })` ※長さ明示必須 |
| `boolean` | `boolean()` |
| `integer` / `int` | `integer()` |
| `decimal(p,s)` | `decimal({ precision: p, scale: s })` |
| `json` | `json()` |
| `jsonb` | `jsonb()` |

### カラム命名規則
- DB カラム名: `snake_case` (例: `created_at`)
- TypeScript プロパティ名: `camelCase` (例: `createdAt`)
- `pgTable` の第2引数で明示的にマッピング: `createdAt: timestamp('created_at')`

### 共通カラムパターン
- `id`: `varchar('id', { length: 50 }).primaryKey()` — アプリ側で `generateId()` で生成
- `created_at`: `timestamp('created_at').notNull().default(sql\`CURRENT_TIMESTAMP\`)`
- `updated_at`: `timestamp('updated_at').notNull().default(sql\`CURRENT_TIMESTAMP\`).$onUpdateFn(() => new Date())`
- `is_deleted`: `boolean('is_deleted').notNull().default(false)` — 論理削除フラグ

### Enum 型の扱い
- DBML の `enum` → `pgEnum()` でテーブル外に定義してからカラムで使用
- 例:
  ```typescript
  export const statusEnum = pgEnum('status', ['active', 'inactive']);
  // テーブル内:
  status: statusEnum('status').notNull().default('active')
  ```

### リレーション定義
- 全テーブル間のリレーションを `relations()` で定義
- 1:N → `one()` / `many()`
- N:M → 中間テーブルを経由

### その他
- インデックス定義も DBML から移植 (`pgTable` の第3引数)
- パスワードは seed.ts 内で `bcryptjs` でハッシュ化
- シード重複時は `.onConflictDoNothing()` を使用
