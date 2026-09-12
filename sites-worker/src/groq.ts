import type { Env } from "./db";
import { AppError } from './errors';

/** Calls the Groq API; waits once for a rate limit (up to 20s) before giving up. */
export async function groqFetch(path: string, env: Env, init: RequestInit, retries = 1): Promise<Response> {
  if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is unavailable.");
  return apiFetch(`https://api.groq.com/openai/v1${path}`, env.GROQ_API_KEY, init, retries);
}

/** POSTs to any OpenAI-compatible endpoint, waiting out one rate limit. */
export async function apiFetch(url: string, apiKey: string, init: RequestInit, retries = 1): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set("authorization", `Bearer ${apiKey}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    if (url.startsWith('https://api.openai.com/v1/')) {
      const body = await response.json().catch(() => null) as {error?: {code?: unknown; type?: unknown}} | null;
      // The live API may put insufficient_quota in type rather than code.
      if (body?.error?.type === 'insufficient_quota' || ['insufficient_quota','credit_balance_exhausted','billing_hard_limit_reached'].includes(String(body?.error?.code))) {
        throw new AppError('openai_billing_required', 402, 'OpenAI API billing or quota needs attention. Check the API account balance and limits; creating a key does not add credits.');
      }
    }
    // Inspect only an allow-listed code. Never expose an upstream message,
    // which can echo prompts or credentials, and never accept terms for a user.
    if (response.status === 400 && url === 'https://api.groq.com/openai/v1/audio/speech') {
      const body = await response.json().catch(() => null) as {error?: {code?: unknown}} | null;
      if (body?.error?.code === 'model_terms_required') throw new AppError('voice_terms_required', 403,
        'The Groq account owner must review and accept the Orpheus voice model terms in Groq Console, then test the voice again.');
    }
    const detail = ""; // Never expose or log upstream content (may echo prompts/secrets).
    if (response.status === 429 && retries > 0 && init.body && !(init.body instanceof FormData)) {
      const wait = Number(detail.match(/try again in ([\d.]+)s/i)?.[1] ?? response.headers.get("retry-after") ?? 8);
      if (Number.isFinite(wait) && wait <= 10 && !init.signal?.aborted) { await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,wait*1000+300);init.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));},{once:true});}); return apiFetch(url, apiKey, init, retries - 1); }
    }
    if (response.status === 400 || response.status === 404 || response.status === 422) throw new AppError('provider_request_invalid', 502, 'The AI provider rejected the request configuration. This is an integration error, not a credit-balance message.');
    if (response.status === 401 || response.status === 403) throw new AppError('provider_auth_failed', 502, 'The AI provider rejected API access. Check the server configuration.');
    if (response.status === 429) throw new AppError('provider_rate_limited', 429, 'The AI provider is temporarily rate-limiting requests. Please try again shortly.');
    throw new AppError('provider_unavailable', 503, 'The AI provider could not complete the request. Please retry.');
  }
  return response;
}
