"use client";

// メンバー画面共通の下部タブバー (画面設計書 §3)
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheckIcon,
  HouseIcon,
  UserIcon,
  VoteIcon,
} from "@/components/ui/icons";

const tabs = [
  { href: "/", label: "ホーム", Icon: HouseIcon },
  { href: "/vote", label: "投票", Icon: VoteIcon },
  { href: "/results", label: "結果", Icon: CalendarCheckIcon },
  { href: "/profile", label: "プロフィール", Icon: UserIcon },
];

export function MemberTabBar() {
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
