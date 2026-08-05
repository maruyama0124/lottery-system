---
name: infrastructure-design
description: "インフラ設計書の作成・更新 — 要件定義書からインフラ構成を設計"
---

# /infrastructure-design

## 概要
インフラ設計書の作成・更新を行う。要件定義書を入力として、クラウドアーキテクチャ・ネットワーク・セキュリティ・CI/CD パイプラインを設計する。

## 入力ドキュメント
- `specification/docs/requirements/index.md` — 要件定義書

## 出力ドキュメント
- `specification/docs/infrastructure-design/index.md`

## ワークフロー
1. 要件定義書を読み込み、非機能要件を抽出
2. テンプレートに沿ってインフラ設計書を作成/更新
3. Mermaid 図でシステム構成・CI/CD パイプラインを可視化
4. `version` をインクリメント、`last_updated` を更新
5. `sync_hash` の更新

## テンプレート

### Frontmatter
```yaml
---
hide:
  - navigation
doc_type: infrastructure-design
version: "1.0.0"
last_updated: "YYYY-MM-DD"
depends_on:
  - requirements/index.md
derived_by: []
sync_hash: ""
dependency_hashes:
  requirements/index.md: ""
---
```

### セクション構成
1. システム構成図 (Mermaid図)
2. クラウドアーキテクチャ
3. ネットワーク設計
4. セキュリティ設計
5. 監視・ログ設計
6. バックアップ・DR
7. CI/CD パイプライン (Mermaid図)
8. コスト見積もり
9. 環境一覧
10. 要件トレーサビリティ

## 制約・ルール
- Mermaid図の日本語ラベルはダブルクォートで囲む
- 環境一覧テーブルには 環境 / 用途 / URL を記載
