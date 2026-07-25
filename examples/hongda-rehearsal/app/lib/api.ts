/**
 * Minimal fetch wrapper. Points at the local mock route by default;
 * set NEXT_PUBLIC_API_BASE to switch the whole demo to a real backend.
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE || "/api/mock";

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path.startsWith("/") ? path : `/${path}`}`, {
    cache: "no-store",
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}: ${path}`);
  return res.json() as Promise<T>;
}
