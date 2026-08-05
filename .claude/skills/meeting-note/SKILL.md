---
name: meeting-note
description: "議事録の作成 — 会議内容をテンプレートに沿って記録"
---

# /meeting-note

## 概要
議事録の作成を行う。ユーザーとの対話から会議内容を記録し、設計書への影響を整理する。

## 入力ドキュメント
- ユーザーとの対話

## 出力ドキュメント
- `specification/docs/meeting-notes/YYYY-MM-DD-<title>.md`
- `specification/mkdocs.yaml` (ナビゲーション更新)

## ワークフロー
1. ユーザーに会議名を質問 (日付は自動取得)
2. 議事録テンプレートを生成:
   ```
   docker compose -f specification/docker-compose.yaml run --rm mkdocs python scripts/meeting_note_creator.py "会議名"
   ```
3. ナビゲーションが自動更新される (meeting_note_creator.py が nav_updater.py を呼び出す)
4. 生成された議事録ファイルに会議内容を記入

## テンプレート

```markdown
---
hide:
  - navigation
---

# 【{meeting_name}】 - {meeting_date}

## 会議情報
- **日時**: {meeting_date} HH:MM〜HH:MM
- **参加者**:
- **議題**:

## アジェンダ
1.

## 討議内容
###

## 決定事項
-

## アクションアイテム

| タスク | 担当者 | 期限 | 状態 |
|--------|--------|------|------|
| | | | 未着手 |

## 次回予定
- **日時**:
- **議題**:

## 設計書への影響
- [ ] 事業計画書の更新が必要
- [ ] 要件定義書の更新が必要
- [ ] DB設計の変更が必要
- [ ] API設計の変更が必要
- [ ] 画面設計の変更が必要
- [ ] インフラ設計の変更が必要
```

## 制約・ルール
- 個人情報や機密情報を記載しない
- ファイル名: `YYYY-MM-DD-<会議名>.md`
- 議事録作成は必ず `meeting_note_creator.py` 経由 (Docker内実行)
- 「設計書への影響」セクションで更新が必要な設計書を明示する
