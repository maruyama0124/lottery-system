"use client";

// 代表用管理画面の下部タブバー — 管理画面もモバイルファースト (D-009)
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDaysIcon,
  ClipboardListIcon,
  DicesIcon,
  HouseIcon,
  UsersIcon,
} from "@/components/ui/icons";

const tabs = [
  { href: "/admin", label: "ホーム", Icon: HouseIcon },
  { href: "/admin/schedule", label: "日程", Icon: CalendarDaysIcon },
  { href: "/admin/lottery", label: "抽選", Icon: DicesIcon },
  { href: "/admin/results", label: "結果", Icon: ClipboardListIcon },
  { href: "/admin/roster", label: "名簿", Icon: UsersIcon },
];

export function AdminTabBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-1/2 z-50 w-full max-w-[480px] -translate-x-1/2 border-t border-gray-200 bg-white">
      <div className="flex">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${
                active ? "text-brand-600" : "text-gray-400"
              }`}
            >
              <Icon width={22} height={22} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
