---
name: backend-init
description: "Hono.jsバックエンド初期構築 — Docker Compose/Drizzle/TypeScript設定を一括生成"
---

# /backend-init

## 概要
`npm create hono@latest` (最新CLI) で Hono.js プロジェクトを `backend/` にスキャフォールド。Docker Compose (API + PostgreSQL)、Drizzle ORM (pg)、Vitest を設定し、共通ユーティリティを生成する。

## 入力ドキュメント
- なし (固定テンプレート)

## 出力ドキュメント
- `backend/` 配下のプロジェクト一式:
  - `package.json`, `tsconfig.json`, `Dockerfile`, `docker-compose.yaml`
  - `.env.example`, `.env`, `.gitignore`
  - `drizzle.config.ts`, `vitest.config.ts`
- `backend/src/index.ts` — @hono/node-server エントリーポイント
- `backend/src/app.ts` — Hono アプリ本体 (テスト用に分離)
- `backend/src/db/client.ts` — pg + drizzle 接続
- `backend/src/middleware/error-handler.ts` — 共通エラーハンドラー
- `backend/src/lib/id-generator.ts` — プレフィックス付き ID 生成ユーティリティ
- `backend/src/lib/errors.ts` — AppError クラス

## ワークフロー

1. **スキャフォールド**: `npm create hono@latest backend -- --template nodejs` を実行
2. **追加パッケージインストール**:
   ```bash
   cd backend && npm install drizzle-orm pg jose nanoid@3 bcryptjs dotenv
   cd backend && npm install -D drizzle-kit @types/pg @types/bcryptjs vitest tsx
   ```
3. **Docker Compose 生成** (`backend/docker-compose.yaml`):
   - `api` サービス: Node.js 24, ポート 3000, ホットリロード対応
   - `postgres` サービス: PostgreSQL 18, ポート 5432, ヘルスチェック付き
   - volumes で PostgreSQL データ永続化
4. **Dockerfile 生成** (`backend/Dockerfile`):
   - Node.js 24-slim ベース
   - npm ci → tsx watch src/index.ts (開発用)
5. **環境変数ファイル生成**:
   - `.env.example` に全環境変数のテンプレート
   - `.env` に開発用デフォルト値をコピー
   - `.gitignore` に `.env` を追加
6. **tsconfig.json 更新**: `strict: true`, `paths` エイリアス設定
7. **drizzle.config.ts 生成**: pg ドライバ, `src/db/schema.ts` 参照
8. **vitest.config.ts 生成**: パスエイリアス解決設定
9. **共通ユーティリティ生成**:
   - `src/db/client.ts` — pg + drizzle 接続 (`process.env` から接続情報読み込み)
   - `src/lib/errors.ts` — `AppError` クラス (statusCode, code, message, details)
   - `src/lib/id-generator.ts` — `generateId(prefix: string): string` (nanoid ベース, `prefix_` + 21文字)
   - `src/middleware/error-handler.ts` — AppError 判定 → JSON レスポンス
10. **エントリーポイント生成**:
    - `src/index.ts` — `@hono/node-server` の `serve()` でポート 3000 起動
    - `src/app.ts` — `new Hono()` + エラーハンドラー適用
11. **動作確認**: `docker compose -f backend/docker-compose.yaml build`

## テンプレート

### docker-compose.yaml
```yaml
services:
  api:
    build: .
    ports:
      - "3010:3000"
    volumes:
      - .:/app
      - /app/node_modules
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
    working_dir: /app

  postgres:
    image: postgres:18
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres_data:
```

### .env.example
```
DB_HOST=postgres
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=app_db
JWT_SECRET=your-secret-key-change-in-production
PORT=3000
```

### src/app.ts
```typescript
import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';

const app = new Hono();

app.onError(errorHandler);

app.get('/health', (c) => c.json({ status: 'ok' }));

export { app };
```

### src/index.ts
```typescript
import { serve } from '@hono/node-server';
import { app } from './app';
import 'dotenv/config';

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});
```

### src/lib/errors.ts
```typescript
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

### src/lib/id-generator.ts
```typescript
import { nanoid } from 'nanoid';

export function generateId(prefix: string): string {
  return `${prefix}_${nanoid(21)}`;
}
```

### src/middleware/error-handler.ts
```typescript
import type { ErrorHandler } from 'hono';
import { AppError } from '../lib/errors';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.statusCode as any,
    );
  }
  console.error('Unhandled error:', err);
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    500,
  );
};
```

### src/db/client.ts
```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

export const db = drizzle(pool);
```

## 制約・ルール
- Node.js 24 / PostgreSQL 18
- ポート: API=3010 (外部→3000内部), PostgreSQL=5432
- `backend/.env` は `.gitignore` に含める
- `app.ts` と `index.ts` を分離 (テスタビリティ確保)
- nanoid は v3 系を使用 (`nanoid@3` — ESM/CJS 互換)
- `npm create hono@latest` のプロンプトが出る場合は `--template nodejs` オプションで回避
- 全コマンドはプロジェクトルートから実行 (`cd backend && ...` パターン)
