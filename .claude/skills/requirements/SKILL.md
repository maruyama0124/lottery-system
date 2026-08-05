---
name: requirements
description: "USDM要件定義書の作成・更新 — 事業計画書から要件定義書を生成"
---

# /requirements

## 概要
USDM (Universal Specification Describing Manner) 形式の要件定義書を作成・更新する。事業計画書を入力として、機能要件・非機能要件を定義する。

## 入力ドキュメント
- `specification/docs/business-plan/index.md` — 事業計画書

## 出力ドキュメント
- `specification/docs/requirements/index.md`

## ワークフロー
1. 事業計画書を読み込み、要件を抽出
2. 新規作成の場合: テンプレートに沿って要件定義書を作成
3. 更新の場合: 既存の要件定義書を読み込み、差分を反映
4. USDM テーブル形式で機能要件 (REQ-XXX) を記述
5. 非機能要件 (NFR-XXX) を記述
6. `version` をインクリメント、`last_updated` を更新
7. `sync_hash` の更新: `docker compose -f specification/docker-compose.yaml run --rm mkdocs python scripts/sync_checker.py update-hashes`

## テンプレート

### USDM テーブル形式
```
### REQ-001: 要件グループ名

| ID | 要求 | 理由 | 説明 |
|----|------|------|------|
| REQ-001 | 上位要求の記述 | なぜこの要求が必要か | 補足説明 |
| REQ-001.1 | 詳細仕様1 | 理由 | 説明 |
| REQ-001.2 | 詳細仕様2 | 理由 | 説明 |
```

### Frontmatter
```yaml
---
hide:
  - navigation
doc_type: requirements
version: "1.0.0"
last_updated: "YYYY-MM-DD"
depends_on:
  - business-plan/index.md
derived_by:
  - api-design/index.md
  - database-design/index.md
  - ui-design/index.md
  - infrastructure-design/index.md
sync_hash: ""
dependency_hashes:
  business-plan/index.md: ""
---
```

### セクション構成
1. プロジェクト概要
2. システム概要 (Mermaid システム構成図)
3. 機能要件 (USDM) — REQ-001〜
4. 非機能要件 — NFR-001: パフォーマンス, NFR-002: セキュリティ, NFR-003: 可用性, NFR-004: 拡張性
5. 用語集
6. 制約事項

## 制約・ルール
- 機能要件は `REQ-XXX` 形式 (XXX は3桁ゼロ埋め)
- 非機能要件は `NFR-XXX` 形式
- 各要件は 要求 / 理由 / 説明 の3列を必須とする
- 階層は REQ-001 → REQ-001.1 → REQ-001.1.1 の最大3階層
- Mermaid図の日本語ラベルはダブルクォートで囲む
