"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useAuth, useRequireAuth } from "@/hooks/use-auth";
import { MemberHeader } from "@/components/member/header";
import { Loading } from "@/components/ui/loading";
import { ErrorMessage } from "@/components/ui/error-message";
import type { UserProfile, UserUpdateRequest } from "@/types/api";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600";
const selectClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600";
const readonlyClass =
  "w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2.5 text-sm text-gray-500";

function ProfileForm({
  profile,
  onSaved,
}: {
  profile: UserProfile;
  onSaved: (updated: UserProfile) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [address, setAddress] = useState(profile.address);
  const [phoneNumber, setPhoneNumber] = useState(profile.phone_number);
  const [grade, setGrade] = useState(String(profile.grade));
  const [facultyDepartment, setFacultyDepartment] = useState(profile.faculty_department);
  const [studentNumber, setStudentNumber] = useState(profile.student_number);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaveError(null);
    setSuccessMessage(null);
    setIsSaving(true);
    const body: UserUpdateRequest = {
      name,
      address,
      phone_number: phoneNumber,
      grade: Number(grade),
      faculty_department: facultyDepartment,
      student_number: studentNumber,
    };
    try {
      const updated = await apiClient.put<UserProfile>("/v1/users/me", body);
      onSaved(updated);
      setSuccessMessage("プロフィールを保存しました");
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSaveError(err.error.message);
      } else {
        setSaveError(err instanceof Error ? err.message : "保存に失敗しました");
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {successMessage && (
        <div className="mb-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-700">{successMessage}</p>
        </div>
      )}
      {saveError && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-600">{saveError}</p>
        </div>
      )}

      <form className="space-y-5" onSubmit={handleSubmit}>
        {/* メールアドレス（編集不可） */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">メールアドレス</label>
          <div className={readonlyClass}>{profile.email}</div>
          <p className="mt-1 text-xs text-gray-400">メールアドレスは変更できません</p>
        </div>

        {/* 名前 */}
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
            名前
          </label>
          <input
            type="text"
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* 住所 */}
        <div>
          <label htmlFor="address" className="mb-1 block text-sm font-medium text-gray-700">
            住所
          </label>
          <input
            type="text"
            id="address"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* 電話番号 */}
        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium text-gray-700">
            電話番号
          </label>
          <input
            type="tel"
            id="phone"
            required
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* 学年 */}
        <div>
          <label htmlFor="grade" className="mb-1 block text-sm font-medium text-gray-700">
            学年
          </label>
          <select
            id="grade"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className={selectClass}
          >
            <option value="1">1年</option>
            <option value="2">2年</option>
            <option value="3">3年</option>
            <option value="4">4年</option>
          </select>
        </div>

        {/* 学部学科 */}
        <div>
          <label htmlFor="faculty" className="mb-1 block text-sm font-medium text-gray-700">
            学部学科
          </label>
          <input
            type="text"
            id="faculty"
            required
            value={facultyDepartment}
            onChange={(e) => setFacultyDepartment(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* 学籍番号 */}
        <div>
          <label htmlFor="student-id" className="mb-1 block text-sm font-medium text-gray-700">
            学籍番号
          </label>
          <input
            type="text"
            id="student-id"
            required
            value={studentNumber}
            onChange={(e) => setStudentNumber(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* マネージャー区分（表示のみ） */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">マネージャー区分</label>
          <div className={readonlyClass}>{profile.is_manager ? "マネージャー" : "プレイヤー"}</div>
        </div>

        {/* 保存ボタン */}
        <button
          type="submit"
          disabled={isSaving}
          className="w-full rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {isSaving ? "保存中..." : "保存する"}
        </button>
      </form>
    </>
  );
}

export default function ProfilePage() {
  const { isLoading: isAuthLoading } = useRequireAuth();
  const { logout } = useAuth();
  const router = useRouter();
  const { data, error, isLoading, mutate } = useApi<UserProfile>("/v1/users/me");

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <>
      <MemberHeader title="プロフィール" />
      <main className="px-4 py-5">
        {isAuthLoading || isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorMessage message={error.error.message} onRetry={() => mutate()} />
        ) : data ? (
          <>
            <ProfileForm
              profile={data}
              onSaved={(updated) => mutate(updated, { revalidate: false })}
            />

            {/* ログアウト */}
            <div className="mt-8 border-t border-gray-200 pt-6">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full rounded-lg border border-red-500 bg-white py-3 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                ログアウト
              </button>
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}
