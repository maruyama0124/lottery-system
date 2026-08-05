// Data Access Layer — Server only
// バックエンドの JWT はリフレッシュトークンなし (有効期限30日) のため refresh フローは持たない
import "server-only";
import { cookies } from "next/headers";

const BACKEND_URL = process.env.API_URL ?? "http://localhost:8010";

function decodeJwt<T = unknown>(token: string): T | null {
  try {
    const [, payload] = token.split(".");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function getValidAccessToken(): Promise<string | null> {
  const store = await cookies();
  const token = store.get("access_token")?.value;
  if (!token) return null;
  const payload = decodeJwt<{ exp?: number }>(token);
  if (!payload?.exp || Date.now() >= payload.exp * 1000) return null;
  return token;
}

export async function fetchSessionUser(): Promise<Response | null> {
  const token = await getValidAccessToken();
  if (!token) return null;
  return fetch(`${BACKEND_URL}/api/v1/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
}

export { BACKEND_URL };
