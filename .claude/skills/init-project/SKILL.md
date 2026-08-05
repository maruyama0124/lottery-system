---
name: init-project
description: "プロジェクト初期構築 — フォルダ構成・Docker・MkDocs設定を一括生成"
---

# /init-project

## 概要
新規プロジェクトの初期構築を行う。フォルダ構成、Docker設定、MkDocs設定、CLAUDE.md を一括生成する。

## 入力ドキュメント
- なし (ユーザーとの対話で情報を収集)

## 出力ドキュメント
- プロジェクトルート以下の全ファイル
- `specification/` — Docker + MkDocs + ドキュメントテンプレート一式
- `CLAUDE.md` — プロジェクトルール
- `.claude/settings.local.json` — 権限設定

## ワークフロー
1. ユーザーにプロジェクト名・概要を質問
2. フォルダ構成を生成 (specification/, frontend/, backend/)
3. `specification/Dockerfile`, `docker-compose.yaml`, `requirements.txt` を生成
4. `specification/mkdocs.yaml` を生成 (プロジェクト名を反映)
5. 各設計書の空テンプレートを配置
6. `CLAUDE.md` を生成
7. `.claude/settings.local.json` を生成
8. `docker compose -f specification/docker-compose.yaml build` で動作確認

## 制約・ルール
- frontend/, backend/ は空ディレクトリ (.gitkeep のみ) として作成
<!--- Docker 設定はセクション5の仕様に準拠-->
- mkdocs.yaml の `!!python/name:` タグはテキストとしてそのまま書き込む
