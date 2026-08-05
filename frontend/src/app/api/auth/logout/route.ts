// BFF ログアウト — Cookie を削除する (JWT はステートレス)
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const store = await cookies();
  store.delete("access_token");
  return NextResponse.json({ ok: true });
}
