/** Speech-to-text and text-to-speech through the Groq audio endpoints. */
import type { Env } from "./db";
import { groqFetch } from "./groq";

export async function transcribe(request: Request, env: Env): Promise<Response> {
  const incoming = await request.formData();
  const audio = incoming.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return Response.json({ ok: false, error: "No recording received." }, { status: 400 });
  if (audio.size > 15 * 1024 * 1024) return Response.json({ ok: false, error: "The recording is too large." }, { status: 413 });
  const form = new FormData();
  form.set("file", audio, audio.name || "question.webm");
  form.set("model", "whisper-large-v3-turbo");
  form.set("language", incoming.get("language") === "en" ? "en" : "de");
  form.set("response_format", "json");
  form.set("temperature", "0");
  const response = await groqFetch("/audio/transcriptions", env, { method: "POST", body: form });
  const result = await response.json() as { text?: string };
  return Response.json({ ok: true, data: { transcript: result.text?.trim() || "" } });
}

export async function synthesize(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { text?: string; language?: string };
  const language = body.language === "en" ? "en" : "de";
  const input = String(body.text || "").trim().slice(0, 400);
  if (!input) return Response.json({ ok: false, error: "No speech text received." }, { status: 400 });
  if (language !== "en") return Response.json({ ok: false, error: "Server voice is English-only; the browser voice is used for German.", fallback: "system_voice" }, { status: 422 });
  const response = await groqFetch("/audio/speech", env, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english", voice: env.GROQ_TTS_VOICE || "hannah", input, response_format: "wav" }) });
  return new Response(response.body, { status: 200, headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
}
