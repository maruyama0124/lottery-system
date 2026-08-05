---
name: sync-docs
description: "双方向ドキュメント同期 — 設計書間の整合性チェックと更新"
---

# /sync-docs

## 概要
双方向ドキュメント同期を実行する。全設計書の整合性をチェックし、変更が必要なドキュメントを特定・更新する。

## サブコマンド
- `/sync-docs check` — 同期状態の確認
- `/sync-docs update` — 同期が必要なドキュメントを更新

## 入力ドキュメント
- 全設計書 (`specification/docs/` 以下)

## 出力ドキュメント
- 同期レポート (標準出力)
- 更新が必要なドキュメント (update サブコマンド時)

## ワークフロー (check)
1. sync_checker.py を実行:
   ```
   docker compose -f specification/docker-compose.yaml run --rm mkdocs python scripts/sync_checker.py check
   ```
2. 各ドキュメントの `sync_hash` と実際のハッシュを比較
3. `dependency_hashes` と依存先の `sync_hash` を比較
4. 結果をレポート形式で出力

## ワークフロー (update)
1. check の結果を元に、outdated なドキュメントを特定
2. トポロジカルソート順に更新対象を並べる:
   - business-plan → requirements → database-design → api-design, ui-design, infrastructure-design
3. 各ドキュメントについて:
   a. 依存先の変更差分を読み取る
   b. 変更内容を反映してドキュメントを更新
   c. `sync_hash`, `dependency_hashes` を再計算:
      ```
      docker compose -f specification/docker-compose.yaml run --rm mkdocs python scripts/sync_checker.py update-hashes
      ```
4. 最終的な同期レポートを出力

## レポート形式
```
=== ドキュメント同期レポート ===

✅ business-plan/index.md — 同期済み (v1.2.0)
⚠️  requirements/index.md — 依存先変更あり (v1.1.0)
    └── business-plan/index.md が更新されています
❌ api-design/index.md — 未同期 (v1.0.0)
    └── requirements/index.md が更新されています
    └── database-design/index.md が更新されています
```

## 制約・ルール
- sync_checker.py は必ず Docker 経由で実行
- ドキュメント更新は上位から下位の順序で行う (トポロジカルソート)
- 上向き伝播 (下位→上位) の場合はレビュー対象として報告
