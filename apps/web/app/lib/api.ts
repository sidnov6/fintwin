import type { AppState, Card, ChatEvent, Facts, Lang, Message, NextStep } from "@fintwin/contracts";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * A stable id for this browser, used only when the host platform does not supply
 * a signed-in user. Cookies are unreliable here because a hosted app is often
 * embedded in an iframe, where a third-party cookie is blocked and every request
 * would otherwise look like a brand-new person.
 */
const DEVICE_KEY = "fintwin-device-id";
let deviceId: string | null = null;
export function getDeviceId(): string {
  if (deviceId) return deviceId;
  if (typeof window === "undefined") return "";
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored && /^[a-f0-9-]{36}$/.test(stored)) { deviceId = stored; return stored; }
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, created);
    deviceId = created;
    return created;
  } catch {
    // Private mode with storage disabled: stay stable for this page at least.
    deviceId = deviceId ?? crypto.randomUUID();
    return deviceId;
  }
}

/** Headers every call carries, so identity survives however the app is embedded. */
export function authHeaders(): Record<string, string> {
  const id = getDeviceId();
  return id ? { "x-fintwin-device": id } : {};
}

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers || {}) }, credentials: "include", cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { ok?: boolean; data?: T; error?: string };
  if (!response.ok || body.ok === false) throw new ApiError(body.error || `Request failed (${response.status})`, response.status);
  return body.data as T;
}

export const api = {
  state: () => request<AppState & { suggestedName?: string }>("/v1/state"),
  messages: (language: Lang) => request<{ messages: Message[] }>(`/v1/messages?language=${language}`),
  patchProfile: (patch: { name?: string; language?: Lang; voiceAutoplay?: boolean; onboardingDone?: boolean }) => request<AppState>("/v1/profile", { method: "PATCH", body: JSON.stringify(patch) }),
  patchFacts: (facts: Array<{ key: keyof Facts; value: number | string }>) => request<{ state: AppState; accepted: string[]; rejected: string[]; message: Message | null }>("/v1/facts", { method: "PATCH", body: JSON.stringify({ facts }) }),
  deleteFacts: (keys: Array<keyof Facts>) => request<AppState>("/v1/facts", { method: "DELETE", body: JSON.stringify({ keys }) }),
  loadSample: () => request<AppState>("/v1/sample", { method: "POST" }),
  addNextStep: (text: string) => request<AppState>("/v1/next-steps", { method: "POST", body: JSON.stringify({ text }) }),
  setStepDone: (step: NextStep, done: boolean) => request<AppState>(`/v1/next-steps/${step.id}`, { method: "PATCH", body: JSON.stringify({ done }) }),
  deleteStep: (step: NextStep) => request<AppState>(`/v1/next-steps/${step.id}`, { method: "DELETE" }),
  reset: () => request<{ reset: boolean }>("/v1/reset", { method: "POST" }),
  health: () => request<{ live: boolean; voice: boolean }>("/health"),
};

export interface ChatHandlers {
  onStart?(messageId: string, mode: "live" | "offline"): void;
  onDelta(text: string): void;
  onCard(card: Card): void;
  onState(state: AppState): void;
  onDone(message: Message): void;
  onError(message: string): void;
}

/** Streams one chat turn. Returns an abort function. */
export function chat(text: string, language: Lang, mode: "text" | "voice", handlers: ChatHandlers): () => void {
  const controller = new AbortController();
  (async () => {
    try {
      const response = await fetch(`${API}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, credentials: "include", body: JSON.stringify({ text, language, mode }), signal: controller.signal });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new ApiError(body.error || `Chat failed (${response.status})`, response.status);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
          else if (event.type === "state") handlers.onState(event.state);
          else if (event.type === "done") handlers.onDone(event.message);
          else if (event.type === "error") handlers.onError(event.message);
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      handlers.onError(error instanceof Error ? error.message : "Connection lost.");
    }
  })();
  return () => controller.abort();
}
