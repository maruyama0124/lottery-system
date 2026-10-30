// 代表用管理画面 — 管理画面もモバイルファースト (D-009) + 下部タブバー
// theme-admin で brand/accent の色をミカサ配色 (黄・青) に差し替える (D-023)
import { AdminTabBar } from "@/components/admin/tab-bar";
import { AdminGenderProvider } from "@/components/admin/gender-scope";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-admin mx-auto min-h-screen w-full max-w-[480px] bg-white pb-20">
      <AdminGenderProvider>{children}</AdminGenderProvider>
      <AdminTabBar />
    </div>
  );
}
