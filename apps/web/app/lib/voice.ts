"use client";
/**
 * Voice input and output.
 *
 * Input prefers the browser's SpeechRecognition (live interim text, no upload);
 * otherwise it records with MediaRecorder and sends the clip for transcription.
 * Output speaks sentence by sentence as the answer streams in, and stops the
 * moment the person starts talking again (barge-in).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "@fintwin/contracts";
import { API } from "./api";

type RecognitionResultEvent = { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
interface Recognition { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: RecognitionResultEvent) => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null; onspeechstart: (() => void) | null }
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechInputSupported(): boolean {
  return Boolean(recognitionCtor()) || (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined");
}

export interface SpeechInputOptions { lang: Lang; onInterim(text: string): void; onFinal(text: string): void; onSpeechStart?(): void; onError(kind: "permission" | "unsupported" | "empty" | "failed"): void }

export function useSpeechInput({ lang, onInterim, onFinal, onSpeechStart, onError }: SpeechInputOptions) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const handlers = useRef({ onInterim, onFinal, onSpeechStart, onError });
  handlers.current = { onInterim, onFinal, onSpeechStart, onError };

  const stop = useCallback(() => {
    if (recognition.current) { try { recognition.current.stop(); } catch { /* already stopped */ } }
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const cancel = useCallback(() => {
    if (recognition.current) { try { recognition.current.abort(); } catch { /* ignore */ } recognition.current = null; }
    if (recorder.current?.state === "recording") { recorder.current.ondataavailable = null; recorder.current.onstop = null; recorder.current.stop(); }
    stream.current?.getTracks().forEach(track => track.stop());
    setListening(false);
  }, []);

  const startRecorder = useCallback(async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch { handlers.current.onError("permission"); return; }
    const chunks: Blob[] = [];
    const active = new MediaRecorder(stream.current, { mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm" });
    recorder.current = active;
    active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    active.onstop = async () => {
      setListening(false);
      stream.current?.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: active.mimeType });
      if (blob.size < 500) { handlers.current.onError("empty"); return; }
      try {
        const form = new FormData(); form.set("audio", blob, "question.webm"); form.set("language", lang);
        const response = await fetch(`${API}/v1/voice/transcribe`, { method: "POST", body: form, credentials: "include" });
        if (!response.ok) throw new Error();
        const body = await response.json() as { data?: { transcript?: string } };
        const transcript = body.data?.transcript?.trim();
        if (!transcript) { handlers.current.onError("empty"); return; }
        handlers.current.onFinal(transcript);
      } catch { handlers.current.onError("failed"); }
    };
    setListening(true);
    handlers.current.onSpeechStart?.();
    active.start(250);
    // Auto-stop after silence is not available without analysis; cap at 20s.
    setTimeout(() => { if (active.state === "recording") active.stop(); }, 20000);
  }, [lang]);

  const start = useCallback(async () => {
    if (listening) return;
    const Ctor = recognitionCtor();
    if (!Ctor) {
      if (typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined") await startRecorder();
      else handlers.current.onError("unsupported");
      return;
    }
    const instance = new Ctor();
    recognition.current = instance;
    instance.lang = lang === "de" ? "de-DE" : "en-GB";
    instance.continuous = false;
    instance.interimResults = true;
    let finalText = "", gotSpeech = false;
    instance.onspeechstart = () => { gotSpeech = true; handlers.current.onSpeechStart?.(); };
    instance.onresult = event => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript; else interim += result[0].transcript;
      }
      if (!gotSpeech && (interim || finalText)) { gotSpeech = true; handlers.current.onSpeechStart?.(); }
      handlers.current.onInterim((finalText + interim).trim());
    };
    instance.onerror = event => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") handlers.current.onError("permission");
      else if (event.error === "no-speech") handlers.current.onError("empty");
      else if (event.error !== "aborted") handlers.current.onError("failed");
    };
    instance.onend = () => {
      setListening(false);
      recognition.current = null;
      const text = finalText.trim();
      if (text) handlers.current.onFinal(text);
    };
    try { instance.start(); setListening(true); } catch { handlers.current.onError("failed"); }
  }, [lang, listening, startRecorder]);

  useEffect(() => cancel, [cancel]);
  return { listening, start, stop, cancel };
}

