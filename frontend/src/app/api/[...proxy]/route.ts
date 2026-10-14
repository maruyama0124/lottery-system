// BFF 透過プロキシ — /api/v1/* を access_token Cookie を Bearer に載せ替えてバックエンドへ中継
import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL, getValidAccessToken } from "@/lib/auth/dal";

async function forward(req: NextRequest, path: string[]) {
  // 微調整・一括保存を計測する。ID・クエリ・認証情報はログに含めない。
  const route = path.join("/");
  const operation =
    req.method === "PUT" && /^v1\/practice-months\/[^/]+\/assignments$/.test(route)
      ? "save_assignments"
      : req.method === "POST" && /^v1\/practices\/[^/]+\/assignments$/.test(route)
      ? "add_assignment"
      : req.method === "DELETE" && /^v1\/assignments\/[^/]+$/.test(route)
        ? "remove_assignment"
        : req.method === "GET" && /^v1\/practice-months\/[^/]+\/results$/.test(route)
          ? "full_results"
          : null;
  const startedAt = performance.now();
  let preparationMs: number | null = null;
  let backendWaitMs: number | null = null;
  let backendBodyMs: number | null = null;
  let status: number | null = null;
  let completed = false;

  try {
    const token = await getValidAccessToken();
    const url = `${BACKEND_URL}/api/${route}${req.nextUrl.search}`;
    const requestBody = ["GET", "HEAD"].includes(req.method) ? undefined : await req.text();
    preparationMs = performance.now() - startedAt;

    // Cookie処理とリクエスト本文の読み取りを、バックエンドの応答待ちに含めない。
    const backendStartedAt = performance.now();
    const res = await fetch(url, {
      method: req.method,
      headers: {
        "Content-Type": req.headers.get("content-type") ?? "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: requestBody,
      cache: "no-store",
    });
    backendWaitMs = performance.now() - backendStartedAt;
    status = res.status;

    const headers: Record<string, string> = {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
    };
    // CSVダウンロード等の Content-Disposition を透過する
    const disposition = res.headers.get("content-disposition");
    if (disposition) headers["Content-Disposition"] = disposition;

    // 204/205/304 はボディを持てない (Response 構築が TypeError になる)
    if ([204, 205, 304].includes(res.status)) {
      backendBodyMs = 0;
      const response = new NextResponse(null, { status: res.status });
      completed = true;
      return response;
    }
    const bodyStartedAt = performance.now();
    const body = await res.arrayBuffer();
    backendBodyMs = performance.now() - bodyStartedAt;
    const response = new NextResponse(body, { status: res.status, headers });
    completed = true;
    return response;
  } finally {
    if (operation) {
      const roundMs = (value: number | null) => value === null ? null : Math.round(value * 10) / 10;
      console.info("[timing] bff", {
        operation,
        method: req.method,
        status,
        completed,
        preparationMs: roundMs(preparationMs),
        backendWaitMs: roundMs(backendWaitMs),
        backendBodyMs: roundMs(backendBodyMs),
        totalMs: roundMs(performance.now() - startedAt),
      });
    }
  }
}

type Ctx = { params: Promise<{ proxy: string[] }> };

export const GET = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.proxy));
export const POST = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.proxy));
export const PUT = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.proxy));
export const DELETE = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.proxy));
