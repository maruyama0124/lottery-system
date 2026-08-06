// BFF LINE 初回登録 (D-021)
// 本名・学年・性別を受け取って会員を作成し、そのままログイン状態にする。
// ID トークンはバックエンド側で再度検証されるため、ここでは中継するだけでよい。
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { BACKEND_URL } from "@/lib/auth/dal";

export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch(`${BACKEND_URL}/api/v1/auth/line/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: { code: "VALIDATION_ERROR", message: "登録に失敗しました" } }));
    return NextResponse.json(err, { status: res.status });
  }
  const token = await res.json(); // { access_token, token_type, expires_in }

  const meRes = await fetch(`${BACKEND_URL}/api/v1/users/me`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  });
  const user = await meRes.json();

  const store = await cookies();
  store.set("access_token", token.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: token.expires_in,
  });
  return NextResponse.json(user);
}
