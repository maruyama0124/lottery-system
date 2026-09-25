"use client";

// 練習参加表 (D-025) — かつての Excel の参加表にあたるもの。
// 縦にメンバー・横に練習日を並べ、参加する日に印を付ける。
// 参加しない人・投票しなかった人も行に並ぶ (D-043)。
// 3年 / 2年 / 1年 / マネージャー のタブで切り替えて1グループずつ表示する。
// マネージャーは学年に関係なく1つにまとめる（定員外で全日参加する別枠の存在のため）。
import { useState } from "react";
import type { ParticipationRow, ParticipationTable as TableData } from "@/types/api";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const MANAGER = "manager" as const;
const SUMMARY = "summary" as const;

type TabKey = number | typeof MANAGER | typeof SUMMARY;

/** "2026-08-24" → "8/24" と "月" に分ける（2行に積んで列幅を詰める） */
function formatHead(dateStr: string): [string, string] {
  const d = new Date(`${dateStr}T00:00:00`);
  return [`${d.getMonth() + 1}/${d.getDate()}`, WEEKDAYS[d.getDay()]];
}

export function ParticipationTable({
  data,
  currentUserId,
  currentUserGrade,
  currentUserIsManager,
}: {
  data: TableData;
  currentUserId: string;
  currentUserGrade: number;
  currentUserIsManager: boolean;
}) {
  // API は学年ごとに返すので、マネージャーはここで抜き出して1つにまとめる
  const managers: ParticipationRow[] = data.grades
    .flatMap((g) => g.rows)
    .filter((r) => r.is_manager)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  const gradeTabs = data.grades
    .map((g) => ({
      key: g.grade as TabKey,
      label: `${g.grade}年`,
      rows: g.rows.filter((r) => !r.is_manager),
    }))
    .filter((t) => t.rows.length > 0);

  const tabs: { key: TabKey; label: string; rows: ParticipationRow[] }[] = [
    ...gradeTabs,
    ...(managers.length ? [{ key: MANAGER, label: "マネージャー", rows: managers }] : []),
    // 日ごとの学年別人数を横断して見るタブ (D-041)
    { key: SUMMARY, label: "集計", rows: [] },
  ];

  // 自分が含まれるタブを初期表示にすると、開いてすぐ自分の行が見つかる
  const [active, setActive] = useState<TabKey>(() => {
    const mine = currentUserIsManager ? MANAGER : currentUserGrade;
    return tabs.some((t) => t.key === mine) ? mine : (tabs[0]?.key ?? 1);
  });

  // 行・列の強調表示。名前や日付をタップすると目で追いやすくなる。
  // 同じところをもう一度タップすると解除する
  const [pickedRow, setPickedRow] = useState<string | null>(null);
  const [pickedCol, setPickedCol] = useState<string | null>(null);

  const current = tabs.find((t) => t.key === active);
  const practiceIds = data.practices.map((p) => p.id);

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm">
      <h2 className="font-bold text-gray-900">練習参加表</h2>
      <p className="mt-0.5 text-sm text-gray-500">誰がどの日に参加するかの一覧</p>

      {/* グループの切り替え。スマホ幅で入り切らないときは折り返して、
          最後の「集計」が画面外に隠れないようにする */}
      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={String(t.key)}
              type="button"
              onClick={() => {
                setActive(t.key);
                setPickedRow(null); // 学年をまたぐと行の選択は無効になる
              }}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-sm font-bold transition-colors ${
                isActive ? "bg-brand-600 text-white" : "border-2 border-gray-200 text-gray-500"
              }`}
            >
              {t.label}
              {t.key !== SUMMARY && (
                <span className={`ml-1 text-xs ${isActive ? "opacity-80" : ""}`}>
                  {t.rows.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 集計タブ — 日ごとの学年別人数 (D-041) */}
      {active === SUMMARY && (
        <div className="-mx-1 mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-gray-200 [&_th]:border [&_th]:border-gray-200">
            <thead>
              <tr className="bg-gray-50 text-xs font-bold text-gray-500">
                <th className="px-2 py-2 text-left">日付</th>
                {gradeTabs.map((t) => (
                  <th key={String(t.key)} className="px-2 py-2 text-right">
                    {t.label}
                  </th>
                ))}
                {managers.length > 0 && <th className="px-2 py-2 text-right">マネ</th>}
                <th className="px-2 py-2 text-right">合計</th>
              </tr>
            </thead>
            <tbody>
              {data.practices.map((p) => {
                const [md, wd] = formatHead(p.practice_date);
                const counts = gradeTabs.map(
                  (t) => t.rows.filter((r) => r.practice_ids.includes(p.id)).length,
                );
                const mgrCount = managers.filter((r) =>
                  r.practice_ids.includes(p.id),
                ).length;
                const total = counts.reduce((a, b) => a + b, 0) + mgrCount;
                // 日付をタップすると行に色が付く。学年タブの列の選択と同じ状態を使うので、
                // タブを切り替えても同じ日が強調されたままになる
                const picked = p.id === pickedCol;
                const rowBg = picked ? "bg-sky-50" : "";
                return (
                  <tr key={p.id} className={rowBg || undefined}>
                    <td className="whitespace-nowrap p-0">
                      <button
                        type="button"
                        onClick={() => setPickedCol(picked ? null : p.id)}
                        className={`w-full px-2 py-2 text-left font-bold ${
                          picked ? "text-sky-800" : "text-gray-800"
                        }`}
                      >
                        {md}({wd})
                      </button>
                    </td>
                    {counts.map((n, i) => (
                      <td key={i} className="px-2 py-2 text-right text-gray-700">
                        {n}
                      </td>
                    ))}
                    {managers.length > 0 && (
                      <td className="px-2 py-2 text-right text-gray-700">{mgrCount}</td>
                    )}
                    <td
                      className={`px-2 py-2 text-right font-bold ${
                        picked ? "text-sky-800" : "text-brand-700"
                      }`}
                    >
                      {total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 表だけを横スクロールさせる。ページ全体は横に動かさない */}
      {active !== SUMMARY && (
      <div className="-mx-1 mt-3 overflow-x-auto">
        {/* 罫線は行・列を目で追いやすくするため全セルに付ける。
            名前列を sticky にしているので border-collapse だと横スクロール時に
            罫線が置いていかれる (Chrome の既知の挙動)。border-separate にして
            各セルの右と下だけ引き、左上の外枠は table 側で引く */}
        <table className="w-full border-separate border-spacing-0 border-l border-t border-gray-200 text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-gray-200 [&_th]:border-b [&_th]:border-r [&_th]:border-gray-200">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-2 py-2 text-left text-xs font-bold text-gray-500">
                名前
              </th>
              {data.practices.map((p) => {
                const picked = p.id === pickedCol;
                const [md, wd] = formatHead(p.practice_date);
                return (
                  <th key={p.id} className="p-0">
                    <button
                      type="button"
                      onClick={() => setPickedCol(picked ? null : p.id)}
                      className={`w-full px-1 py-1 text-center text-xs font-bold transition-colors ${
                        picked ? "bg-sky-100 text-sky-800" : "bg-gray-50 text-gray-600"
                      }`}
                    >
                      <span className="block">{md}</span>
                      <span
                        className={`block font-normal ${
                          picked ? "text-sky-600" : "text-gray-400"
                        }`}
                      >
                        ({wd})
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {current?.rows.map((row) => {
              const isMe = row.user_id === currentUserId;
              const rowPicked = row.user_id === pickedRow;
              // 自分の行の色を優先し、それ以外で選択中なら青にする
              const rowBg = isMe ? "bg-accent-50" : rowPicked ? "bg-sky-50" : "";
              return (
                <tr key={row.user_id} className={rowBg || undefined}>
                  <td className={`sticky left-0 whitespace-nowrap p-0 ${rowBg || "bg-white"}`}>
                    <button
                      type="button"
                      onClick={() => setPickedRow(rowPicked ? null : row.user_id)}
                      className={`w-full px-2 py-1.5 text-left text-sm ${
                        isMe
                          ? "font-bold text-accent-700"
                          : rowPicked
                            ? "font-bold text-sky-800"
                            : "text-gray-700"
                      }`}
                    >
                      {row.name}
                    </button>
                  </td>
                  {practiceIds.map((pid) => {
                    const colPicked = pid === pickedCol;
                    const joining = row.practice_ids.includes(pid);
                    // 行と列の交点はさらに濃くして、どこを見ているかを示す
                    const cellBg =
                      colPicked && rowPicked ? "bg-sky-200" : colPicked ? "bg-sky-50" : "";
                    return (
                      <td key={pid} className={`py-1.5 text-center ${cellBg}`}>
                        {joining ? (
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full ${
                              isMe
                                ? "bg-accent-500"
                                : rowPicked || colPicked
                                  ? "bg-sky-600"
                                  : "bg-brand-500"
                            }`}
                          />
                        ) : (
                          <span className="text-gray-200">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {/* 表示中のグループの、日ごとの参加人数 */}
          {current && current.rows.length > 0 && (
            <tfoot>
              <tr>
                <td className="sticky left-0 bg-gray-50 px-2 py-1.5 text-left text-xs font-bold text-gray-500">
                  {current.label} 合計
                </td>
                {practiceIds.map((pid) => {
                  const colPicked = pid === pickedCol;
                  const count = current.rows.filter((r) =>
                    r.practice_ids.includes(pid),
                  ).length;
                  return (
                    <td
                      key={pid}
                      className={`py-1.5 text-center text-sm font-bold ${
                        colPicked ? "bg-sky-50 text-sky-800" : "bg-gray-50 text-brand-700"
                      }`}
                    >
                      {count}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}

      {active !== SUMMARY && !current?.rows.length && (
        <p className="py-6 text-center text-sm text-gray-500">該当する参加者はいません</p>
      )}

      <p className="mt-3 text-xs text-gray-400">
        {active === SUMMARY
          ? "日付をタップすると、その行に色が付きます"
          : "名前や日付をタップすると、その行・列に色が付きます"}
      </p>
    </section>
  );
}
