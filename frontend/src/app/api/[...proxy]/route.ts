// BFF 透過プロキシ — /api/v1/* を access_token Cookie を Bearer に載せ替えてバックエンドへ中継
import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL, getValidAccessToken } from "@/lib/auth/dal";

async function forward(req: NextRequest, path: string[]) {
  const token = await getValidAccessToken();
  const url = `${BACKEND_URL}/api/${path.join("/")}${req.nextUrl.search}`;

  const res = await fetch(url, {
    method: req.method,
    headers: {
      "Content-Type": req.headers.get("content-type") ?? "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text(),
    cache: "no-store",
  });

  const headers: Record<string, string> = {
    "Content-Type": res.headers.get("content-type") ?? "application/json",
  };
  // CSVダウンロード等の Content-Disposition を透過する
  const disposition = res.headers.get("content-disposition");
  if (disposition) headers["Content-Disposition"] = disposition;

  // 204/205/304 はボディを持てない (Response 構築が TypeError になる)
  if ([204, 205, 304].includes(res.status)) {
    return new NextResponse(null, { status: res.status });
  }
  const body = await res.arrayBuffer();
  return new NextResponse(body, { status: res.status, headers });
}

type Ctx = { params: Promise<{ proxy: string[] }> };

export const GET = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.proxy));
export const POST = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.proxy));
export const PUT = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.proxy));
export const DELETE = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.proxy));
