---
name: business-plan
description: "事業計画書の作成・更新 — 対話または議事録から事業計画書を生成"
---

# /business-plan

## 概要
事業計画書の作成・更新を行う。ユーザーとの対話、または議事録 (`meeting-notes/*.md`) を入力として事業計画書を生成する。

## 入力ドキュメント
- ユーザーとの対話
- `specification/docs/meeting-notes/*.md` — 関連する議事録 (任意)

## 出力ドキュメント
- `specification/docs/business-plan/index.md`

## ワークフロー
1. 新規作成の場合: ユーザーにプロジェクトの背景・目的・計画を質問
2. 更新の場合: 既存の事業計画書を読み込み、変更点を確認
3. テンプレートに沿って事業計画書を作成/更新
4. `version` をインクリメント、`last_updated` を更新
5. `sync_hash` の更新: `docker compose -f specification/docker-compose.yaml run --rm mkdocs python scripts/sync_checker.py update-hashes`
6. `/sync-docs check` で整合性を確認

## テンプレート

```yaml
---
hide:
  - navigation
doc_type: business-plan
version: "1.0.0"
last_updated: "YYYY-MM-DD"
depends_on: []
derived_by:
  - requirements/index.md
sync_hash: ""
dependency_hashes: {}
---
```

### セクション構成
1. エグゼクティブサマリー
2. プロジェクト背景・課題
3. ソリューション概要
4. ターゲットユーザー
5. ビジネスモデル
6. 市場分析
7. 競合分析
8. 開発ロードマップ
9. KPI・成功指標
10. リスクと対策

## 制約・ルール
- 更新時は `version` をセマンティックバージョニングでインクリメント
- `last_updated` は更新日の日付に設定
- 保存後は必ず `sync_checker.py update-hashes` でハッシュを更新
- `derived_by` に `requirements/index.md` を含める
