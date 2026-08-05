// BFF メールアドレス確認 — 確認と同時に JWT を受け取り、ログイン状態にする (D-014)
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { BACKEND_URL } from "@/lib/auth/dal";

export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch(`${BACKEND_URL}/api/v1/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: { code: "INVALID_CODE", message: "確認に失敗しました" } }));
    return NextResponse.json(err, { status: res.status });
  }
  const data = await res.json(); // { access_token, token_type, expires_in }

  const meRes = await fetch(`${BACKEND_URL}/api/v1/users/me`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
    cache: "no-store",
  });
  const user = await meRes.json();

  const store = await cookies();
  store.set("access_token", data.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: data.expires_in,
  });
  return NextResponse.json(user);
}
