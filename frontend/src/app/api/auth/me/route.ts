// BFF 現在セッション取得 — Cookie のトークンでバックエンドの /users/me を返す
import { NextResponse } from "next/server";
import { fetchSessionUser } from "@/lib/auth/dal";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  let res: Response | null;
  try { res = await fetchSessionUser(); } catch {
    return NextResponse.json({ error: { message: "ログイン状態を確認できませんでした" } }, { status: 502, headers });
  }
  if (res && !res.ok && res.status !== 401 && res.status !== 403) {
    return NextResponse.json({ error: { message: "ログイン状態を確認できませんでした" } }, { status: 502, headers });
  }
  if (!res || !res.ok) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未ログインです" } },
      { status: 401, headers },
    );
  }
  return NextResponse.json(await res.json(), { headers });
}
