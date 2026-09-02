"use client";
/**
 * Voice input and output.
 *
 * Input: always records audio and sends it to the server for transcription,
 * because a hosted model is markedly more accurate than the browser recogniser
 * on numbers and financial vocabulary. The browser recogniser runs alongside it
 * purely to show live interim text, so the person sees words appear while they
 * speak. Recording ends on silence, detected from the waveform.
 *
 * Output: splits the reply into chunks sized to whatever the speech provider
 * accepts, then fetches the next chunk while the current one plays, so the
 * speech runs without gaps. Any interruption stops it immediately.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "@fintwin/contracts";
import { API, authHeaders } from "./api";

type RecognitionResultEvent = { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
interface Recognition { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: RecognitionResultEvent) => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null; onspeechstart: (() => void) | null }
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
function canRecord(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined";
}
export function speechInputSupported(): boolean { return canRecord() || Boolean(recognitionCtor()); }

export interface SpeechInputOptions {
  lang: Lang;
  /** False when the server has no transcription provider, so we must trust the browser. */
  serverTranscription: boolean;
  onInterim(text: string): void;
  onFinal(text: string): void;
  onSpeechStart?(): void;
  onError(kind: "permission" | "unsupported" | "empty" | "failed"): void;
}

const SILENCE_MS = 1200;      // quiet time that ends a turn
const MIN_SPEECH_MS = 400;    // ignore stray clicks
const MAX_TURN_MS = 45_000;   // hard ceiling

export function useSpeechInput({ lang, serverTranscription, onInterim, onFinal, onSpeechStart, onError }: SpeechInputOptions) {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);
  const cancelled = useRef(false);
  const browserTranscript = useRef("");
  const handlers = useRef({ onInterim, onFinal, onSpeechStart, onError });
  handlers.current = { onInterim, onFinal, onSpeechStart, onError };

  const teardown = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (audioContext.current) { void audioContext.current.close().catch(() => {}); audioContext.current = null; }
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (recognition.current) { try { recognition.current.abort(); } catch { /* already gone */ } recognition.current = null; }
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    else if (recognition.current) { try { recognition.current.stop(); } catch { /* already gone */ } }
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (recorder.current?.state === "recording") { recorder.current.onstop = null; recorder.current.stop(); }
    recorder.current = null;
    teardown();
    setListening(false);
  }, [teardown]);

  /** Ends the recording once the speaker has been quiet for a moment. */
  const watchLevels = useCallback((media: MediaStream, active: MediaRecorder) => {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new Ctor();
    audioContext.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(media).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const started = Date.now();
    let heardSpeech = false, lastVoice = started;
    const tick = () => {
      if (active.state !== "recording") return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) { const centred = (value - 128) / 128; sum += centred * centred; }
      const rms = Math.sqrt(sum / samples.length);
      setLevel(Math.min(1, rms * 6));
      const now = Date.now();
      if (rms > 0.022) {
        if (!heardSpeech) { heardSpeech = true; handlers.current.onSpeechStart?.(); }
        lastVoice = now;
      }
      const quietLongEnough = heardSpeech && now - lastVoice > SILENCE_MS && now - started > MIN_SPEECH_MS;
      const gaveUpWaiting = !heardSpeech && now - started > 6000;
      if (quietLongEnough || gaveUpWaiting || now - started > MAX_TURN_MS) { active.stop(); return; }
      frame.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const start = useCallback(async () => {
    if (listening) return;
    cancelled.current = false;
    browserTranscript.current = "";

    if (!canRecord()) {
      // No recorder: fall back to the browser recogniser as the only option.
      const Ctor = recognitionCtor();
      if (!Ctor) { handlers.current.onError("unsupported"); return; }
      const instance = new Ctor();
      recognition.current = instance;
      instance.lang = lang === "de" ? "de-DE" : "en-GB";
      instance.continuous = false; instance.interimResults = true;
      let finalText = "";
      instance.onspeechstart = () => handlers.current.onSpeechStart?.();
      instance.onresult = event => {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index];
          if (result.isFinal) finalText += result[0].transcript; else interim += result[0].transcript;
        }
        handlers.current.onInterim((finalText + interim).trim());
      };
      instance.onerror = event => handlers.current.onError(event.error === "not-allowed" ? "permission" : event.error === "no-speech" ? "empty" : "failed");
      instance.onend = () => { setListening(false); recognition.current = null; const text = finalText.trim(); if (text && !cancelled.current) handlers.current.onFinal(text); };
      try { instance.start(); setListening(true); } catch { handlers.current.onError("failed"); }
      return;
    }

    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch { handlers.current.onError("permission"); return; }

    // Live interim text from the browser recogniser, for feedback only.
    const Ctor = recognitionCtor();
    if (Ctor) {
      try {
        const instance = new Ctor();
        recognition.current = instance;
        instance.lang = lang === "de" ? "de-DE" : "en-GB";
        instance.continuous = true; instance.interimResults = true;
        instance.onresult = event => {
          let interim = "";
          for (let index = event.resultIndex; index < event.results.length; index++) {
            const result = event.results[index];
            if (result.isFinal) browserTranscript.current += result[0].transcript; else interim += result[0].transcript;
          }
          handlers.current.onInterim((browserTranscript.current + interim).trim());
        };
        instance.onerror = () => {}; instance.onend = () => {};
        instance.start();
      } catch { recognition.current = null; }
    }

    const chunks: Blob[] = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "audio/webm";
    const active = new MediaRecorder(stream.current, { mimeType, audioBitsPerSecond: 128000 });
    recorder.current = active;
    active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    active.onstop = async () => {
      setListening(false);
      const spoken = browserTranscript.current.trim();
      teardown();
      if (cancelled.current) return;
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size < 1200) { handlers.current.onError("empty"); return; }
      if (!serverTranscription) { if (spoken) handlers.current.onFinal(spoken); else handlers.current.onError("empty"); return; }
      try {
        const form = new FormData();
        form.set("audio", blob, mimeType.includes("mp4") ? "question.mp4" : "question.webm");
        form.set("language", lang);
        const response = await fetch(`${API}/v1/voice/transcribe`, { method: "POST", headers: authHeaders(), body: form, credentials: "include" });
        if (!response.ok) throw new Error("transcription failed");
        const body = await response.json() as { data?: { transcript?: string } };
        const transcript = body.data?.transcript?.trim();
        if (transcript) handlers.current.onFinal(transcript);
        else if (spoken) handlers.current.onFinal(spoken);
        else handlers.current.onError("empty");
      } catch {
        // Server transcription failed: use whatever the browser heard rather than losing the turn.
        if (spoken) handlers.current.onFinal(spoken); else handlers.current.onError("failed");
      }
    };
    setListening(true);
    active.start(200);
    watchLevels(stream.current, active);
  }, [lang, listening, serverTranscription, teardown, watchLevels]);

  useEffect(() => cancel, [cancel]);
  return { listening, level, start, stop, cancel };
}

