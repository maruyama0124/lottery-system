"use client";

// 名簿画面（代表のみ） — ui-design/snippets/admin-roster-mobile.html 準拠
import { useEffect, useMemo, useState } from "react";
import { AdminHeader } from "@/components/admin/header";
import { ErrorMessage } from "@/components/ui/error-message";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  SearchIcon,
} from "@/components/ui/icons";
import { Loading } from "@/components/ui/loading";
import { useApi } from "@/hooks/use-api";
import { useRequireRepresentative } from "@/hooks/use-auth";
import type { RosterPage, UserProfile } from "@/types/api";

type Filter = "all" | "male" | "female" | "grade1" | "grade2" | "grade3" | "manager";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全員" },
  { key: "male", label: "男子" },
  { key: "female", label: "女子" },
  { key: "grade1", label: "1年" },
  { key: "grade2", label: "2年" },
  { key: "grade3", label: "3年" },
  { key: "manager", label: "マネ" },
];

function buildFilterParams(filter: Filter, query: string): URLSearchParams {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  switch (filter) {
    case "male":
    case "female":
      params.set("gender", filter);
      break;
    case "grade1":
      params.set("grade", "1");
      break;
    case "grade2":
      params.set("grade", "2");
      break;
    case "grade3":
      params.set("grade", "3");
      break;
    case "manager":
      params.set("is_manager", "true");
      break;
    case "all":
      break;
  }
  return params;
}

function MemberCard({ user }: { user: UserProfile }) {
  const [open, setOpen] = useState(false);
  const genderBadge =
    user.gender === "male"
      ? { label: "男子", className: "bg-blue-100 text-blue-700" }
      : { label: "女子", className: "bg-pink-100 text-pink-700" };

  const details: { label: string; value: string }[] = [
    { label: "メール", value: user.email },
    { label: "電話", value: user.phone_number },
    { label: "住所", value: user.address },
    { label: "学部学科", value: user.faculty_department },
    { label: "学籍番号", value: user.student_number },
    { label: "区分", value: user.is_manager ? "マネージャー" : "プレイヤー" },
    { label: "権限", value: user.role === "representative" ? "代表" : "メンバー" },
  ];

  return (
    <div
      className={`overflow-hidden rounded-xl shadow-sm ${
        open ? "border border-brand-200" : "border border-gray-200"
      }`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between px-4 py-3 ${open ? "bg-brand-50" : "bg-white"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900">{user.name}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${genderBadge.className}`}
          >
            {genderBadge.label}
          </span>
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">
            {user.grade}年
          </span>
          {user.is_manager && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              マネ
            </span>
          )}
        </div>
        <span className="shrink-0 text-gray-400">
          {open ? (
            <ChevronDownIcon width={18} height={18} />
          ) : (
            <ChevronRightIcon width={18} height={18} />
          )}
        </span>
      </button>
      {open && (
        <dl className="divide-y divide-gray-100 bg-white px-4 py-1 text-sm">
          {details.map((d) => (
            <div key={d.label} className="flex py-2">
              <dt className="w-24 shrink-0 text-gray-500">{d.label}</dt>
              <dd className="break-all text-gray-900">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default function AdminRosterPage() {
  const { user, isLoading: authLoading } = useRequireRepresentative();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // 検索入力から300msデバウンス
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filterQuery = useMemo(
    () => buildFilterParams(filter, debouncedSearch).toString(),
    [filter, debouncedSearch],
  );

  const listQuery = useMemo(() => {
    const params = buildFilterParams(filter, debouncedSearch);
    params.set("per_page", "200");
    return params.toString();
  }, [filter, debouncedSearch]);

  const {
    data: roster,
    error,
    isLoading,
    mutate,
  } = useApi<RosterPage>(user ? `/v1/users?${listQuery}` : null);

  const handleCsvExport = () => {
    window.open(`/api/v1/users/export?${filterQuery}`, "_blank");
  };

  if (authLoading || !user) {
    return <Loading />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative">
        <AdminHeader title="名簿" />
        <button
          onClick={handleCsvExport}
          className="absolute top-1/2 right-4 z-50 inline-flex -translate-y-1/2 items-center gap-1 rounded-lg border border-brand-600 px-3 py-1.5 text-sm font-semibold text-brand-600 hover:bg-brand-50"
        >
          CSV
          <DownloadIcon width={16} height={16} />
        </button>
      </div>

      <main className="flex-1 space-y-4 px-4 py-4">
        {/* 検索バー */}
        <div className="relative">
          <span className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400">
            <SearchIcon width={16} height={16} />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="名前・学籍番号で検索"
            className="w-full rounded-xl bg-gray-100 py-2.5 pr-4 pl-10 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-brand-600 focus:outline-none"
          />
        </div>

        {/* フィルタチップ */}
        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
          style={{ scrollbarWidth: "none" }}
        >
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm ${
                filter === f.key
                  ? "bg-brand-600 font-semibold text-white"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <ErrorMessage message="名簿の取得に失敗しました" onRetry={() => mutate()} />
        )}
        {isLoading && <Loading />}

        {roster && (
          <>
            <div className="space-y-3">
              {roster.items.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  該当するメンバーがいません
                </p>
              ) : (
                roster.items.map((member) => (
                  <MemberCard key={member.id} user={member} />
                ))
              )}
            </div>
            <p className="pt-2 text-center text-xs text-gray-400">
              {roster.total}名中 {roster.items.length}名を表示
            </p>
          </>
        )}
      </main>
    </div>
  );
}