// --- output ------------------------------------------------------------------

export function useSpeaker(lang: Lang, enabled: boolean, serverAvailable = false) {
  const [speaking, setSpeaking] = useState(false);
  const queue = useRef<string[]>([]);
  const playing = useRef(false);
  const cancelled = useRef(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const pending = useRef("");
  const onIdle = useRef<(() => void) | null>(null);
  const serverVoice = useRef<boolean | null>(null);

  const speakSystem = useCallback((text: string) => new Promise<void>(resolve => {
    if (typeof speechSynthesis === "undefined") { resolve(); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const preferred = lang === "de" ? ["Anna", "Helena", "Petra", "Google Deutsch", "Katja", "Vicki"] : ["Samantha", "Ava", "Serena", "Google UK English Female", "Karen", "Moira"];
    utterance.voice = preferred.map(name => voices.find(voice => voice.name.toLowerCase().includes(name.toLowerCase()))).find(Boolean) || voices.find(voice => voice.lang.toLowerCase().startsWith(lang)) || null;
    utterance.lang = lang === "de" ? "de-DE" : "en-GB";
    utterance.rate = 1; utterance.pitch = 1;
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    let started = false;
    utterance.onstart = () => { started = true; };
    utterance.onend = finish; utterance.onerror = finish;
    setTimeout(() => { if (!started) finish(); }, 1200);
    // Some browsers never fire onend (no usable voice); never let that block the conversation.
    setTimeout(finish, Math.min(12000, 800 + text.split(/\s+/).length * 420));
    speechSynthesis.speak(utterance);
    const watchdog = setInterval(() => { if (settled) { clearInterval(watchdog); return; } if (!speechSynthesis.speaking && !speechSynthesis.pending) { clearInterval(watchdog); finish(); } }, 400);
  }), [lang]);

  const speakServer = useCallback(async (text: string): Promise<boolean> => {
    if (lang !== "en" || !serverAvailable || serverVoice.current === false) return false;
    try {
      const response = await fetch(`${API}/v1/voice/synthesize`, { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ text, language: lang }) });
      if (!response.ok) { serverVoice.current = false; return false; }
      serverVoice.current = true;
      const url = URL.createObjectURL(await response.blob());
      await new Promise<void>((resolve, reject) => {
        const element = new Audio(url); audio.current = element;
        element.onended = () => { URL.revokeObjectURL(url); resolve(); };
        element.onerror = () => { URL.revokeObjectURL(url); reject(new Error("audio")); };
        element.play().catch(reject);
      });
      return true;
    } catch { return false; }
  }, [lang, serverAvailable]);

  const drain = useCallback(async () => {
    if (playing.current) return;
    playing.current = true; setSpeaking(true);
    while (queue.current.length && !cancelled.current) {
      const sentence = queue.current.shift()!;
      const done = await speakServer(sentence);
      if (!done && !cancelled.current) await speakSystem(sentence);
    }
    playing.current = false; setSpeaking(false);
    onIdle.current?.();
  }, [speakServer, speakSystem]);

  /** Feed streamed text; complete sentences are spoken as they arrive. */
  const feed = useCallback((delta: string) => {
    if (!enabled) return;
    cancelled.current = false;
    pending.current += delta;
    const parts = pending.current.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9€])/);
    while (parts.length > 1) { const sentence = parts.shift()!.trim(); if (sentence.length > 1) queue.current.push(sentence); }
    pending.current = parts[0] ?? "";
    if (queue.current.length) void drain();
  }, [drain, enabled]);

  const flush = useCallback(() => {
    if (!enabled) return;
    const rest = pending.current.trim(); pending.current = "";
    if (rest.length > 1) queue.current.push(rest);
    if (queue.current.length) void drain(); else onIdle.current?.();
  }, [drain, enabled]);

  const stop = useCallback(() => {
    cancelled.current = true;
    queue.current = []; pending.current = "";
    audio.current?.pause(); audio.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    playing.current = false; setSpeaking(false);
  }, []);

  const setOnIdle = useCallback((handler: (() => void) | null) => { onIdle.current = handler; }, []);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => { if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices(); }, []);
  return { speaking, feed, flush, stop, setOnIdle };
}
