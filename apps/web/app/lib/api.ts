import type { AppState, Card, ChatEvent, Facts, Lang, Message, NextStep, MeetingBrief, ScenarioSnapshot } from "@fintwin/contracts";
import type { BankQuery, BankReport } from '@fintwin/contracts';

// Production serves UI + API on the same origin. A developer's .env.local
// must never bake localhost:8787 into the port-8798 demo or a hosted build.
export const API = process.env.NODE_ENV === 'production' ? '' : process.env.NEXT_PUBLIC_API_URL ?? '';

// Session identity is an HttpOnly, server-issued cookie. This header is only
// a CSRF request marker, never an identity claim.
export function authHeaders():Record<string,string>{return {'x-fintwin-request':'1'};}
let currentRevision=0,currentEpoch=0;
const mutation=(value:object)=>JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:currentRevision,expectedEpoch:currentEpoch,...value});

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers || {}) }, credentials: "include", cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { ok?: boolean; data?: T; error?: string };
  if (!response.ok || body.ok === false) throw new ApiError(body.error || `Request failed (${response.status})`, response.status);
  const data=body.data as {revision?:number;state?:AppState}|undefined;
  if(typeof data?.revision==='number'){currentRevision=Math.max(currentRevision,data.revision);currentEpoch=(data as AppState).epoch??currentEpoch;}
  else if(data?.state){currentRevision=Math.max(currentRevision,data.state.revision);currentEpoch=Math.max(currentEpoch,data.state.epoch);}
  return body.data as T;
}

export const api = {
  bank: (query:BankQuery={}) => request<BankReport>(`/v1/bank?${new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>[k,String(v)]))}`),
  login: (passphrase:string)=>request('/v1/session',{method:'POST',body:JSON.stringify({passphrase})}),
  logout: ()=>request('/v1/session',{method:'DELETE'}),
  state: () => request<AppState & { suggestedName?: string }>("/v1/state"),
  openState: async (): Promise<AppState & { suggestedName?: string }> => {
    // Reuse an existing session without changing its identity or history.
    try { return await api.state(); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      const access = await request<{passphraseRequired: boolean}>('/v1/session');
      if (access.passphraseRequired !== false) throw error;
      await request('/v1/session', {method: 'POST', body: '{}'});
      // A single retry: blocked cookies must not cause an endless login loop.
      return api.state();
    }
  },
  messages: (language: Lang) => request<{ messages: Message[] }>(`/v1/messages?language=${language}`),
  patchProfile: (patch: { name?: string; language?: Lang; voiceAutoplay?: boolean; onboardingDone?: boolean }) => request<AppState>("/v1/profile", { method: "PATCH", body: mutation(patch) }),
  patchFacts: (facts: Array<{ key: keyof Facts; value: number | string }>, expectedRevision=currentRevision) => request<{ state: AppState; accepted: string[]; rejected: string[]; message: Message | null }>("/v1/facts", { method: "PATCH", body: mutation({ facts,expectedRevision }) }),
  deleteFacts: (keys: Array<keyof Facts>) => request<AppState>("/v1/facts", { method: "DELETE", body: mutation({ keys }) }),
  loadSample: (confirmed=false) => request<AppState>("/v1/sample", { method: "POST", body:mutation({confirmed}) }),
  createScenario: (kind:ScenarioSnapshot['kind'],inputs:Record<string,number|string>,expectedRevision=currentRevision)=>request<{snapshot:ScenarioSnapshot;state:AppState}>('/v1/scenarios',{method:'POST',body:mutation({kind,inputs,expectedRevision})}),
  brief: (language:Lang,scenarioId?:string)=>request<MeetingBrief>('/v1/brief',{method:'POST',body:JSON.stringify({language,scenarioId})}),
  preflight: ()=>request<{ai:AppState['ai'];usage:{remaining:number;sessionUsed:number;totalUsed:number;sessionLimit:number;totalLimit:number;basis:string};smoke:{status:string;at:string|null}}>('/v1/preflight'),
  addNextStep: (text: string) => request<AppState>("/v1/next-steps", { method: "POST", body: mutation({ text }) }),
  setStepDone: (step: NextStep, done: boolean) => request<AppState>(`/v1/next-steps/${step.id}`, { method: "PATCH", body: JSON.stringify({ done }) }),
  deleteStep: (step: NextStep) => request<AppState>(`/v1/next-steps/${step.id}`, { method: "DELETE" }),
  reset: () => request<{ reset: boolean }>("/v1/reset", { method: "POST",body:mutation({confirmed:true}) }),
  health: () => request<{ live: boolean; voice: boolean }>("/health"),
};

export interface ChatHandlers {
  onStart?(messageId: string, mode: "live" | "offline"): void;
  onDelta(text: string): void;
  onCard(card: Card): void;
  onState(state: AppState): void;
  onDone(message: Message): void;
  onError(message: string): void;
  onReplace?(text:string):void;
  onFinally?():void;
}

/** Streams one chat turn. Returns an abort function. */
export function chat(text: string, language: Lang, mode: "text" | "voice", handlers: ChatHandlers, scenarioId?:string, requestId=crypto.randomUUID()): () => void {
  const controller = new AbortController();
  (async () => {
    try {
      const response = await fetch(`${API}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, credentials: "include", body: JSON.stringify({ text, language, mode,requestId,scenarioId,expectedEpoch:currentEpoch }), signal: controller.signal });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new ApiError(body.error || `Chat failed (${response.status})`, response.status);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "",terminal=false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split("\n").find(line => line.startsWith("data:"));
          if (!data) continue;
          let event: ChatEvent;
          try { event = JSON.parse(data.slice(5)); } catch { continue; }
          if (event.type === "start") handlers.onStart?.(event.messageId, event.mode);
          else if (event.type === "delta") handlers.onDelta(event.text);
          else if (event.type === "card") handlers.onCard(event.card);
          else if (event.type === "state") {currentRevision=Math.max(currentRevision,event.state.revision);currentEpoch=Math.max(currentEpoch,event.state.epoch);handlers.onState(event.state);}
          else if (event.type === "replace") handlers.onReplace?.(event.text);
          else if (event.type === "done") {terminal=true;handlers.onDone(event.message);}
          else if (event.type === "error") {terminal=true;handlers.onError(event.message);}
          else if (event.type === "cancelled") {terminal=true;}
        }
      }
      if(!terminal && !controller.signal.aborted)throw new Error(language==='de'?'Die Verbindung wurde unterbrochen. Bitte versuchen Sie es erneut.':'The connection ended before the reply completed. Please retry.');
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      handlers.onError(error instanceof Error ? error.message : "Connection lost.");
    } finally {handlers.onFinally?.();}
  })();
  return () => controller.abort();
}
