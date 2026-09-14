"use client";
/**
 * Voice input and output.
 *
 * Input: always records audio and sends it to the server for transcription,
 * with one capture owner. Browser recognition is a separate fallback, never
 * a second simultaneous microphone session. Recording ends on silence.
 *
 * Output: splits the reply into chunks sized to whatever the speech provider
 * accepts. Playback errors are visible; a blocked clip can be resumed without
 * making another provider request. Any interruption stops it immediately.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "@fintwin/contracts";
import { API, authHeaders } from "./api";
import { VoiceAudioPlayer } from './voice-playback';
import { SpeechGate } from './speech-gate';
import { playSpeechQueue } from './speech-queue';
import {microphoneError,transcriptionError,type SpeechInputError} from './voice-input';

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
  deviceId?:string;
  onInterim(text: string): void;
  onFinal(text: string): void;
  onSpeechStart?(): void;
  onError(kind: SpeechInputError): void;
}

export const SILENCE_MS = 800; // leave room for a natural pause without a 1.2s tail
const MIN_SPEECH_MS = 400;    // ignore stray clicks
const MAX_TURN_MS = 45_000;   // hard ceiling

export function useSpeechInput({lang,serverTranscription,deviceId,onInterim,onFinal,onSpeechStart,onError}:SpeechInputOptions){
  const [listening,setListening]=useState(false),[level,setLevel]=useState(0);
  const [phase,setPhase]=useState<'idle'|'requesting'|'listening'|'transcribing'>('idle');
  const owner=useRef<{generation:number;media?:MediaStream;recorder?:MediaRecorder;recognition?:Recognition;context?:AudioContext;frame?:number;abort:AbortController}|null>(null);
  const generation=useRef(0),handlers=useRef({onInterim,onFinal,onSpeechStart,onError});handlers.current={onInterim,onFinal,onSpeechStart,onError};
  const cancel=useCallback(()=>{
    generation.current++;const current=owner.current;owner.current=null;
    current?.abort.abort();if(current?.frame)cancelAnimationFrame(current.frame);
    if(current?.recorder){current.recorder.onstop=null;if(current.recorder.state==='recording')current.recorder.stop();}
    current?.media?.getTracks().forEach(t=>t.stop());void current?.context?.close().catch(()=>{});
    if(current?.recognition){current.recognition.onend=null;try{current.recognition.abort();}catch{}}
    setListening(false);setLevel(0);setPhase('idle');
  },[]);
  const stop=useCallback(()=>{const c=owner.current;if(c?.recorder?.state==='recording')c.recorder.stop();else c?.recognition?.stop();},[]);
  const start=useCallback(async()=>{
    cancel();const gen=generation.current,current={generation:gen,abort:new AbortController()} as NonNullable<typeof owner.current>;owner.current=current;
    setPhase('requesting');
    const valid=()=>owner.current===current && generation.current===gen && !current.abort.signal.aborted;
    if(!serverTranscription){
      const Ctor=recognitionCtor();if(!Ctor){handlers.current.onError('unsupported');cancel();return;}
      const instance=new Ctor();current.recognition=instance;instance.lang=lang==='de'?'de-DE':'en-GB';instance.continuous=false;instance.interimResults=true;
      let finalText='';
      instance.onspeechstart=()=>{if(valid())handlers.current.onSpeechStart?.();};
      instance.onresult=e=>{if(!valid())return;let interim='';for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)finalText+=e.results[i][0].transcript;else interim+=e.results[i][0].transcript;}handlers.current.onInterim((finalText+interim).trim());};
      instance.onerror=e=>{if(valid())handlers.current.onError(e.error==='not-allowed'?'permission':e.error==='no-speech'?'empty':'failed');};
      instance.onend=()=>{if(!valid())return;const text=finalText.trim();cancel();if(text)handlers.current.onFinal(text);};
      try{instance.start();setListening(true);setPhase('listening');}catch{cancel();handlers.current.onError('failed');}return;
    }
    if(!canRecord()){cancel();handlers.current.onError('unsupported');return;}
    try{
      const media=await navigator.mediaDevices.getUserMedia({audio:{...(deviceId?{deviceId:{exact:deviceId}}:{}),echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(!valid()){media.getTracks().forEach(t=>t.stop());return;}current.media=media;
      const supportedType=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
      const recorder=new MediaRecorder(media,{...(supportedType?{mimeType:supportedType}:{}),audioBitsPerSecond:64000});current.recorder=recorder;
      const mimeType=recorder.mimeType||supportedType||'audio/webm';
      const gate=new SpeechGate();
      const chunks:Blob[]=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onstop=async()=>{
        if(!valid())return;setListening(false);setLevel(0);if(current.frame)cancelAnimationFrame(current.frame);
        media.getTracks().forEach(t=>t.stop());void current.context?.close().catch(()=>{});
        const blob=new Blob(chunks,{type:mimeType});if(!gate.hasSpeech||blob.size<400){handlers.current.onError('empty');cancel();return;}
        setPhase('transcribing');
        try{const form=new FormData();form.set('audio',blob,mimeType.includes('mp4')?'question.mp4':mimeType.includes('ogg')?'question.ogg':'question.webm');form.set('language',lang);
          const response=await fetch(`${API}/v1/voice/transcribe`,{method:'POST',headers:authHeaders(),body:form,credentials:'include',signal:AbortSignal.any([current.abort.signal,AbortSignal.timeout(20000)])});
          const body=await response.json().catch(()=>({}));if(!valid())return;
          if(!response.ok||body.ok===false){cancel();handlers.current.onError(transcriptionError(body.code,response.status));return;}
          const text=body.data?.transcript?.trim();cancel();if(text)handlers.current.onFinal(text);else handlers.current.onError('empty');
        }catch(error){if(valid()){cancel();handlers.current.onError((error as Error).name==='TimeoutError'?'timeout':'failed');}}
      };
      const context=new AudioContext();current.context=context;const analyser=context.createAnalyser();analyser.fftSize=1024;context.createMediaStreamSource(media).connect(analyser);
      await context.resume();if(!valid())return;
      const samples=new Uint8Array(analyser.fftSize),started=Date.now();let heard=false,lastVoice=started;
      const tick=()=>{if(!valid()||recorder.state!=='recording')return;analyser.getByteTimeDomainData(samples);let sum=0;for(const n of samples)sum+=((n-128)/128)**2;const rms=Math.sqrt(sum/samples.length),now=Date.now();setLevel(Math.min(1,rms*6));
        gate.sample(rms,now);
        if(rms>.022){if(!heard)handlers.current.onSpeechStart?.();heard=true;lastVoice=now;}
        if((heard&&now-lastVoice>SILENCE_MS&&now-started>MIN_SPEECH_MS)||(!heard&&now-started>6000)||now-started>MAX_TURN_MS){recorder.stop();return;}current.frame=requestAnimationFrame(tick);
      };
      recorder.start(200);setListening(true);setPhase('listening');tick();
    }catch(error){if(valid()){cancel();handlers.current.onError(microphoneError(error));}}
  },[cancel,lang,serverTranscription,deviceId]);
  useEffect(()=>cancel,[cancel,lang]);return{listening,phase,level,start,stop,cancel};
}

// --- output ------------------------------------------------------------------

export interface SpeakerOptions { enabled: boolean; serverVoice: boolean; maxChars: number }
export type VoiceError = 'terms' | 'billing' | 'auth' | 'autoplay' | 'budget' | 'failed' | 'unsupported' | null;

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

/** Start with one short sentence, then larger clips. Never speak speculative
 * model deltas: only the completed answer reaches this queue. */
