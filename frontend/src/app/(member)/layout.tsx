// メンバー画面 — モバイルファースト (max-w 480px) + 下部タブバー
import { MemberTabBar } from "@/components/member/tab-bar";

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[480px] bg-white pb-20">
      {children}
      <MemberTabBar />
    </div>
  );
}
