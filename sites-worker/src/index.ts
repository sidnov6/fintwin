/**
 * FinTwin worker — API and static asset host.
 * Signed-in viewer identity arrives via the platform's oai-authenticated-* headers.
 */
import { sampleFacts } from "@fintwin/engine";
import type { Card, Message } from "@fintwin/contracts";
import { addNextStep, deleteFacts, deleteMessage, deleteNextStep, listMessages, resetUser, saveMessage, setFacts, setNextStepDone, upsertProfile, type Env } from "./db";
import { aiInfo, buildState } from "./state";
import { greeting, handleChat } from "./chat";
import { synthesize, transcribe } from "./voice";
import { isFactKey } from "@fintwin/engine";

interface Viewer { userId: string; email: string; fullName: string }

function viewerFromRequest(request: Request): Viewer | null {
  const platformId = request.headers.get("oai-authenticated-user-id");
  // The platform's signed-in user always wins; a device id is only a fallback.
  const device = request.headers.get("x-fintwin-device");
  const userId = platformId || (device && /^[a-f0-9-]{36}$/.test(device) ? `device:${device}` : null);
  const email = request.headers.get("oai-authenticated-user-email") || "";
  let fullName = "";
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (encoded && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") try { fullName = decodeURIComponent(encoded); } catch { fullName = ""; }
  return userId ? { userId, email: platformId ? email : "", fullName: platformId ? fullName : "" } : null;
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type,x-fintwin-device,oai-authenticated-user-id,oai-authenticated-user-email", "access-control-allow-credentials": "true", vary: "origin" };
}

function withCors(response: Response, request: Request): Response {
  const headers = corsHeaders(request);
  if (!Object.keys(headers).length) return response;
  const next = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) next.headers.set(key, value);
  return next;
}

async function readJson(request: Request): Promise<Record<string, unknown>> { try { return await request.json() as Record<string, unknown>; } catch { return {}; } }

