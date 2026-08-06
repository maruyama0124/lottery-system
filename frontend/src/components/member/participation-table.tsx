"use client";

// 練習参加表 (D-025) — かつての Excel の参加表にあたるもの。
// 縦にメンバー・横に練習日を並べ、参加する日に印を付ける。
// 3年 / 2年 / 1年 / マネージャー のタブで切り替えて1グループずつ表示する。
// マネージャーは学年に関係なく1つにまとめる（定員外で全日参加する別枠の存在のため）。
import { useState } from "react";
import type { ParticipationRow, ParticipationTable as TableData } from "@/types/api";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const MANAGER = "manager" as const;

type TabKey = number | typeof MANAGER;

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

  const tabs: { key: TabKey; label: string; rows: ParticipationRow[] }[] = [
    ...data.grades
      .map((g) => ({
        key: g.grade as TabKey,
        label: `${g.grade}年`,
        rows: g.rows.filter((r) => !r.is_manager),
      }))
      .filter((t) => t.rows.length > 0),
    ...(managers.length ? [{ key: MANAGER, label: "マネージャー", rows: managers }] : []),
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

      {/* グループの切り替え。「マネージャー」だけ文字数が多いので幅は内容に合わせる */}
      <div className="mt-4 flex gap-2">
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
              className={`whitespace-nowrap rounded-full px-3 py-2 text-sm font-bold transition-colors ${
                t.key === MANAGER ? "shrink-0" : "flex-1"
              } ${
                isActive ? "bg-brand-600 text-white" : "border-2 border-gray-200 text-gray-500"
              }`}
            >
              {t.label}
              <span className={`ml-1 text-xs ${isActive ? "opacity-80" : ""}`}>
                {t.rows.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* 表だけを横スクロールさせる。ページ全体は横に動かさない */}
      <div className="-mx-1 mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white pb-2 pr-2 text-left text-xs font-bold text-gray-500">
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
                      className={`w-full rounded-t-lg px-1 pb-2 pt-1 text-center text-xs font-bold transition-colors ${
                        picked ? "bg-sky-100 text-sky-800" : "text-gray-600"
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
                      className={`w-full py-1.5 pr-3 text-left text-sm ${
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
        </table>
      </div>

      {!current?.rows.length && (
        <p className="py-6 text-center text-sm text-gray-500">該当する参加者はいません</p>
      )}

      <p className="mt-3 text-xs text-gray-400">
        名前や日付をタップすると、その行・列に色が付きます
      </p>
    </section>
  );
}
