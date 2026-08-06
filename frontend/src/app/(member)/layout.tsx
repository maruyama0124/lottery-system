// メンバー画面 — モバイルファースト。画面は1枚だけなのでタブバーは持たない (D-022)
export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[480px] bg-brand-50">
      {children}
    </div>
  );
}
