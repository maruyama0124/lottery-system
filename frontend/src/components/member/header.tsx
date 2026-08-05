"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { SettingsIcon } from "@/components/ui/icons";

export function MemberHeader({ title }: { title: string }) {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
      <h1 className="text-base font-bold text-gray-900">{title}</h1>
      {/* 代表は自分も投票するためメンバー画面を使う。管理画面へ戻る導線を出す */}
      {user?.role === "representative" && (
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 rounded-lg border border-brand-600 px-2.5 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50"
        >
          <SettingsIcon width={14} height={14} />
          管理画面
        </Link>
      )}
    </header>
  );
}
