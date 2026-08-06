// BFF LINE ログイン (D-021)
// LIFF から受け取った ID トークンをバックエンドへ渡し、検証結果に応じて Cookie を張る。
// 未登録の場合はトークンが返らないため、registered: false をそのまま返して
// フロント側で初回登録フォームへ進ませる。
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { BACKEND_URL } from "@/lib/auth/dal";

export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch(`${BACKEND_URL}/api/v1/auth/line/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: { code: "UNAUTHORIZED", message: "LINE の認証に失敗しました" } }));
    return NextResponse.json(err, { status: res.status });
  }

  const data = await res.json(); // { registered, token, display_name }
  if (!data.registered) {
    return NextResponse.json({ registered: false, display_name: data.display_name });
  }

  const meRes = await fetch(`${BACKEND_URL}/api/v1/users/me`, {
    headers: { Authorization: `Bearer ${data.token.access_token}` },
    cache: "no-store",
  });
  const user = await meRes.json();

  const store = await cookies();
  store.set("access_token", data.token.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: data.token.expires_in,
  });
  return NextResponse.json({ registered: true, user });
}
