/**
 * Provider registry.
 *
 * Each of the three jobs (thinking, hearing, speaking) is done by whichever
 * vendor is configured, because no single vendor is best at all three. The app
 * degrades cleanly: if a preferred provider has no key, the next one is used,
 * and if none is available the browser handles it.
 *
 * Chat    : any OpenAI-compatible endpoint (Groq, OpenAI, Together, Fireworks, ...)
 * Speech in : ElevenLabs Scribe > Groq Whisper large-v3 > browser recognition
 * Speech out: ElevenLabs (multilingual, German) > Groq Orpheus (English) > browser voice
 */
import type { Env } from "./db";

export interface ChatProvider {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** gpt-oss and qwen accept reasoning_effort; most others do not. */
  supportsReasoningEffort: boolean;
  reasoningEffort: "low" | "medium" | "high" | null;
  maxTokens: number;
}

export interface SpeechInProvider { id: "elevenlabs" | "groq" | "none"; model: string }
export interface SpeechOutProvider { id: "elevenlabs" | "groq" | "none"; model: string; voice: string; maxChars: number; languages: "multilingual" | "english" }

const REASONING_MODELS = /gpt-oss|qwen3\.[68]/i;

export function chatProvider(env: Env): ChatProvider | null {
  // An explicit OpenAI-compatible endpoint wins, so any vendor can be used.
  const custom = env.LLM_API_KEY && env.LLM_BASE_URL;
  const baseUrl = custom ? env.LLM_BASE_URL! : "https://api.groq.com/openai/v1";
  const apiKey = custom ? env.LLM_API_KEY! : env.GROQ_API_KEY || "";
  if (!apiKey) return null;
  const model = (custom ? env.LLM_MODEL : env.GROQ_CHAT_MODEL) || "openai/gpt-oss-120b";
  const supportsReasoningEffort = REASONING_MODELS.test(model);
  const requested = (env.LLM_REASONING_EFFORT || "medium").toLowerCase();
  const reasoningEffort = supportsReasoningEffort && ["low", "medium", "high"].includes(requested) ? requested as "low" | "medium" | "high" : null;
  // Reasoning tokens are billed against max_tokens, so leave room or the reply comes back empty.
  const headroom = reasoningEffort === "high" ? 6000 : reasoningEffort === "medium" ? 3500 : 2000;
  return { id: custom ? new URL(baseUrl).hostname : "groq", baseUrl, apiKey, model, supportsReasoningEffort, reasoningEffort, maxTokens: Number(env.LLM_MAX_TOKENS) || headroom };
}

export function speechInProvider(env: Env): SpeechInProvider {
  if (env.ELEVENLABS_API_KEY) return { id: "elevenlabs", model: env.ELEVENLABS_STT_MODEL || "scribe_v1" };
  // large-v3 has a lower error rate than turbo; we prefer accuracy over speed here.
  if (env.GROQ_API_KEY) return { id: "groq", model: env.GROQ_STT_MODEL || "whisper-large-v3" };
  return { id: "none", model: "" };
}

export function speechOutProvider(env: Env): SpeechOutProvider {
  if (env.ELEVENLABS_API_KEY) return {
    id: "elevenlabs",
    model: env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2",
    voice: env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
    maxChars: 800, languages: "multilingual",
  };
  if (env.GROQ_API_KEY) return {
    id: "groq",
    model: env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english",
    voice: env.GROQ_TTS_VOICE || "hannah",
    maxChars: 190, languages: "english",
  };
  return { id: "none", model: "", voice: "", maxChars: 0, languages: "english" };
}