// --- output ------------------------------------------------------------------

export interface SpeakerOptions { enabled: boolean; serverVoice: boolean; maxChars: number }

/** Words that end in a period without ending a sentence. */
const ABBREVIATIONS = new Set([
  "bzw", "ca", "ggf", "evtl", "inkl", "exkl", "zzgl", "abzgl", "usw", "vgl", "bspw", "sog", "u", "d", "h", "z", "b",
  "nr", "mio", "mrd", "tsd", "abs", "art", "str", "jhrl", "mtl",
  "eg", "ie", "etc", "vs", "approx", "no", "fig", "cf", "mr", "mrs", "ms", "dr", "prof", "inc", "ltd", "co", "st",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "okt", "nov", "dec", "dez",
]);

/**
 * Splits text into sentences. A terminator only ends a sentence when whitespace
 * follows it and the preceding token is not an abbreviation, so decimals,
 * percentages and phrases like "z. B." stay intact — without this the voice
 * pauses in the middle of a number.
 */
export function sentences(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  let start = 0;
  for (let index = 0; index < flat.length; index++) {
    if (!".!?…".includes(flat[index])) continue;
    let end = index + 1;
    while (end < flat.length && "\"')]".includes(flat[end])) end++;          // closing quote or bracket
    if (end < flat.length && flat[end] !== " ") continue;                     // 2.15% -> not a boundary
    if (/\d$/.test(flat.slice(start, index)) && /^ ?\d/.test(flat.slice(end))) continue; // 1. 500 -> not a boundary
    if (flat[index] === ".") {
      const word = flat.slice(start, index).match(/([\p{L}]+)$/u)?.[1];
      if (word && ABBREVIATIONS.has(word.toLowerCase())) continue;            // bzw. / z. B. / Mio.
    }
    const sentence = flat.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = end;
  }
  const tail = flat.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Splits text into speakable chunks without cutting a sentence or a number in half. */
export function speechChunks(text: string, maxChars: number): string[] {
  const parts = sentences(text);
  const chunks: string[] = [];
  let current = "";
  for (const raw of parts) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length > maxChars) {
      if (current) { chunks.push(current); current = ""; }
      // Break an over-long sentence at clause boundaries, keeping the punctuation
      // with the clause it belongs to so the text reassembles exactly.
      let rest = sentence;
      while (rest.length > maxChars) {
        const window = rest.slice(0, maxChars + 1);
        const clause = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "));
        const space = window.lastIndexOf(" ");
        const at = clause > maxChars * 0.4 ? clause + 1 : space > 0 ? space : maxChars;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) current = rest;
      continue;
    }
    if (!current) current = sentence;
    else if (current.length + sentence.length + 1 <= maxChars) current = `${current} ${sentence}`;
    else { chunks.push(current); current = sentence; }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function useSpeaker(lang: Lang, { enabled, serverVoice, maxChars }: SpeakerOptions) {
  const [speaking, setSpeaking] = useState(false);
  const queue = useRef<string[]>([]);
  const pending = useRef("");
  const playing = useRef(false);
  const cancelled = useRef(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const prefetch = useRef<Promise<Blob | null> | null>(null);
  const serverWorks = useRef<boolean | null>(null);
  const onIdle = useRef<(() => void) | null>(null);
  const chunkSize = Math.max(80, serverVoice ? maxChars : 240);

  const speakSystem = useCallback((text: string) => new Promise<void>(resolve => {
    if (typeof speechSynthesis === "undefined") { resolve(); return; }
    let settled = false;
    const finish = () => { if (!settled) { settled = true; clearInterval(watchdog); resolve(); } };
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const preferred = lang === "de" ? ["Anna", "Helena", "Petra", "Google Deutsch", "Katja", "Vicki"] : ["Samantha", "Ava", "Serena", "Google UK English Female", "Karen", "Moira"];
    utterance.voice = preferred.map(name => voices.find(voice => voice.name.toLowerCase().includes(name.toLowerCase()))).find(Boolean) || voices.find(voice => voice.lang.toLowerCase().startsWith(lang)) || null;
    utterance.lang = lang === "de" ? "de-DE" : "en-GB";
    utterance.onend = finish; utterance.onerror = finish;
    speechSynthesis.speak(utterance);
    // Some browsers never fire onend; poll instead of trusting the event.
    const watchdog = setInterval(() => { if (!speechSynthesis.speaking && !speechSynthesis.pending) finish(); }, 350);
    setTimeout(finish, Math.min(20000, 1500 + text.split(/\s+/).length * 420));
  }), [lang]);

  const fetchAudio = useCallback(async (text: string): Promise<Blob | null> => {
    if (!serverVoice || serverWorks.current === false) return null;
    try {
      const response = await fetch(`${API}/v1/voice/synthesize`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, credentials: "include", body: JSON.stringify({ text, language: lang }) });
      if (!response.ok) { if (response.status === 422) serverWorks.current = false; return null; }
      serverWorks.current = true;
      return await response.blob();
    } catch { return null; }
  }, [lang, serverVoice]);

  const play = useCallback((blob: Blob) => new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const element = new Audio(url);
    audio.current = element;
    element.onended = () => { URL.revokeObjectURL(url); resolve(); };
    element.onerror = () => { URL.revokeObjectURL(url); reject(new Error("playback failed")); };
    element.play().catch(reject);
  }), []);

  /** Plays the queue, fetching the next chunk while the current one is speaking. */
  const drain = useCallback(async () => {
    if (playing.current) return;
    playing.current = true; setSpeaking(true);
    while (queue.current.length && !cancelled.current) {
      const text = queue.current.shift()!;
      const clip = prefetch.current ? await prefetch.current.catch(() => null) : await fetchAudio(text);
      prefetch.current = queue.current.length ? fetchAudio(queue.current[0]) : null;
      if (cancelled.current) break;
      if (clip) { try { await play(clip); } catch { await speakSystem(text); } }
      else await speakSystem(text);
    }
    prefetch.current = null;
    playing.current = false; setSpeaking(false);
    if (!cancelled.current) onIdle.current?.();
  }, [fetchAudio, play, speakSystem]);

  /** Feed streamed text; complete chunks are spoken as soon as they are whole. */
  const feed = useCallback((delta: string) => {
    if (!enabled) return;
    cancelled.current = false;
    pending.current += delta;
    // Emit only whole sentences, so prosody stays natural and decimals stay intact.
    const parts = sentences(pending.current);
    if (parts.length < 2) return;
    const complete = parts.slice(0, -1).join(" ");
    if (complete.length < 40 && complete.length < chunkSize) return;
    pending.current = parts[parts.length - 1];
    for (const chunk of speechChunks(complete, chunkSize)) queue.current.push(chunk);
    if (queue.current.length) void drain();
  }, [chunkSize, drain, enabled]);

  const flush = useCallback(() => {
    if (!enabled) { onIdle.current?.(); return; }
    const rest = pending.current.trim();
    pending.current = "";
    if (rest.length > 1) for (const chunk of speechChunks(rest, chunkSize)) queue.current.push(chunk);
    if (queue.current.length) void drain();
    else if (!playing.current) onIdle.current?.();
  }, [chunkSize, drain, enabled]);

  const stop = useCallback(() => {
    cancelled.current = true;
    queue.current = []; pending.current = ""; prefetch.current = null;
    audio.current?.pause(); audio.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    playing.current = false; setSpeaking(false);
  }, []);

  const setOnIdle = useCallback((handler: (() => void) | null) => { onIdle.current = handler; }, []);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => { if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices(); }, []);
  return { speaking, feed, flush, stop, setOnIdle };
}
