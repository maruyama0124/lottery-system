import { BACKEND_URL, getValidAccessToken } from "@/lib/auth/dal";
import { loadMemberHome } from "@/lib/member-home";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const gender = params.get("gender");
  const monthId = params.get("month");
  if ((gender !== "male" && gender !== "female") || (monthId && !/^[a-zA-Z0-9_-]{1,80}$/.test(monthId))) {
    return Response.json({ error: { message: "対象の性別・月が不正です" } }, { status: 400, headers });
  }
  const token = await getValidAccessToken();
  if (!token) return Response.json({ error: { message: "再ログインしてください" } }, { status: 401, headers });
  const started = performance.now();
  let requests = 0;
  try {
    const data = await loadMemberHome(async <T,>(path: string): Promise<T> => {
      requests++;
      const res = await fetch(`${BACKEND_URL}/api${path}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw res;
      return res.json();
    }, gender, monthId);
    return Response.json(data, { headers });
  } catch (error) {
    const status = error instanceof Response ? error.status : 502;
    return Response.json({ error: { message: status === 401 ? "再ログインしてください" : "練習情報を取得できませんでした" } }, { status, headers });
  } finally {
    console.info("[timing] member_home", { backendRequests: requests, totalMs: Math.round(performance.now() - started) });
  }
}
