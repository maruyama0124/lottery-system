# プロジェクト開発ルール

## プロジェクト種別
- 種別: `web-app`（サークル練習参加の抽選システム）
- 構成: `specification/`（設計サイト）／ `frontend/`（Next.js。メンバー画面 + 代表用管理画面）／ `backend/`（FastAPI。REST API + 抽選エンジン）
- フロントとバックエンドを分離した2サービス構成（開発者の理解しやすさを優先して採用）
- **注意**: backend 系 skills（backend-init 等）は Hono.js/TypeScript 前提のため本プロジェクトでは使用しない（D-010）。バックエンドは FastAPI で手動構築し、skills の構成方針（レイヤード・Docker・テスト）のみ踏襲する
- スタック選定の正本は `specification/docs/requirements/index.md` の「技術スタック / アーキテクチャ方針」節

## 進め方ルール（アシスタント向け・最優先）
- **コマンドは原則ユーザー自身が実行する。** アシスタントが勝手にコマンドを実行して作業を進めない
- ユーザーが問題や状況を提示したら、アシスタントは次の2点を レスポンス（文章）で返す。実行はユーザーが行う:
  1. 何が起きていると考えられるか（原因の仮説・理由）
  2. それを解消するために必要な手順・コマンド（ユーザーがコピペして実行できる形で）
- この方針の目的: ユーザー自身が状況を把握し、「何ができていて・何ができていないか」を理解し続けるため。および学習のため
- 例外: ユーザーが明示的に「実行して」「やって」と指示した場合のみ、アシスタントがコマンドを実行してよい


## コマンド実行ルール（アシスタント向け）
- コマンドは必ず正規のツール呼び出し形式で実行する。`<invoke name="Bash">…</invoke>` のような文字列を本文にそのまま書くことは禁止（実行されず、チャットに生タグが漏れて表示が途切れる原因になる）
- コマンド実行後は、結果（出力ブロック）が返ったことを確認してから「できた」と報告する。結果が返っていないのに完了と報告しない
- 応答中に生の `<invoke …>` タグが見えている場合はそのコマンドは失敗しているサイン。正しい形式で出し直す

## Docker 強制ルール
- Python / MkDocs コマンドは必ず Docker 経由で実行する
- `docker compose -f specification/docker-compose.yaml run --rm mkdocs <command>`
- ローカルの python / python3 は使用禁止

## 起動コマンド
- バックエンド: `docker compose -f backend/docker-compose.yaml up -d` (API: localhost:8010, Swagger: /api/v1/docs)
- バックエンドテスト: `docker compose -f backend/docker-compose.yaml exec api pytest -q`
- フロントエンド: `cd frontend && npx next dev` (localhost:3000。`.env.local` の API_URL=http://localhost:8010)
- 初期代表アカウント (開発用): rep-male@example.com / rep-female@example.com。`python -m src.db.seed --with-dev-reps` で作成（本番では作らない: D-040）

## Mermaid 日本語ルール
- 日本語を含むラベルは必ずダブルクォートで囲む
- subgraph: `subgraph ID["日本語ラベル"]`
- ノード: `NodeID["日本語ラベル"]`

## ファイル構成ルール
- 設計書は `specification/docs/` 以下に配置
- 各セクションは `index.md` をエントリポイントとする
- YAML形式に統一 (YML は使わない)
- Markdown ヘッダーに `hide: - navigation` を記載

## ドキュメント同期ルール
- 設計書の frontmatter には必ず同期メタデータを含める
- ドキュメント更新後は `/sync-docs check` で整合性を確認
- 同期ハッシュの更新は sync_checker.py で行う

## 設計判断の記録ルール (Decision Log)
- 仕様の決定・変更を行うときは、必ず `specification/docs/requirements/index.md` の「設計判断の記録 (Decision Log)」に D-XXX として追記する
- 各記録には最低限 **決定** / **背景**（なぜその判断に至ったか、議論の経緯）を書く。却下した代替案・受け入れたトレードオフがあればそれも残す
- 既存の決定を覆す場合は、新しい D-XXX を追加し、旧記録に「D-XXX により変更」と追記する（旧記録は消さない）
- ユーザーとの議論で仕様が決まった場合、その議論の要点（提案・指摘・判断理由）を背景に含める

## API 設計ルール
- POST / PUT / DELETE の 200 response は基本未定義
- 絶対に必要な場合のみ定義する

## DB 設計ルール
- schema.dbml を編集した後は同期チェックを実行
- テーブル名は snake_case (複数形)

## 議事録ルール
- 個人情報や機密情報を記載しない
- `/meeting-note` スキルで作成する

