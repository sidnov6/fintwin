/**
 * FinTwin worker — API and static asset host.
 * Signed-in viewer identity arrives via the platform's oai-authenticated-* headers.
 */
import type { Card, Message } from "@fintwin/contracts";
import { addNextStep, deleteFacts, deleteMessage, deleteNextStep, getHead, listMessages, resetUser, saveMessage, setFacts, setNextStepDone, upsertProfile, type Env, type MutationContext } from "./db";
import { aiInfo, buildState } from "./state";
import { greeting, handleChat } from "./chat";
import { synthesize, transcribe } from "./voice";
import { isFactKey } from "@fintwin/engine";
import { assertOrigin, localOpen, login, logout, rateLimit, viewer as authenticate } from './access';
import { AppError, publicError } from './errors';
import { assembleBrief, createScenario, loadSample, readScenario } from './application';
import { reserve, settle, usageSummary } from './budget';
import { readBank } from './bank';
export {applicationBridge} from './realtime-bridge';


function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
}

function corsHeaders(request: Request,env:Env): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  if (!origin||(origin!==new URL(request.url).origin&&origin!==env.FINTWIN_ALLOWED_ORIGIN)) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type,x-fintwin-request", "access-control-allow-credentials": "true", vary: "origin" };
}

function withCors(response: Response, request: Request,env:Env): Response {
  const headers = corsHeaders(request,env);
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
  if (!env.DB) return json({ ok: false, error: "Persistent storage is unavailable." }, 503);
  assertOrigin(request,env);
  if(path==='/v1/session' && method==='GET')return json({ok:true,data:{passphraseRequired:!localOpen(request,env)}});
  if(path==='/v1/session' && method==='POST')return login(request,env);
  if(path==='/v1/session' && method==='DELETE')return logout(request,env);
  const userId = await authenticate(request,env);
  if (!userId) return json({ ok: false, error: "Enter the protected demo to continue." }, 401);
  rateLimit(userId,120);
  if(Number(request.headers.get('content-length')??0)>(path.includes('transcribe')?2_000_000:64000))throw new AppError('body_too_large',413);
  const mutation=async(body:Record<string,unknown>):Promise<MutationContext>=>{
    const head=await getHead(env,userId);
    if(typeof body.expectedRevision!=='number' || !Number.isInteger(body.expectedRevision) || typeof body.requestId!=='string' || !/^[a-zA-Z0-9:_-]{8,140}$/.test(body.requestId))throw new AppError('mutation_context_required',422,'Refresh the app before saving.');
    if(body.expectedEpoch!==undefined&&body.expectedEpoch!==head.epoch)throw new AppError('state_changed',409,'This household was reset. Refresh before continuing.');
    return {id:body.requestId,expectedRevision:body.expectedRevision,epoch:head.epoch};
  };

  if(path.startsWith('/v1/realtime/')) {
    if(!env.REALTIME)throw new AppError('realtime_unavailable',503,'Realtime is unavailable on this host. Continue in text.');
    return env.REALTIME.handle(request,userId);
  }
  if(path==='/v1/preflight' && method==='GET')return json({ok:true,data:{ai:aiInfo(env),usage:await usageSummary(env,userId),smoke:env.TEXT_SMOKE?.()??{status:'not_run',at:null,kind:'text-only'},storage:true}});
  if(path==='/v1/brief' && method==='POST'){const body=await readJson(request);return json({ok:true,data:await assembleBrief(env,userId,body.language==='en'?'en':'de',typeof body.scenarioId==='string'?body.scenarioId:undefined)});}
  if(path==='/v1/scenarios' && method==='POST'){
    const body=await readJson(request);const snapshot=await createScenario(env,userId,body.kind as 'mortgage',body.inputs as Record<string,unknown>??{},await mutation(body));
    await env.REALTIME?.sync(userId);
    return json({ok:true,data:{snapshot,state:await buildState(env,userId)}});
  }
  const scenarioMatch=path.match(/^\/v1\/scenarios\/([a-f0-9-]+)$/);
  if(scenarioMatch && method==='GET')return json({ok:true,data:await readScenario(env,userId,scenarioMatch[1])});

  if (method === "GET" && path === "/v1/state") {
    const state = await buildState(env, userId);
    return json({ ok: true, data: state });
  }
  if (method === 'GET' && path === '/v1/bank') {
    const query:Record<string,unknown>=Object.fromEntries(url.searchParams);
    if(query.recurring!==undefined){if(!['true','false'].includes(String(query.recurring)))throw new AppError('invalid_bank_filter',422);query.recurring=query.recurring==='true';}
    return json({ok:true,data:readBank(await buildState(env,userId,{skipPortfolio:true}),query)});
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
      opener = { id: crypto.randomUUID(), role: "assistant", text: hello.text, cards: [], suggestions: hello.suggestions, mode: "offline", meta: { ...hello.meta, onboarding: !state.profile?.onboardingDone, opener: true, lang }, createdAt: new Date().toISOString() };
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
    const head=await getHead(env,userId);
    await upsertProfile(env, userId, patch,body.requestId?await mutation(body):{id:crypto.randomUUID(),expectedRevision:head.revision,epoch:head.epoch});
    await env.REALTIME?.sync(userId);
    return json({ ok: true, data: await buildState(env, userId) });
  }

  if (method === "PATCH" && path === "/v1/facts") {
    const body = await readJson(request);
    const inputs = Array.isArray(body.facts) ? body.facts as Array<{ key: string; value: unknown; note?: string }> : [];
    const { accepted, rejected } = await setFacts(env, userId, inputs, "edit", await mutation(body));
    await env.REALTIME?.sync(userId);
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
    await deleteFacts(env, userId, keys, await mutation(body));
    await env.REALTIME?.sync(userId);
    return json({ ok: true, data: await buildState(env, userId) });
  }

  if (method === "POST" && path === "/v1/sample") {
    const body=await readJson(request);
    return json({ok:true,data:await loadSample(env,userId,body.confirmed===true,await mutation(body))});
  }

  if (method === "POST" && path === "/v1/next-steps") {
    const body = await readJson(request);
    const text = String(body.text ?? "").trim();
    if (!text) return json({ ok: false, error: "Empty step." }, 400);
    await addNextStep(env, userId, text,body.requestId?await mutation(body):undefined);
    return json({ ok: true, data: await buildState(env, userId, { skipPortfolio: true }) });
  }
  const stepMatch = path.match(/^\/v1\/next-steps\/([a-z0-9-]+)$/i);
  if (stepMatch && method === "PATCH") { const body = await readJson(request); await setNextStepDone(env, userId, stepMatch[1], Boolean(body.done)); return json({ ok: true, data: await buildState(env, userId, { skipPortfolio: true }) }); }
  if (stepMatch && method === "DELETE") { await deleteNextStep(env, userId, stepMatch[1]); return json({ ok: true, data: await buildState(env, userId, { skipPortfolio: true }) }); }

  if (method === "POST" && path === "/v1/reset") { const body=await readJson(request);if(body.confirmed!==true)throw new AppError('confirmation_required',409);await env.REALTIME?.stop(userId);await resetUser(env, userId); return json({ ok: true, data: { reset: true } }); }
  if (method === "POST" && path === "/v1/chat") return handleChat(request, env, userId);
  if (method === "POST" && (path === "/v1/voice/transcribe" || path === "/v1/voice/synthesize")) {
    if(env.FINTWIN_VOICE_MODE==='text')throw new AppError('voice_disabled',503);
    const id=await reserve(env,userId,path.endsWith('transcribe')?'stt':'tts','configured-speech',0.10);
    try{return path.endsWith('transcribe')?await transcribe(request,env):await synthesize(request,env);}finally{await settle(env,id,null);}
  }
  return json({ ok: false, error: "Not found." }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request,env) });
    try {
      if(url.pathname.startsWith('/v1/')&&request.body&&!['GET','HEAD'].includes(request.method)){
        const max=url.pathname.endsWith('/transcribe')?2_000_000:64000;
        const reader=request.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new AppError('body_too_large',413);}chunks.push(new Uint8Array(value));}
        request=new Request(request,{body:new Blob(chunks)});
      }
      const handled = await api(request, env, url);
      if (handled) return withCors(handled, request,env);
    } catch (error) {
      const safe=publicError(error);
      return withCors(json({ ok: false, error: safe.error, code:safe.code }, safe.status), request,env);
    }
    if (!env.ASSETS) return json({ ok: false, error: "Not found." }, 404);
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || url.pathname.includes(".")) return response;
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  },
};