export function replySpeechChunks(text: string, maxChars: number): string[] {
  const parts = sentences(text);
  if (!parts.length) return [];
  const first = speechChunks(parts[0], Math.min(maxChars, 180));
  return [first[0], ...speechChunks([...first.slice(1), ...parts.slice(1)].join(' '), Math.min(maxChars, 400))];
}

export function useSpeaker(lang:Lang,{enabled,serverVoice,maxChars}:SpeakerOptions){
  const [speaking,setSpeaking]=useState(false),queue=useRef<string[]>([]),pending=useRef(''),generation=useRef(0),playing=useRef(false);
  const [voiceError,setVoiceError]=useState<VoiceError>(null);
  const player=useRef<VoiceAudioPlayer|null>(null);
  if(!player.current)player.current=new VoiceAudioPlayer(()=>setVoiceError('autoplay'),()=>setVoiceError(null));
  const request=useRef<AbortController|null>(null),cleanup=useRef<(()=>void)|null>(null),onIdle=useRef<(()=>void)|null>(null);
  const stop=useCallback(()=>{generation.current++;request.current?.abort();request.current=null;player.current?.stop();cleanup.current?.();cleanup.current=null;queue.current=[];pending.current='';playing.current=false;setSpeaking(false);setVoiceError(null);if(typeof speechSynthesis!=='undefined')speechSynthesis.cancel();},[]);
  const prepare=useCallback(()=>{if(serverVoice)player.current?.prepare();},[serverVoice]);
  const resume=useCallback(()=>player.current?.resume(),[]);
  const drain=useCallback(async()=>{
    if(playing.current)return;const gen=generation.current;playing.current=true;setSpeaking(true);
    let failed=false;
    while(queue.current.length&&gen===generation.current){
      if(serverVoice){
        const controller=new AbortController();request.current=controller;
        const chunks=queue.current.splice(0);
        try{
          await playSpeechQueue(chunks,controller.signal,async(text,signal)=>{
            const response=await fetch(`${API}/v1/voice/synthesize`,{method:'POST',credentials:'include',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({text,language:lang}),signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
            if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.code==='voice_terms_required'?'terms':body.code==='openai_billing_required'?'billing':body.code==='provider_auth_failed'?'auth':body.code==='budget_exhausted'?'budget':'failed');}
            return response;
          },(response,signal)=>player.current!.playResponse(response,signal));
        }catch(error){if(gen===generation.current){const code=(error as Error).message;setVoiceError(['terms','billing','auth','budget'].includes(code)?code as VoiceError:'failed');}failed=true;}
        if(request.current===controller)request.current=null;
        if(failed)break;
        continue;
      }
      const text=queue.current.shift()!;
      if(typeof speechSynthesis!=='undefined'){
        await new Promise<void>(resolve=>{
          const utterance=new SpeechSynthesisUtterance(text);utterance.lang=lang==='de'?'de-DE':'en-GB';
          const voices=speechSynthesis.getVoices(),names=lang==='de'?['Anna','Katja','Google Deutsch']:['Samantha','Ava','Google UK English Female'];
          utterance.voice=names.map(name=>voices.find(v=>v.name.includes(name))).find(Boolean)??voices.find(v=>v.lang.startsWith(lang))??null;
          const timer=setTimeout(()=>{failed=true;if(gen===generation.current)setVoiceError('failed');finish();},Math.min(45000,4000+text.split(/\s+/).length*700));let finished=false;
          const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);utterance.onend=null;utterance.onerror=null;if(cleanup.current===finish)cleanup.current=null;resolve();};
          cleanup.current=finish;utterance.onend=finish;utterance.onerror=()=>{failed=true;if(gen===generation.current)setVoiceError('failed');finish();};speechSynthesis.speak(utterance);
        });
        if(failed)break;
      }else{failed=true;setVoiceError('unsupported');break;}
    }
    if(gen===generation.current){queue.current=[];playing.current=false;setSpeaking(false);if(!failed)onIdle.current?.();}
  },[lang,serverVoice]);
  const feed=useCallback((text:string)=>{if(enabled)pending.current+=text;},[enabled]);
  const flush=useCallback(()=>{
    if(!enabled){onIdle.current?.();return;}
    queue.current.push(...replySpeechChunks(pending.current,Math.max(80,serverVoice?maxChars:240)));pending.current='';void drain();
  },[enabled,serverVoice,maxChars,drain]);
  const setOnIdle=useCallback((handler:(()=>void)|null)=>{onIdle.current=handler;},[]);
  const speakNow=useCallback((text:string)=>{stop();prepare();queue.current=replySpeechChunks(text,Math.max(80,serverVoice?maxChars:240));void drain();},[stop,prepare,serverVoice,maxChars,drain]);
  useEffect(()=>stop,[stop,lang]);return{speaking,feed,flush,stop,setOnIdle,voiceError,prepare,resume,speakNow};
}
