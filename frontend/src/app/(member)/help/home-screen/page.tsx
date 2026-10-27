import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import appIcon from "@/app/apple-icon.png";
import { CopyHomeUrl } from "@/components/member/copy-home-url";

export const metadata: Metadata = {
  title: "クエーさんをiOS/Androidアプリのように使う方法",
  description: "ホーム画面にアイコンを追加して、タップでクエーさんを開く方法を図で紹介します。",
};

function ShareIcon() {
  return <svg aria-hidden="true" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Highlight({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-accent-500 bg-accent-50 px-3 py-3 font-bold text-gray-900">{children}<span className="shrink-0 text-xs text-accent-700">← タップ</span></div>;
}

function Phone({ children }: { children: ReactNode }) {
  return <div aria-hidden="true" className="relative mx-auto aspect-[180/300] w-[148px] shrink-0"><div className="absolute left-0 top-0 flex aspect-[180/300] w-64 origin-top-left scale-[0.578125] flex-col overflow-hidden rounded-[24px] border-[3px] border-gray-700 bg-white shadow-sm"><div className="flex shrink-0 items-center justify-between px-3 py-2 text-[9px] font-bold text-gray-500"><span>9:41</span><span>●●● ▰</span></div><div className="flex min-h-0 flex-1 items-center overflow-hidden bg-brand-50"><div className="w-full">{children}</div></div><div className="mx-auto my-2 h-1 w-14 shrink-0 rounded-full bg-gray-300" /></div></div>;
}

function SitePreview() {
  const practices = [{ date: "10/7", selected: true }, { date: "10/14", selected: false }, { date: "10/19", selected: true }];
  return <svg viewBox="0 0 320 370" role="img" aria-label="クエーさんの投票画面の簡略図。日付の一覧から参加日を選んで送信する" className="block h-auto w-full bg-brand-50" style={{ fontFamily: 'var(--font-noto-sans-jp), sans-serif' }}>
    <rect width="320" height="370" fill="#f0fbf8" /><image href={appIcon.src} x="22" y="18" width="62" height="62" /><text x="96" y="56" fontSize="22" fontWeight="700" fill="#1d6e60">クエーさん</text><text x="24" y="108" fontSize="16" fontWeight="700" fill="#374151">参加できる日を選ぶ</text>
    {practices.map((practice, index) => <g key={practice.date} transform={"translate(0 " + (127 + index * 59) + ")"}><rect x="22" width="276" height="49" rx="17" fill={practice.selected ? "#d8f3ec" : "white"} stroke={practice.selected ? "#7fd5c3" : "#e5eee9"} strokeWidth="2" /><circle cx="47" cy="24" r="12" fill={practice.selected ? "#248876" : "white"} stroke={practice.selected ? "#248876" : "#d1d5db"} strokeWidth="2" />{practice.selected && <path d="m41 24 4 4 8-8" fill="none" stroke="white" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />}<text x="73" y="31" fontSize="19" fontWeight="700" fill="#374151">{practice.date}</text><rect x="159" y="17" width="102" height="6" rx="3" fill={practice.selected ? "#a9cec3" : "#e5e7eb"} /><rect x="159" y="29" width="65" height="5" rx="2.5" fill={practice.selected ? "#bfdfd6" : "#eef0f2"} /></g>)}
    <rect x="22" y="316" width="276" height="40" rx="20" fill="#248876" /><text x="160" y="342" textAnchor="middle" fontSize="17" fontWeight="700" fill="white">2日を送信</text>
  </svg>;
}

function BrowserKeyboard({ iphone = false }: { iphone?: boolean }) {
  return <div className="space-y-2 bg-gray-200 p-3">{[0, 1].map((row) => <div key={row} className="flex gap-1.5">{Array.from({ length: 8 }, (_, key) => <span key={key} className="h-6 flex-1 rounded bg-white" />)}</div>)}<div className="flex items-center gap-2"><span className="h-7 flex-1 rounded bg-white" /><span className="rounded-lg border-2 border-accent-500 bg-blue-500 px-3 py-2 text-xs font-bold text-white">{iphone ? "開く" : "移動 →"}</span></div></div>;
}

function SafariPastePreview() {
  return <div role="img" aria-label="Safariの操作イメージ。下のアドレス欄へペーストし、キーボード右下の開くを押す"><Phone>
    <div className="bg-sky-50 px-4 pb-6 pt-5"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm"><svg width="38" height="38" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" fill="#38a5e9" /><path d="m27 12-4 12-11 4 5-12z" fill="white" /><path d="m27 12-4 12-6-8z" fill="#ef7973" /></svg></div><p className="mt-2 text-center text-sm font-bold text-sky-900">Safari</p><div className="mt-5 grid grid-cols-4 gap-3">{["bg-blue-100", "bg-orange-100", "bg-green-100", "bg-purple-100"].map((color) => <div key={color} className={"aspect-square rounded-xl " + color} />)}</div></div>
    <div className="bg-gray-50 px-3 pb-3 pt-4"><p className="mb-2 text-center text-xs font-bold text-accent-700">長押し → ペースト ↓</p><div className="rounded-xl border-2 border-accent-500 bg-white px-2 py-3 text-[10px] tracking-tight text-gray-800">liff.line.me/2010994046-WzxKysKA</div></div><BrowserKeyboard iphone />
  </Phone></div>;
}

function BrowserSetup({ device }: { device: "iphone" | "android" }) {
  const browser = device === "iphone" ? "Safari" : "Chrome";
  return <ol className="mt-4 space-y-3">
    <li className="rounded-3xl bg-white p-4 shadow-sm"><h3 className="flex items-center gap-3 text-sm font-bold text-gray-900"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white">1</span>このURLをコピー</h3><CopyHomeUrl /></li>
    <li className="rounded-3xl bg-white p-4 shadow-sm"><h3 className="mb-4 flex items-center gap-3 text-sm font-bold text-gray-900"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white">2</span>{browser}を開いて貼り付け</h3>
      {device === "iphone" ? <SafariPastePreview /> : <figure><Phone>
        <div className="space-y-3 bg-gray-50 px-3 py-4"><p className="text-center text-sm font-bold text-gray-700">Chrome</p><div className="flex items-center gap-2"><div className="min-w-0 flex-1 rounded-full border-2 border-accent-500 bg-white px-2 py-3 text-[9px] tracking-tight text-gray-800">liff.line.me/2010994046-WzxKysKA</div><span className="text-xl text-gray-400">⋮</span></div><p className="text-center text-xs font-bold text-accent-700">↑ アドレス欄を長押し → 貼り付け</p></div>
        <div className="bg-sky-50 px-4 py-6"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm"><svg width="38" height="38" viewBox="0 0 40 40" fill="none"><path d="M20 20 3 10a19 19 0 0 1 34 0z" fill="#ed766d" /><path d="m20 20 17-10a19 19 0 0 1-17 29z" fill="#f4cf6c" /><path d="m20 20 0 19A19 19 0 0 1 3 10z" fill="#7ac59b" /><circle cx="20" cy="20" r="8" fill="#60a5e8" stroke="white" strokeWidth="2" /></svg></div></div><BrowserKeyboard />
      </Phone><figcaption className="mt-3 text-center text-xs text-gray-600">貼り付けたら、キーボードの「移動」や「→」をタップ。</figcaption></figure>}
    </li>
    <Step number={3} title="同じLINEアカウントでログイン" label="ブラウザでLINEログインし、投票画面が表示されたら次の手順へ" hint="ログイン済みなら、そのまま次へ。"><div className="space-y-2 bg-gray-50 px-3 py-3 text-center"><p className="text-xl font-bold text-[#06c755]">LINE</p><p className="text-xs font-bold text-gray-800">いつもと同じアカウントで</p><Highlight><span className="flex-1 rounded-lg bg-[#06c755] px-2 py-2 text-white">ログイン</span></Highlight></div><p className="py-2 text-center text-lg font-bold text-brand-700">↓</p><div className="mx-auto max-w-36"><SitePreview /></div></Step>
  </ol>;
}

function HomeScreenPreview() {
  const apps = [
    { name: "カレンダー", symbol: "17", color: "#ffffff" },
    { name: "写真", symbol: "🌸", color: "#ffffff" },
    { name: "カメラ", symbol: "📷", color: "#e5e7eb" },
    { name: "天気", symbol: "☀️", color: "#7dc9f5" },
    { name: "クエーさん", symbol: "", color: "#f0fbf8" },
    { name: "設定", symbol: "⚙️", color: "#d1d5db" },
    { name: "メモ", symbol: "📝", color: "#fff2bc" },
    { name: "時計", symbol: "🕘", color: "#374151" },
    { name: "マップ", symbol: "🗺️", color: "#e2f1dc" },
  ];
  return (
<svg viewBox="0 0 180 285" className="mx-auto block h-auto w-full max-w-60" aria-hidden="true">
              <rect width="180" height="285" fill="#dde5f7" />
              {apps.map((app, index) => {
                const x = 13 + (index % 3) * 56;
                const y = 14 + Math.floor(index / 3) * 66;
                const isQuasar = app.name === "クエーさん";
                return <g key={app.name} transform={`translate(${x} ${y})`}>
                  {isQuasar && <rect x="-5" y="-5" width="52" height="66" rx="13" fill="white" fillOpacity="0.65" stroke="#d6473f" strokeWidth="2.5" />}
                  <rect width="42" height="42" rx="11" fill={app.color} />
                  {isQuasar ? <image href={appIcon.src} width="42" height="42" /> : <text x="21" y="29" textAnchor="middle" fontSize={index === 0 ? "23" : "25"} fontWeight="600" fill="#374151">{app.symbol}</text>}
                  <text x="21" y="55" textAnchor="middle" fontSize="8" fontWeight={isQuasar ? "700" : "500"} fill="#374151">{app.name}</text>
                </g>;
              })}
              <text x="110" y="132" fontSize="27">👆</text>
              <g fill="white"><circle cx="81" cy="219" r="2.5" /><circle cx="91" cy="219" r="2.5" opacity="0.5" /><circle cx="101" cy="219" r="2.5" opacity="0.5" /></g>
              <rect x="8" y="234" width="164" height="44" rx="16" fill="white" fillOpacity="0.5" />
              {[{ symbol: "☎", color: "#67ca8a" }, { symbol: "✉", color: "#69b4ed" }, { symbol: "♫", color: "#ee8e9a" }].map((app, index) => <g key={app.symbol} transform={`translate(${24 + index * 52} 240)`}><rect width="32" height="32" rx="9" fill={app.color} /><text x="16" y="23" textAnchor="middle" fontSize="23" fill="white">{app.symbol}</text></g>)}
            </svg>
  );
}

function FinishPreview() {

  return (
    <figure className="mt-6 rounded-3xl bg-brand-100 p-4">
      <figcaption className="mb-4 text-center text-sm font-bold text-brand-900">いつものホーム画面に、クエーさん。</figcaption>
      <div className="grid grid-cols-1 items-start justify-items-center gap-4 min-[360px]:grid-cols-2 min-[360px]:gap-2">
        <div className="min-w-0">
          <Phone>
            <HomeScreenPreview />
          </Phone>
          <p className="mt-3 text-center text-xs font-bold text-brand-900">ほかのアプリと並ぶ</p>
        </div>
        <div className="min-w-0"><Phone><SitePreview /></Phone><p className="mt-3 text-center text-xs font-bold text-brand-900">タップ → 起動！</p></div>
      </div>
      <p className="mt-4 text-center text-xs text-brand-800">LINEのリンクを探さず、投票・結果確認へ。</p>
    </figure>
  );
}

function Step({ number, title, label, children, hint }: { number: number; title: string; label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <li className="rounded-3xl bg-white p-4 shadow-sm">
      <h3 className="flex items-center gap-3 text-sm font-bold text-gray-900"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm text-white">{number}</span>{title}</h3>
      <figure className="mt-4"><Phone>{children}</Phone><figcaption className="sr-only">{label}</figcaption></figure>
      {hint && <p className="mt-3 text-center text-xs leading-6 text-gray-600">{hint}</p>}
    </li>
  );
}

export default function HomeScreenGuide() {
  return (
    <div className="min-h-screen pb-10">
      <header className="px-4 pb-6 pt-4">
        <Link href="/" className="inline-flex min-h-11 items-center text-sm font-bold text-brand-700">← 投票画面に戻る</Link>
        <h1 className="mt-4 text-2xl font-bold leading-relaxed text-gray-900">クエーさんを<br /><span className="text-brand-700">iOS/Androidアプリ</span>の<br />ように使う方法</h1>
        <FinishPreview />
        <nav aria-label="端末別の手順" className="mt-5 grid grid-cols-2 gap-3">
          <a href="#iphone" className="rounded-2xl bg-brand-700 px-3 py-4 text-center font-bold text-white">iPhone ↓</a>
          <a href="#android" className="rounded-2xl border border-brand-200 bg-white px-3 py-4 text-center font-bold text-brand-800">Android ↓</a>
        </nav>
      </header>

      <main className="space-y-8 px-4">
        <section id="iphone" className="scroll-mt-5" aria-labelledby="iphone-heading">
          <h2 id="iphone-heading" className="text-xl font-bold text-gray-900">iPhone <span className="text-sm font-normal text-gray-500">Safariで最初から解説</span></h2>
          <BrowserSetup device="iphone" />
          <p className="mt-4 text-center text-sm font-bold text-brand-900"><Link href="/" className="underline underline-offset-4">投票画面</Link>が開いたら、ホーム画面に追加 ↓</p>
          <ol start={4} className="mt-4 space-y-3">
            <Step number={4} title="「共有」をタップ" label="Safariの四角から上矢印が出た共有ボタンをタップ" hint="見当たらないときは「…」→「共有」">
              <SitePreview /><div className="flex items-center justify-around border-t border-gray-100 p-3 text-gray-400"><span>〈</span><span>〉</span><span className="rounded-lg border-2 border-accent-500 bg-accent-50 p-2 text-accent-700"><ShareIcon /></span><span>▢</span></div>
            </Step>
            <Step number={5} title="「ホーム画面に追加」をタップ" label="共有メニューをスクロールしてホーム画面に追加を選ぶ">
              <div className="bg-brand-50 px-3 py-4"><p className="text-xs font-bold text-brand-800">クエーさん</p><div className="mt-2 h-6 rounded-lg bg-white" /></div>
              <div className="rounded-t-2xl bg-gray-100 p-3">
                <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-gray-300" />
                <div className="mb-3 flex items-center gap-2"><Image src={appIcon} alt="" width={28} height={28} className="rounded-lg" /><span className="text-xs font-bold text-gray-700">クエーさんを共有</span></div>
                <p className="mb-3 text-center text-[11px] font-bold text-brand-700">↑ メニューを上に引き上げる</p>
                <div className="space-y-1 rounded-xl bg-white p-1 text-[11px]"><p className="flex justify-between px-3 py-2 text-gray-400"><span>コピー</span><span>▢</span></p><p className="flex justify-between px-3 py-2 text-gray-400"><span>ブックマークを追加</span><span>☆</span></p><Highlight><span>ホーム画面に追加 ⊞</span></Highlight></div>
              </div>
            </Step>
            <Step number={6} title="「追加」をタップして完了！" label="名前をクエーさんにして追加をタップ。Webアプリとして開くがあればオンにする" hint="「Webアプリとして開く」があればオンに。">
              <div className="flex items-center justify-between gap-1 px-3 py-3 text-[11px]"><span className="text-gray-400">キャンセル</span><span className="rounded-lg border-2 border-accent-500 bg-accent-50 px-3 py-2 font-bold text-accent-700">追加 ←</span></div>
              <div className="space-y-4 bg-gray-50 p-4"><p className="text-center text-xs font-bold text-gray-700">ホーム画面に追加</p><div className="flex items-center gap-3 rounded-xl bg-white p-3"><Image src={appIcon} alt="" width={38} height={38} className="rounded-xl" /><div><p className="text-[10px] text-gray-400">アイコンの名前</p><p className="mt-1 text-xs font-bold text-gray-800">クエーさん</p></div></div><div className="flex items-center justify-between gap-2 text-[10px]"><span>Webアプリとして開く</span><span className="flex w-10 justify-end rounded-full bg-brand-500 p-0.5"><span className="h-4 w-4 rounded-full bg-white shadow-sm" /></span></div><p className="text-center text-[11px] font-bold text-brand-700">名前を確認したら、右上の「追加」↑</p></div>
            </Step>
            <Step number={7} title="ホーム画面に追加できました！" label="スマホのホーム画面にクエーさんのアイコンが追加された状態" hint="ホーム画面に戻り、このアイコンをタップ。">
              <HomeScreenPreview />
            </Step>
          </ol>
        </section>

        <section id="android" className="scroll-mt-5" aria-labelledby="android-heading">
          <h2 id="android-heading" className="text-xl font-bold text-gray-900">Android <span className="text-sm font-normal text-gray-500">Chromeで最初から解説</span></h2>
          <BrowserSetup device="android" />
          <p className="mt-4 text-center text-sm font-bold text-brand-900"><Link href="/" className="underline underline-offset-4">投票画面</Link>が開いたら、ホーム画面に追加 ↓</p>
          <ol start={4} className="mt-4 space-y-3">
            <Step number={4} title="右上の「⋮」をタップ" label="Chromeのアドレス欄右側にあるメニューをタップ">
              <div className="flex items-center gap-2 px-3 py-2"><span className="flex-1 rounded-full bg-gray-100 px-3 py-2 text-[10px]">クエーさんのサイト</span><span className="rounded-lg border-2 border-accent-500 bg-accent-50 px-2 text-xl text-accent-700">⋮</span></div><SitePreview />
            </Step>
            <Step number={5} title="「ホーム画面に追加」をタップ" label="Chromeのメニューからホーム画面に追加を選ぶ" hint="「インストールしてショートカットを作成」の場合もあります。">
              <div className="flex items-center gap-2 bg-gray-50 px-3 py-2"><span className="flex-1 rounded-full bg-gray-200 px-2 py-2 text-[10px] text-gray-500">クエーさんのサイト</span><span className="text-xl text-gray-600">⋮</span></div>
              <div className="bg-brand-50 p-3"><div className="ml-3 space-y-1 rounded-xl border border-gray-200 bg-white p-2 text-[11px] shadow-md"><div className="flex justify-around border-b border-gray-100 py-2 text-base text-gray-400"><span>→</span><span>☆</span><span>↓</span><span>↻</span></div><p className="px-3 py-2 text-gray-400">履歴</p><p className="px-3 py-2 text-gray-400">ダウンロード</p><Highlight><span>ホーム画面に追加 ⊞</span></Highlight><p className="px-3 py-2 text-gray-400">設定</p></div></div>
            </Step>
            <Step number={6} title="「追加」をタップして完了！" label="ショートカットを作成し、名前をクエーさんにして追加" hint="「ショートカットを作成」や「インストール」が出たら選択。">
              <div className="bg-brand-100 px-3 py-6"><div className="space-y-4 rounded-2xl bg-white p-4 shadow-md"><p className="text-sm font-bold text-gray-800">ショートカットを作成</p><div className="flex items-center gap-3"><Image src={appIcon} alt="" width={38} height={38} className="rounded-xl" /><div className="min-w-0 flex-1 border-b-2 border-blue-400 pb-1"><p className="text-[10px] text-gray-400">名前</p><p className="mt-1 text-xs font-bold text-gray-800">クエーさん</p></div></div><div className="flex items-center justify-end gap-3 pt-2 text-[10px]"><span className="text-gray-400">キャンセル</span><span className="rounded-lg border-2 border-accent-500 bg-accent-50 px-3 py-2 font-bold text-accent-700">追加 ←</span></div></div><p className="mt-4 text-center text-[11px] font-bold text-brand-800">確認がもう一度出たら「追加」</p></div>
            </Step>
            <Step number={7} title="ホーム画面に追加できました！" label="スマホのホーム画面にクエーさんのアイコンが追加された状態" hint="ホーム画面に戻り、このアイコンをタップ。">
              <HomeScreenPreview />
            </Step>
          </ol>
        </section>

        <footer className="space-y-3 text-xs leading-6 text-gray-500">
          <p className="text-center">図はイメージです。端末によって表示が異なります。</p>
          <details className="px-1"><summary className="cursor-pointer">公式の操作ガイド</summary><p className="mt-2"><a href="https://support.apple.com/ja-jp/guide/iphone/iphea86e5236/ios" target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Apple（iPhone）</a> ／ <a href="https://support.google.com/chrome/answer/15085120?hl=ja&co=GENIE.Platform%3DAndroid" target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Google（Android）</a></p></details>
          <Link href="/" className="flex min-h-12 items-center justify-center rounded-xl border border-brand-200 bg-white text-sm font-bold text-brand-700">投票画面に戻る</Link>
        </footer>
      </main>
    </div>
  );
}
