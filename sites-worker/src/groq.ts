import type { Env } from "./db";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Calls the Groq API; waits once for a rate limit (up to 20s) before giving up. */
export async function groqFetch(path: string, env: Env, init: RequestInit, retries = 1): Promise<Response> {
  if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is unavailable.");
  const headers = new Headers(init.headers || {});
  headers.set("authorization", `Bearer ${env.GROQ_API_KEY}`);
  const response = await fetch(`https://api.groq.com/openai/v1${path}`, { ...init, headers });
  if (!response.ok) {
    let detail = "";
    try { const payload = await response.clone().json() as { error?: { message?: string } }; detail = String(payload?.error?.message || "").slice(0, 240); } catch { /* ignore */ }
    if (response.status === 429 && retries > 0 && init.body && !(init.body instanceof FormData)) {
      const wait = Number(detail.match(/try again in ([\d.]+)s/i)?.[1] ?? response.headers.get("retry-after") ?? 8);
      if (Number.isFinite(wait) && wait <= 20) { await sleep(wait * 1000 + 300); return groqFetch(path, env, init, retries - 1); }
    }
    throw new Error(`Groq API ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response;
}
