---
name: backend-db-migrate
description: "Drizzleマイグレーション実行 — PostgreSQLコンテナへのマイグレーション適用とシード実行"
---

# /backend-db-migrate

## 概要
Docker 上の PostgreSQL コンテナに対してマイグレーション適用 + シード実行を行う。`reset` サブコマンドで DB の完全リセットにも対応する。

## 入力ドキュメント
- `backend/drizzle/` — マイグレーションファイル
- `backend/src/db/seed.ts` — シードスクリプト

## 出力ドキュメント
- なし (DB への変更)

## ワークフロー

### 通常実行 (`/backend-db-migrate`)

1. **PostgreSQL コンテナ起動**:
   ```bash
   docker compose -f backend/docker-compose.yaml up -d postgres
   ```
2. **ヘルスチェック待機**: PostgreSQL が ready になるまで待機
   ```bash
   docker compose -f backend/docker-compose.yaml exec postgres pg_isready -U ${DB_USER} -d ${DB_NAME}
   ```
3. **マイグレーション実行**:
   ```bash
   docker compose -f backend/docker-compose.yaml run --rm api npx drizzle-kit migrate
   ```
4. **シード実行**:
   ```bash
   docker compose -f backend/docker-compose.yaml run --rm api npx tsx src/db/seed.ts
   ```
5. **確認**: テーブル一覧とレコード件数を確認
   ```bash
   docker compose -f backend/docker-compose.yaml exec postgres psql -U ${DB_USER} -d ${DB_NAME} -c "\dt"
   ```

### リセット実行 (`/backend-db-migrate reset`)

1. **PostgreSQL コンテナ起動** (上記と同じ)
2. **DB ドロップ & 再作成**:
   ```bash
   docker compose -f backend/docker-compose.yaml exec postgres psql -U ${DB_USER} -c "DROP DATABASE IF EXISTS ${DB_NAME}; CREATE DATABASE ${DB_NAME};"
   ```
3. **マイグレーション実行** (上記と同じ)
4. **シード実行** (上記と同じ)
5. **確認** (上記と同じ)

## 制約・ルール
- 全コマンドは `docker compose -f backend/docker-compose.yaml` 経由で実行
- ローカルの psql / node コマンドは使用禁止
- `reset` サブコマンドは破壊的操作のため、実行前にユーザーに確認する
- `.env` の DB_USER, DB_PASSWORD, DB_NAME を参照してコマンドを構築する
- マイグレーション失敗時はエラー内容を分析し、`backend/src/db/schema.ts` または `backend/drizzle/` の修正を提案する
- シード実行時に重複エラーが出た場合は `.onConflictDoNothing()` の利用を検討
