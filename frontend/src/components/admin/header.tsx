"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { VoteIcon } from "@/components/ui/icons";

export function AdminHeader({ title }: { title: string }) {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <h1 className="text-base font-bold text-gray-900">{title}</h1>
        <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
          管理
        </span>
        {user && (
          <span className="text-xs text-gray-500">
            {user.gender === "male" ? "男子" : "女子"}
          </span>
        )}
        </div>
        {user?.role === "representative" && (
          <Link href="/" className="inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-200 px-2 text-xs font-bold text-brand-700 hover:bg-brand-50">
            <VoteIcon width={16} height={16} aria-hidden="true" />
            投票画面へ
          </Link>
        )}
      </div>
    </header>
  );
}
