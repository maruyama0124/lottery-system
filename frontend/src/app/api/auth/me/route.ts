// BFF 現在セッション取得 — Cookie のトークンでバックエンドの /users/me を返す
import { NextResponse } from "next/server";
import { fetchSessionUser } from "@/lib/auth/dal";

export async function GET() {
  const res = await fetchSessionUser();
  if (!res || !res.ok) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未ログインです" } },
      { status: 401 },
    );
  }
  return NextResponse.json(await res.json());
}
