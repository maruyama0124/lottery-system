// 未ログイン時のリダイレクト (Next.js 16 proxy.ts convention)
// Cookie の有無のみ軽量チェックする。有効性検証は DAL / バックエンド側
import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (!request.cookies.has("access_token")) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/vote", "/results", "/profile", "/admin/:path*", "/admin"],
};
