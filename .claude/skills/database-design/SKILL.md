---
name: database-design
description: "DB設計書とDBMLスキーマの作成・更新 — 要件定義書からデータベース設計を生成"
---

# /database-design

## 概要
データベース設計書と DBML スキーマを作成・更新する。要件定義書を入力として、テーブル設計・ER図・マイグレーション方針を定義する。

## 入力ドキュメント
- `specification/docs/requirements/index.md` — 要件定義書

## 出力ドキュメント
- `specification/docs/database-design/index.md` — DB設計書
- `specification/docs/database-design/schema.dbml` — DBML スキーマ

## ワークフロー
1. 要件定義書を読み込み、必要なデータモデルを抽出
2. テーブル定義を設計
3. `index.md` に概要・ER図・テーブル定義・マイグレーション方針を記述
4. `schema.dbml` に DBML スキーマを記述
5. 要件トレーサビリティテーブルを作成
6. `version` をインクリメント、`last_updated` を更新
7. `sync_hash` の更新

## テンプレート

### Frontmatter
```yaml
---
hide:
  - navigation
doc_type: database-design
version: "1.0.0"
last_updated: "YYYY-MM-DD"
depends_on:
  - requirements/index.md
derived_by:
  - api-design/index.md
sync_hash: ""
dependency_hashes:
  requirements/index.md: ""
---
```

### セクション構成
1. 概要
2. ER図 (Mermaid erDiagram)
3. テーブル定義 (カラム一覧, インデックス, 制約)
4. DBML スキーマ
5. マイグレーション方針
6. 要件トレーサビリティ

## 制約・ルール
- テーブル名は snake_case (複数形)
- カラム名は snake_case
- 主キーは `id` (varchar, プレフィックス付き or UUID)
- 全テーブルに `created_at`, `updated_at` を付与
- 論理削除には `is_deleted` (boolean) を使用
- JSON型は `jsonb` を使用
- schema.dbml 編集後は同期チェックを実行
