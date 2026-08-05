"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { VolleyballIcon } from "@/components/ui/icons";
import type { RegisterRequest, UserProfile } from "@/types/api";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600";
const selectClass =
  "w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [grade, setGrade] = useState("1");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [facultyDepartment, setFacultyDepartment] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [isManager, setIsManager] = useState("false");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < 8) {
      setErrorMessage("パスワードは8文字以上で入力してください");
      return;
    }
    if (password !== passwordConfirm) {
      setErrorMessage("パスワードが一致しません。確認欄をもう一度入力してください");
      return;
    }

    setIsSubmitting(true);
    const body: RegisterRequest = {
      email,
      password,
      name,
      address,
      phone_number: phoneNumber,
      grade: Number(grade),
      gender,
      faculty_department: facultyDepartment,
      student_number: studentNumber,
      is_manager: isManager === "true",
    };

    try {
      await apiClient.post<UserProfile>("/v1/auth/register", body);
      // 登録直後はメール未確認でログインできない (D-011)。確認コード入力画面へ
      router.push(`/verify?email=${encodeURIComponent(email)}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 400 && err.error.details && err.error.details.length > 0) {
          const detailText = err.error.details
            .map((d) => `${d.field}: ${d.reason}`)
            .join(" / ");
          setErrorMessage(`${err.error.message}（${detailText}）`);
        } else {
          setErrorMessage(err.error.message);
        }
      } else {
        setErrorMessage(err instanceof Error ? err.message : "登録に失敗しました");
      }
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white px-6 py-10">
      {/* ロゴ・タイトル */}
      <div className="mb-8 text-center">
        <div className="mb-3 flex justify-center text-brand-600">
          <VolleyballIcon width={48} height={48} />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">新規登録</h1>
        <p className="mt-2 text-sm text-gray-500">プロフィールは抽選と連絡に使用されます</p>
      </div>

      {errorMessage && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-600">{errorMessage}</p>
        </div>
      )}

      {/* 登録フォーム */}
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
            メールアドレス <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            id="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="hanako.suzuki@example.ac.jp"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
            パスワード <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            id="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500">8文字以上で入力してください</p>
        </div>

        <div>
          <label
            htmlFor="password-confirm"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            パスワード（確認） <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            id="password-confirm"
            required
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
          {passwordConfirm.length > 0 && password !== passwordConfirm && (
            <p className="mt-1 text-xs text-red-600">パスワードが一致しません</p>
          )}
        </div>

        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
            名前 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="鈴木 花子"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="address" className="mb-1 block text-sm font-medium text-gray-700">
            住所 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="address"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="東京都八王子市南大沢1-1-1 コーポ南大沢203"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium text-gray-700">
            電話番号 <span className="text-red-500">*</span>
          </label>
          <input
            type="tel"
            id="phone"
            required
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="090-1234-5678"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="grade" className="mb-1 block text-sm font-medium text-gray-700">
            学年 <span className="text-red-500">*</span>
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
          </select>
        </div>

        <div>
          <label htmlFor="gender" className="mb-1 block text-sm font-medium text-gray-700">
            性別 <span className="text-red-500">*</span>
          </label>
          <select
            id="gender"
            value={gender}
            onChange={(e) => setGender(e.target.value as "male" | "female")}
            className={selectClass}
          >
            <option value="male">男</option>
            <option value="female">女</option>
          </select>
        </div>

        <div>
          <label htmlFor="faculty" className="mb-1 block text-sm font-medium text-gray-700">
            学部学科 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="faculty"
            required
            value={facultyDepartment}
            onChange={(e) => setFacultyDepartment(e.target.value)}
            placeholder="経済学部 経済学科"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="student-id" className="mb-1 block text-sm font-medium text-gray-700">
            学籍番号 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="student-id"
            required
            value={studentNumber}
            onChange={(e) => setStudentNumber(e.target.value)}
            placeholder="24E1234"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="role" className="mb-1 block text-sm font-medium text-gray-700">
            マネージャーかどうか <span className="text-red-500">*</span>
          </label>
          <select
            id="role"
            value={isManager}
            onChange={(e) => setIsManager(e.target.value)}
            className={selectClass}
          >
            <option value="false">プレイヤー</option>
            <option value="true">マネージャー</option>
          </select>
        </div>

        <div className="pb-6 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="h-12 w-full rounded-lg bg-brand-600 font-bold text-white transition-colors hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50"
          >
            {isSubmitting ? "登録中..." : "登録する"}
          </button>
          <p className="mt-4 text-center">
            <Link href="/login" className="text-sm text-brand-600 hover:underline">
              すでにアカウントをお持ちの方はこちら
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
