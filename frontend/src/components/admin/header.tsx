"use client";

import { useAuth } from "@/lib/auth-context";

export function AdminHeader({ title }: { title: string }) {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white px-4 py-3">
      <div className="flex items-center gap-2">
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
    </header>
  );
}
