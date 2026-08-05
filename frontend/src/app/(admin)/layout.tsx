// 代表用管理画面 — 管理画面もモバイルファースト (D-009) + 下部タブバー
import { AdminTabBar } from "@/components/admin/tab-bar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[480px] bg-white pb-20">
      {children}
      <AdminTabBar />
    </div>
  );
}
