---
name: ui-design
description: "画面設計書・画面定義YAML・HTMLモックアップの作成・更新"
---

# /ui-design

## 概要
画面設計書、画面定義YAML、HTML モックアップを作成・更新する。要件定義書とAPI設計書を入力として、画面仕様を定義する。

## 入力ドキュメント
- `specification/docs/requirements/index.md` — 要件定義書
- `specification/docs/api-design/index.md` — API設計書

## 出力ドキュメント
- `specification/docs/ui-design/index.md` — 画面設計書
- `specification/docs/ui-design/screen-designs.yaml` — 画面定義YAML
- `specification/docs/ui-design/snippets/*.html` — HTMLモックアップ

## ワークフロー
1. 要件定義書とAPI設計書を読み込み
2. 画面一覧・画面遷移図を設計
3. `index.md` に画面一覧・遷移図・共通レイアウト・各画面詳細を記述
4. `screen-designs.yaml` に画面定義を構造化記述
5. 各画面の HTML モックアップを Task サブエージェントで並列生成
   - モックアップが必要な画面を特定する (`screen-designs.yaml` の各エントリ)
   - 画面ごとに Task サブエージェントを起動 (1メッセージ内で複数 Task 呼び出しにより並列実行)
   - 各サブエージェントへの入力:
     - `screen-designs.yaml` 内の対象画面の定義
     - `index.md` 内の対象画面詳細セクション (画面要素・API連携・状態)
     - 共通 HTML パターン・制約 (制約・ルール セクションを参照)
   - 各サブエージェントは `snippets/<screen-id>-<device>.html` を 1 ファイル作成して終了
   - モックアップ生成後、`index.md` の各画面詳細セクションに `<iframe>` タグを挿入
6. 要件トレーサビリティテーブルを作成
7. `version` をインクリメント、`sync_hash` を更新

## テンプレート

### Frontmatter
```yaml
---
hide:
  - navigation
doc_type: ui-design
version: "1.0.0"
last_updated: "YYYY-MM-DD"
depends_on:
  - requirements/index.md
  - api-design/index.md
derived_by: []
sync_hash: ""
dependency_hashes:
  requirements/index.md: ""
  api-design/index.md: ""
---
```

### screen-designs.yaml 形式
```yaml
screens:
  screen-id:
    name: "画面名"
    path: "/path"
    layout: "default | auth | dashboard"
    references:
      requirements: ["REQ-001.1"]
      apis: ["GET /resource"]
      user_stories: ["ユーザーストーリー"]
    elements:
      section-name:
        fields:
          - id: "field-id"
            type: "text | email | password | select | textarea | date | file"
            label: "ラベル"
            required: true
            validation: "バリデーションルール"
        actions:
          - id: "action-id"
            type: "submit | link | button"
            label: "ラベル"
            api: "POST /resource"
    states: ["default", "loading", "error", "empty"]
```

## 制約・ルール
- HTML モックアップのファイル名: `<screen-id>-<device>.html` (例: `login-desktop.html`)
- HTML は自己完結型 (`<script src="https://cdn.tailwindcss.com"></script>` のみ外部参照可)
- モバイル画面: `max-width: 480px; margin: 0 auto;`、sticky ヘッダー、ステップインジケーター、ブランドカラー `purple-600`
- モバイル画面の日本語フォント: `font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;`
- デスクトップ画面 (管理画面): サイドバーレイアウト (`w-64` 固定幅)。ログインは中央カードレイアウト
- `index.md` へのモックアップ埋め込みは `<iframe>` タグを使用:
  ```html
  <iframe src="snippets/<screen-id>-<device>.html"
          width="100%"
          height="<N>px"
          frameborder="0"
          style="border: none; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
  </iframe>
  ```
  height の目安: 550–900px (コンテンツ量に応じて調整)
- Mermaid stateDiagram-v2 で画面遷移図を記述
