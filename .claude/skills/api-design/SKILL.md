---
name: api-design
description: "API設計書とOpenAPI仕様の作成・更新 — 要件定義書とDB設計書からAPI設計書を生成"
---

# /api-design

## 概要
API設計書と OpenAPI 3.0 仕様を作成・更新する。要件定義書とDB設計書を入力として、RESTful API の設計を行う。

## 入力ドキュメント
- `specification/docs/requirements/index.md` — 要件定義書
- `specification/docs/database-design/index.md` — DB設計書

## 出力ドキュメント
- `specification/docs/api-design/index.md` — API設計書
- `specification/docs/api-design/openapi.yaml` — OpenAPI 3.0 仕様

## ワークフロー
1. 要件定義書とDB設計書を読み込み
2. API エンドポイントを設計
3. `index.md` にAPI概要・認証・共通仕様・エンドポイント一覧を記述
4. `openapi.yaml` に OpenAPI 3.0 仕様を記述
5. 要件トレーサビリティテーブルを作成
6. `version` をインクリメント (index.md と openapi.yaml の version を一致させる)
7. `sync_hash` の更新

## テンプレート

### Frontmatter
```yaml
---
hide:
  - navigation
doc_type: api-design
version: "1.0.0"
last_updated: "YYYY-MM-DD"
depends_on:
  - requirements/index.md
  - database-design/index.md
derived_by: []
sync_hash: ""
dependency_hashes:
  requirements/index.md: ""
  database-design/index.md: ""
---
```

### セクション構成
1. API概要
2. 認証・認可
3. 共通仕様 (ベースURL, リクエスト/レスポンス形式, エラーレスポンス, ページネーション, レート制限)
4. エンドポイント一覧 (Mermaid図)
5. API仕様詳細 — `<swagger-ui src="openapi.yaml"/>`
6. 要件トレーサビリティ

## 制約・ルール
- OpenAPI 3.0.0 準拠
- `info.version` は index.md の `version` と一致させる
- POST / PUT / DELETE の 200 response は基本未定義。絶対に必要な場合のみ定義
- JWT Bearer Token 認証をデフォルトとする
- スキーマ名は PascalCase
- Mermaid図の日本語ラベルはダブルクォートで囲む
