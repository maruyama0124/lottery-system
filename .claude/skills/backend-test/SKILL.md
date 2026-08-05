---
name: backend-test
description: "バックエンドテスト実行・修正 — Vitestユニットテストの実行と問題修正"
---

# /backend-test

## 概要
Vitest テスト実行 → 失敗分析 → 修正を最大3ループ繰り返す。テスト全件パスを目指す。

## 入力ドキュメント
- `backend/test/**/*.test.ts` — テストファイル
- `backend/src/**/*.ts` — ソースコード

## 出力ドキュメント
- 修正されたソース/テストコード

## ワークフロー

### 通常実行 (`/backend-test`)

1. **PostgreSQL コンテナ起動確認**:
   ```bash
   docker compose -f backend/docker-compose.yaml up -d postgres
   docker compose -f backend/docker-compose.yaml exec postgres pg_isready -U ${DB_USER} -d ${DB_NAME}
   ```
2. **テスト実行** (ループ最大3回):
   ```bash
   docker compose -f backend/docker-compose.yaml run --rm api npx vitest run
   ```
3. **失敗時の分析・修正**:
   - エラーメッセージを読み取り、原因を特定
   - ソースコード (`backend/src/`) またはテストコード (`backend/test/`) を修正
   - 再度テスト実行
4. **型チェック** (テスト全件パス後):
   ```bash
   docker compose -f backend/docker-compose.yaml run --rm api npx tsc --noEmit
   ```
5. **結果レポート**: パス/失敗件数を報告

### 指定ファイル実行 (`/backend-test <path>`)

- 例: `/backend-test test/routes/users.test.ts`
  ```bash
  docker compose -f backend/docker-compose.yaml run --rm api npx vitest run test/routes/users.test.ts
  ```
- 指定ファイルのみを対象に同じループ処理を実行

## 制約・ルール
- 全コマンドは `docker compose -f backend/docker-compose.yaml run --rm api ...` で実行
- ローカルの node / npx コマンドは使用禁止
- 修正ループは最大3回まで。3回で解決しない場合はユーザーに報告して方針を相談
- テスト修正時はテストの意図を変えない (テストを通すためだけにアサーションを緩めない)
- ソースコードの修正が必要な場合は、テストが正しい前提で実装を修正する
- 型エラー (`tsc --noEmit`) も修正対象に含める
