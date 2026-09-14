/**
 * Provider registry.
 *
 * Each of the three jobs (thinking, hearing, speaking) is done by whichever
 * vendor is configured, because no single vendor is best at all three. The app
 * degrades cleanly: if a preferred provider has no key, the next one is used,
 * and if none is available the browser handles it.
 *
 * Chat    : any OpenAI-compatible endpoint (Groq, OpenAI, Together, Fireworks, ...)
 * Text: explicit custom endpoint > OpenAI > Groq (also runtime text fallback).
 * Speech: OpenAI > ElevenLabs > Groq. Never silently swap voices mid-call.
 */
import type { Env } from "./db";

export interface ChatProvider {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol?: 'responses';
  /** gpt-oss and qwen accept reasoning_effort; most others do not. */
  supportsReasoningEffort: boolean;
  reasoningEffort: "none" | "low" | "medium" | "high" | null;
  verbosity?: 'low';
  maxTokens: number;
  tokenField: string;
  temperature: boolean;
}

export interface SpeechInProvider { id: "openai" | "elevenlabs" | "groq" | "none"; model: string }
export interface SpeechOutProvider { id: "openai" | "elevenlabs" | "groq" | "none"; model: string; voice: string; maxChars: number; languages: "multilingual" | "english" }

const REASONING_MODELS = /gpt-oss|qwen3\.[68]/i;

export function chatProvider(env: Env): ChatProvider | null {
  if(providerError(env))return null;
  // An explicit OpenAI-compatible endpoint wins, so any vendor can be used.
  const custom = env.LLM_API_KEY && env.LLM_BASE_URL;
  if (custom && (!env.LLM_MODEL?.trim() || !/^https:\/\//.test(env.LLM_BASE_URL!))) return null;
  if (!custom && env.OPENAI_API_KEY) {
    const model = env.OPENAI_CHAT_MODEL || 'gpt-5.4';
    // The interview companion uses tools for arithmetic, not hidden reasoning.
    // Keep unknown/pinned model overrides on the previous compatible settings.
    const fastModel = /^gpt-5\.4(?:-\d{4}-\d{2}-\d{2})?$/.test(model);
    const requested = env.OPENAI_REASONING_EFFORT;
    const effort = requested && ['none', 'low', 'medium', 'high'].includes(requested)
      ? requested as NonNullable<ChatProvider['reasoningEffort']> : fastModel ? 'none' : 'low';
    return {
      id: 'api.openai.com', baseUrl: 'https://api.openai.com/v1', apiKey: env.OPENAI_API_KEY,
      model, protocol: 'responses', supportsReasoningEffort: true,
      reasoningEffort: effort, ...(fastModel ? { verbosity: 'low' as const } : {}),
      maxTokens: 3500, tokenField: 'max_completion_tokens', temperature: false,
    };
  }
  const baseUrl = custom ? env.LLM_BASE_URL! : "https://api.groq.com/openai/v1";
  const apiKey = custom ? env.LLM_API_KEY! : env.GROQ_API_KEY || "";
  if (!apiKey) return null;
  const model = custom ? env.LLM_MODEL!.trim() : env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b";
  const supportsReasoningEffort = REASONING_MODELS.test(model);
  const requested = (env.LLM_REASONING_EFFORT || "medium").toLowerCase();
  const reasoningEffort = supportsReasoningEffort && ["low", "medium", "high"].includes(requested) ? requested as "low" | "medium" | "high" : null;
  // Reasoning tokens are billed against max_tokens, so leave room or the reply comes back empty.
  const headroom = reasoningEffort === "high" ? 6000 : reasoningEffort === "medium" ? 3500 : 2000;
  return { id: custom ? new URL(baseUrl).hostname : "groq", baseUrl: baseUrl.replace(/\/$/,''), apiKey, model, supportsReasoningEffort, reasoningEffort, maxTokens: Math.min(6000, Math.max(128, Number(env.LLM_MAX_TOKENS) || headroom)), tokenField: env.LLM_TOKEN_FIELD === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens', temperature: custom ? env.LLM_ALLOW_TEMPERATURE === '1' : !supportsReasoningEffort };
}

/** Only the built-in OpenAI route may fail over; explicit custom routes fail closed. */
export function groqFallback(env: Env, primary: ChatProvider): ChatProvider | null {
  if (primary.id !== 'api.openai.com' || env.LLM_API_KEY || !env.GROQ_API_KEY) return null;
  return chatProvider({ ...env, OPENAI_API_KEY: undefined });
}

export function providerError(env: Env): string | undefined {
  if (env.LLM_API_KEY && (!env.LLM_BASE_URL || !env.LLM_MODEL?.trim())) return 'Custom text requires LLM_BASE_URL and an explicit LLM_MODEL.';
  if (env.LLM_BASE_URL && !/^https:\/\//.test(env.LLM_BASE_URL)) return 'LLM_BASE_URL must be an HTTPS OpenAI-compatible API base.';
  return undefined;
}

export function speechInProvider(env: Env): SpeechInProvider {
  if (env.OPENAI_API_KEY) return { id: 'openai', model: env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe' };
  if (env.ELEVENLABS_API_KEY) return { id: "elevenlabs", model: env.ELEVENLABS_STT_MODEL || "scribe_v1" };
  // large-v3 has a lower error rate than turbo; we prefer accuracy over speed here.
  if (env.GROQ_API_KEY) return { id: "groq", model: env.GROQ_STT_MODEL || "whisper-large-v3" };
  return { id: "none", model: "" };
}

export function speechOutProvider(env: Env): SpeechOutProvider {
  if (env.OPENAI_API_KEY) return { id: 'openai', model: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: env.OPENAI_TTS_VOICE || 'marin', maxChars: 800, languages: 'multilingual' };
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
