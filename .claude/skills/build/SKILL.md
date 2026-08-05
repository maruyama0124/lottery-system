---
name: build
description: "MkDocs静的サイトビルド — specification/site/に静的ファイルを生成"
---

# /build

## 概要
MkDocs の静的サイトビルドを実行する。`specification/site/` に静的ファイルを生成する。

## 入力ドキュメント
- `specification/docs/` 以下の全ドキュメント

## 出力ドキュメント
- `specification/site/` — 静的サイトファイル

## ワークフロー
1. MkDocs ビルドを実行:
   ```
   docker compose -f specification/docker-compose.yaml run --rm mkdocs mkdocs build
   ```
2. `specification/site/` に静的ファイルが生成される

## 制約・ルール
- ビルド前にナビゲーション更新を推奨: `docker compose -f specification/docker-compose.yaml run --rm mkdocs python scripts/nav_updater.py`
- `specification/site/` は `.gitignore` に含まれている
