/**
 * Speech in and speech out, routed to whichever provider is configured.
 *
 * Transcription is primed with a vocabulary hint, which is the single cheapest
 * accuracy win: without it, models mangle exactly the words this app cares about
 * (Zinsbindung, ETF, Riester, Nettovermögen) and spell numbers inconsistently.
 */
import type { Env } from "./db";
import { groqFetch } from "./groq";
import { speechInProvider, speechOutProvider } from "./providers";

/** Domain vocabulary and formatting hints, in the language being spoken. */
function transcriptionHint(language: "de" | "en"): string {
  return language === "de"
    ? "Gespräch über private Finanzen. Begriffe: Nettovermögen, Nettoeinkommen, Ausgaben, Sparrate, Notfallreserve, Zinsbindung, Anschlussfinanzierung, Restschuld, Hypothek, Sondertilgung, Altersvorsorge, Rentenalter, Betriebsrente, Riester, Berufsunfähigkeit, Depot, ETF, Aktien, Tagesgeld. Beträge in Euro, z. B. 5.500 €, 3.200 €, 1,5 Mio. €. Prozentsätze wie 4 %."
    : "Conversation about personal finances. Terms: net worth, net income, spending, savings rate, emergency runway, fixed-rate period, mortgage refix, remaining balance, overpayment, retirement age, workplace pension, income protection, brokerage, ETF, index fund, savings account. Amounts in euros, e.g. €5,500, €3,200, €1.5M. Percentages like 4%.";
}

async function elevenLabs(path: string, env: Env, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set("xi-api-key", env.ELEVENLABS_API_KEY!);
  const response = await fetch(`https://api.elevenlabs.io/v1${path}`, { ...init, headers });
  if (!response.ok) {
    let detail = "";
    try { detail = JSON.stringify((await response.clone().json() as { detail?: unknown }).detail ?? "").slice(0, 200); } catch { /* ignore */ }
    throw new Error(`ElevenLabs ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response;
}

export async function transcribe(request: Request, env: Env): Promise<Response> {
  const incoming = await request.formData();
  const audio = incoming.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return Response.json({ ok: false, error: "No recording received." }, { status: 400 });
  if (audio.size > 20 * 1024 * 1024) return Response.json({ ok: false, error: "The recording is too large." }, { status: 413 });
  const language = incoming.get("language") === "en" ? "en" : "de";
  const provider = speechInProvider(env);

  if (provider.id === "elevenlabs") {
    const form = new FormData();
    form.set("file", audio, audio.name || "question.webm");
    form.set("model_id", provider.model);
    form.set("language_code", language);
    form.set("tag_audio_events", "false");
    form.set("diarize", "false");
    const response = await elevenLabs("/speech-to-text", env, { method: "POST", body: form });
    const result = await response.json() as { text?: string };
    return Response.json({ ok: true, data: { transcript: result.text?.trim() || "", provider: "elevenlabs" } });
  }

  if (provider.id === "groq") {
    const form = new FormData();
    form.set("file", audio, audio.name || "question.webm");
    form.set("model", provider.model);
    form.set("language", language);
    form.set("prompt", transcriptionHint(language));
    form.set("response_format", "json");
    form.set("temperature", "0");
    const response = await groqFetch("/audio/transcriptions", env, { method: "POST", body: form });
    const result = await response.json() as { text?: string };
    return Response.json({ ok: true, data: { transcript: result.text?.trim() || "", provider: "groq" } });
  }
  return Response.json({ ok: false, error: "No transcription provider is configured." }, { status: 503 });
}

export async function synthesize(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { text?: string; language?: string };
  const language = body.language === "en" ? "en" : "de";
  const provider = speechOutProvider(env);
  const input = String(body.text || "").trim().slice(0, provider.maxChars || 200);
  if (!input) return Response.json({ ok: false, error: "No speech text received." }, { status: 400 });

  if (provider.id === "elevenlabs") {
    const response = await elevenLabs(`/text-to-speech/${provider.voice}/stream?output_format=mp3_44100_128`, env, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: input, model_id: provider.model, voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true } }),
    });
    return new Response(response.body, { status: 200, headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  }

  if (provider.id === "groq") {
    // Orpheus is English-only; German falls back to the browser voice.
    if (language !== "en") return Response.json({ ok: false, error: "This voice provider speaks English only; the browser voice is used for German.", fallback: "system_voice" }, { status: 422 });
    const response = await groqFetch("/audio/speech", env, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: provider.model, voice: provider.voice, input, response_format: "wav" }) });
    return new Response(response.body, { status: 200, headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
  }
  return Response.json({ ok: false, error: "No speech provider is configured.", fallback: "system_voice" }, { status: 422 });
}