async function api(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname, method = request.method;
  if (path === "/health") return json({ status: "ok", ...aiInfo(env), storage: Boolean(env.DB), version: "2.0.0" });
  if (!path.startsWith("/v1/")) return null;

  const viewer = viewerFromRequest(request);
  if (!viewer) return json({ ok: false, error: "Sign in is required." }, 401);
  if (!env.DB) return json({ ok: false, error: "Persistent storage is unavailable." }, 503);
  const userId = viewer.userId;

  if (method === "GET" && path === "/v1/state") {
    const state = await buildState(env, userId);
    if (state.profile && viewer.email && state.profile.email !== viewer.email) await upsertProfile(env, userId, { email: viewer.email });
    return json({ ok: true, data: { ...state, suggestedName: viewer.fullName } });
  }

  if (method === "GET" && path === "/v1/messages") {
    let [messages, state] = await Promise.all([listMessages(env, userId, 60), buildState(env, userId, { skipPortfolio: true })]);
    const requested = url.searchParams.get("language");
    const lang = requested === "en" || requested === "de" ? requested : state.profile?.language ?? "de";
    let last = messages.at(-1);
    // A greeting nobody has answered yet is regenerated when the language changes.
    if (last?.role === "assistant" && last.meta?.opener && last.meta.lang !== lang) { await deleteMessage(env, userId, last.id); messages = messages.slice(0, -1); last = messages.at(-1); }
    const stale = !last || Date.now() - new Date(last.createdAt).getTime() > 6 * 60 * 60 * 1000;
    let opener: Message | null = null;
    if (stale) {
      const hello = greeting(state, lang);
      opener = { id: crypto.randomUUID(), role: "assistant", text: hello.text, cards: [], suggestions: hello.suggestions, mode: "offline", meta: { onboarding: !state.profile?.onboardingDone, opener: true, lang }, createdAt: new Date().toISOString() };
      await saveMessage(env, userId, opener);
    }
    return json({ ok: true, data: { messages: opener ? [...messages, opener] : messages } });
  }

  if (method === "PATCH" && path === "/v1/profile") {
    const body = await readJson(request);
    const patch: Parameters<typeof upsertProfile>[2] = {};
    if (typeof body.name === "string" && body.name.trim().length >= 1) patch.name = body.name.trim().slice(0, 80);
    if (body.language === "de" || body.language === "en") patch.language = body.language;
    if (typeof body.voiceAutoplay === "boolean") patch.voiceAutoplay = body.voiceAutoplay;
    if (typeof body.onboardingDone === "boolean") patch.onboardingDone = body.onboardingDone;
    await upsertProfile(env, userId, { email: viewer.email, ...patch });
    return json({ ok: true, data: await buildState(env, userId) });
  }

  if (method === "PATCH" && path === "/v1/facts") {
    const body = await readJson(request);
    const inputs = Array.isArray(body.facts) ? body.facts as Array<{ key: string; value: unknown; note?: string }> : [];
    const { accepted, rejected } = await setFacts(env, userId, inputs, "edit");
    let message: Message | null = null;
    if (accepted.length) {
      const card: Card = { type: "facts", items: accepted.map(fact => ({ key: fact.key, value: fact.value })), source: "edit" };
      message = { id: crypto.randomUUID(), role: "system", text: "", cards: [card], createdAt: new Date().toISOString() };
      await saveMessage(env, userId, message);
    }
    return json({ ok: true, data: { state: await buildState(env, userId), accepted: accepted.map(fact => fact.key), rejected, message } }, rejected.length && !accepted.length ? 422 : 200);
  }

  if (method === "DELETE" && path === "/v1/facts") {
    const body = await readJson(request);
    const keys = (Array.isArray(body.keys) ? body.keys : []).filter((key): key is string => typeof key === "string").filter(isFactKey);
    await deleteFacts(env, userId, keys);
    return json({ ok: true, data: await buildState(env, userId) });
  }

  if (method === "POST" && path === "/v1/sample") {
    const facts = sampleFacts(new Date());
    await setFacts(env, userId, Object.values(facts).map(fact => ({ key: fact.key, value: fact.value })), "sample");
    await upsertProfile(env, userId, { email: viewer.email, sampleLoaded: true, onboardingDone: true });
    await saveMessage(env, userId, { id: crypto.randomUUID(), role: "system", text: "", cards: [{ type: "sample_loaded" }], createdAt: new Date().toISOString() });
    return json({ ok: true, data: await buildState(env, userId) });
  }

  if (method === "POST" && path === "/v1/next-steps") {
    const body = await readJson(request);
    const text = String(body.text ?? "").trim();
    if (!text) return json({ ok: false, error: "Empty step." }, 400);
    await addNextStep(env, userId, text);
    return json({ ok: true, data: await buildState(env, userId, { skipPortfolio: true }) });
  }
  const stepMatch = path.match(/^\/v1\/next-steps\/([a-z0-9-]+)$/i);
  if (stepMatch && method === "PATCH") { const body = await readJson(request); await setNextStepDone(env, userId, stepMatch[1], Boolean(body.done)); return json({ ok: true, data: await buildState(env, userId, { skipPortfolio: true }) }); }
  if (stepMatch && method === "DELETE") { await deleteNextStep(env, userId, stepMatch[1]); return json({ ok: true, data: await buildState(env, userId, { skipPortfolio: true }) }); }

  if (method === "POST" && path === "/v1/reset") { await resetUser(env, userId); return json({ ok: true, data: { reset: true } }); }
  if (method === "POST" && path === "/v1/chat") return handleChat(request, env, userId);
  if (method === "POST" && path === "/v1/voice/transcribe") return transcribe(request, env);
  if (method === "POST" && path === "/v1/voice/synthesize") return synthesize(request, env);
  return json({ ok: false, error: "Not found." }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    try {
      const handled = await api(request, env, url);
      if (handled) return withCors(handled, request);
    } catch (error) {
      return withCors(json({ ok: false, error: error instanceof Error ? error.message : "Service unavailable." }, 502), request);
    }
    if (!env.ASSETS) return json({ ok: false, error: "Not found." }, 404);
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || url.pathname.includes(".")) return response;
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  },
};
