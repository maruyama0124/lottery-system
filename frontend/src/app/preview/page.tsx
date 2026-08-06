// クエーさんの表情確認用。デザインが固まったらこのディレクトリごと削除してよい
import { Quasar } from "@/components/quasar";

const MOODS = [
  { mood: "normal", label: "normal（通常）" },
  { mood: "happy", label: "happy（当選・保存完了）" },
  { mood: "wait", label: "wait（抽選まち）" },
  { mood: "sad", label: "sad（落選・エラー）" },
] as const;

export default function PreviewPage() {
  return (
    <div className="min-h-screen bg-brand-50 p-6">
      <p className="mb-6 text-center text-2xl font-bold text-brand-700">クエーさん</p>
      <div className="mx-auto grid max-w-[480px] grid-cols-2 gap-4">
        {MOODS.map(({ mood, label }) => (
          <div key={mood} className="rounded-3xl bg-white p-4 text-center shadow-sm">
            <Quasar mood={mood} size={140} className="mx-auto" />
            <p className="mt-2 text-xs font-bold text-gray-600">{label}</p>
          </div>
        ))}
      </div>

      {/* 小さいサイズでの見え方（投票カードで 72px で使う） */}
      <div className="mx-auto mt-6 max-w-[480px] rounded-3xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-bold text-gray-600">小さいとき（72px）</p>
        <div className="flex items-center justify-around">
          {MOODS.map(({ mood }) => (
            <Quasar key={mood} mood={mood} size={72} />
          ))}
        </div>
      </div>
    </div>
  );
}
