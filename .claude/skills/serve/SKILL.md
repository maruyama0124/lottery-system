---
name: serve
description: "MkDocs開発サーバーの起動 — Dockerでローカルプレビューサーバーを起動"
---

# /serve

## 概要
MkDocs 開発サーバーを Docker で起動する。ファイル変更を検知して自動リロードする。

## 入力ドキュメント
- なし

## 出力ドキュメント
- なし (localhost:8000 でプレビュー)

## ワークフロー
1. Docker コンテナで MkDocs 開発サーバーを起動:
   ```
   docker compose -f specification/docker-compose.yaml up mkdocs-serve
   ```
2. ブラウザで http://localhost:8000 を開いて確認

## 制約・ルール
- ポート 8000 を使用
- 停止は Ctrl+C
- ファイル変更時は自動リロード
