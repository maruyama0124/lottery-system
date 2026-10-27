/**
 * 代表向けの更新履歴。実装済みの変更を新しい順に追記する。
 * idは設計書のDecision Logに対応する。公開日が不明な履歴の日付は推測しない。
 */
export interface ReleaseNote {
  id: string;
  /** 1つの記事にまとめた関連変更のDecision Log。idは最新の変更に対応する。 */
  relatedDecisionIds?: readonly string[];
  title: string;
  category: "日程" | "抽選" | "表示" | "使い方" | "お知らせ";
  changes: readonly string[];
  /** 本文内で太字・強調色にする文字列。HTMLは記載しない。 */
  highlight?: string;
}

export const releaseNotes: readonly ReleaseNote[] = [
  {
    id: "D-066", category: "お知らせ", title: "更新履歴を代表画面に追加",
    changes: [
      "下部メニューの「更新」から変更履歴を確認できます。"
    ],
  },
  {
    id: "D-064", category: "日程", title: "人数の設定を抽選準備に一本化",
    highlight: "日程作成時の人数入力をなくし、抽選準備で学年別に決める",
    changes: [
      "日程作成時の人数入力をなくし、抽選準備で学年別に決める形にしました。"
    ],
  },
  {
    id: "D-063", relatedDecisionIds: ["D-060", "D-061", "D-062"],
    category: "日程", title: "男女の日程をまとめて登録・編集できるように",
    changes: [
      "どちらの代表からでも、練習日ごとに「男子・女子・両方」を選んで登録・編集できます。",
    ],
  },
  {
    id: "D-055", category: "表示", title: "メンバーの行順を手動で変更",
    highlight: "LINE内では操作しづらい場合があるため、通常のブラウザやホーム画面からの利用を推奨",
    changes: [
      "同学年の行を並べ替えられます（LINE内では操作しづらい場合があるため、通常のブラウザやホーム画面からの利用を推奨）。",
    ],
  },
  {
    id: "D-054", category: "抽選", title: "確定日を公開した後も、残りの日程へ投票可能に",
    changes: [
      "一部の日程を先に公開した月でも、受付期間中は残りの日程へ投票できます。",
    ],
  },
  {
    id: "D-053", category: "抽選", title: "確定した練習日を抽選対象から除外",
    changes: [
      "管理者が確定済みの練習日を固定し、参加者を維持したまま残りの日程だけを抽選できます。",
    ],
  },
];
