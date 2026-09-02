"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AudioLines, CircleAlert, Mic, MicOff, Send, Sparkles, Square, Volume2, VolumeX } from "lucide-react";
import type { AppState, Card, Lang, Message } from "@fintwin/contracts";
import { chat } from "../lib/api";
import { metricValue, timeOfDay } from "../lib/format";
import { copy } from "../lib/i18n";
import { speechInputSupported, useSpeechInput, useSpeaker } from "../lib/voice";
import { CardView } from "./Cards";

export interface ChatHandle { send(text: string): void }

interface ChatProps {
  state: AppState;
  lang: Lang;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  applyState(state: AppState): void;
  registerSend(send: (text: string) => void): void;
  onOpenPicture(): void;
}

/** A message that is still streaming in. */
interface Live { id: string; text: string; cards: Card[] }

export function Chat({ state, lang, messages, setMessages, applyState, registerSend, onOpenPicture }: ChatProps) {
  const t = copy(lang);
  const [input, setInput] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [handsFree, setHandsFree] = useState(false);
  const [interim, setInterim] = useState("");
  const abort = useRef<(() => void) | null>(null);
  const threadEnd = useRef<HTMLDivElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const handsFreeRef = useRef(false);
  const busy = useRef(false);

  const voiceOn = state.profile?.voiceAutoplay ?? true;
  const speaker = useSpeaker(lang, voiceOn, state.ai.voice);
  const { speaking, feed, flush, stop: stopSpeaking, setOnIdle } = speaker;

  const send = useCallback((text: string, mode: "text" | "voice" = "text") => {
    const trimmed = text.trim();
    if (!trimmed || busy.current) return;
    busy.current = true;
    stopSpeaking();
    setError(""); setInput(""); setInterim("");
    setMessages(current => [...current, { id: `local-${Date.now()}`, role: "user", text: trimmed, cards: [], mode: mode === "voice" ? "voice" : undefined, createdAt: new Date().toISOString() }]);
    setThinking(true);
    abort.current = chat(trimmed, lang, mode, {
      onStart: messageId => { setThinking(false); setLive({ id: messageId, text: "", cards: [] }); },
      onDelta: delta => { setLive(current => current ? { ...current, text: current.text + delta } : { id: "stream", text: delta, cards: [] }); feed(delta); },
      onCard: card => setLive(current => current ? { ...current, cards: [...current.cards, card] } : current),
      onState: next => applyState(next),
      onDone: message => {
        setLive(null); setThinking(false); busy.current = false; abort.current = null;
        setMessages(current => [...current, message]);
        flush();
      },
      onError: message => {
        setLive(null); setThinking(false); busy.current = false; abort.current = null;
        setError(message || t.errors.chat);
        handsFreeRef.current = false; setHandsFree(false);
      },
    });
  }, [applyState, feed, flush, lang, setMessages, stopSpeaking, t.errors.chat]);

  useEffect(() => { registerSend(send); }, [registerSend, send]);

  const speech = useSpeechInput({
    lang,
    onInterim: setInterim,
    onSpeechStart: () => stopSpeaking(),
    onFinal: text => { setInterim(""); send(text, "voice"); },
    onError: kind => {
      setInterim("");
      if (kind === "empty") { if (handsFreeRef.current) { handsFreeRef.current = false; setHandsFree(false); } return; }
      setError(kind === "unsupported" ? t.errors.unsupported : t.errors.mic);
      handsFreeRef.current = false; setHandsFree(false);
    },
  });

  // Hands-free: when FinTwin finishes speaking, start listening again.
  useEffect(() => {
    setOnIdle(() => { if (handsFreeRef.current && !busy.current) setTimeout(() => { if (handsFreeRef.current) void speech.start(); }, 250); });
    return () => setOnIdle(null);
  }, [setOnIdle, speech]);

  function toggleHandsFree() {
    if (handsFreeRef.current) { handsFreeRef.current = false; setHandsFree(false); speech.cancel(); stopSpeaking(); return; }
    handsFreeRef.current = true; setHandsFree(true); stopSpeaking(); void speech.start();
  }

  function stopEverything() { abort.current?.(); abort.current = null; busy.current = false; setThinking(false); setLive(null); stopSpeaking(); speech.cancel(); handsFreeRef.current = false; setHandsFree(false); }

  useLayoutEffect(() => { threadEnd.current?.scrollIntoView({ behavior: messages.length > 2 ? "smooth" : "auto", block: "end" }); }, [messages, live?.text, thinking]);
  useEffect(() => { const node = textarea.current; if (!node) return; node.style.height = "auto"; node.style.height = `${Math.min(160, node.scrollHeight)}px`; }, [input]);

  const last = messages.at(-1);
  const suggestions = !live && !thinking && last?.role === "assistant" ? last.suggestions ?? [] : [];
  const canSpeak = speechInputSupported();
  const strip = state.picture.metrics.filter(metric => ["net_worth", "free_cashflow", "runway"].includes(metric.key));

  return <div className="chat">
    <div className="thread" role="log" aria-live="polite" aria-label={t.tabs.chat} tabIndex={0}>
      {messages.map((message, index) => <MessageView key={message.id} message={message} lang={lang} showTime={index === 0 || new Date(message.createdAt).getTime() - new Date(messages[index - 1].createdAt).getTime() > 30 * 60_000} />)}
      {live && (live.text || live.cards.length > 0) && <div className="msg"><span className="who"><Sparkles /></span><div className="body">
        {live.text && <p>{live.text}<span className="caret" /></p>}
        {live.cards.map((card, index) => <CardView card={card} lang={lang} key={index} />)}
      </div></div>}
      {(thinking || (live && !live.text)) && <div className="msg"><span className="who"><Sparkles /></span><div className="body"><div className="typing" aria-label={t.thinking}><i /><i /><i /></div></div></div>}
      {error && <div className="error-line"><CircleAlert size={15} />{error}</div>}
      <div ref={threadEnd} />
      {strip.some(metric => metric.value !== null) && <div className="picture-strip">{strip.map(metric => <button key={metric.key} onClick={onOpenPicture}><small>{metric.label[lang]}</small><strong className="num">{metricValue(metric.value, metric.unit, lang)}</strong></button>)}</div>}
    </div>

    <div className="composer-wrap">
      {handsFree && <div className={`voice-banner ${speech.listening ? "" : "quiet"}`}><span className="wave" aria-hidden><i /><i /><i /><i /><i /></span>
        <span>{speech.listening ? t.listening : speaking ? t.speaking : t.thinking}{interim ? ` — ${interim}` : ""}</span>
        <button onClick={toggleHandsFree}>{t.handsFreeOn}</button></div>}
      {suggestions.length > 0 && <div className="suggestions">{suggestions.map(suggestion => <button key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div>}
      <form className="composer" onSubmit={event => { event.preventDefault(); send(input); }}>
        <button type="button" className={`icon-btn mic ${speech.listening ? "on" : ""}`} onClick={() => speech.listening ? speech.stop() : void speech.start()} aria-label={speech.listening ? t.stopMic : t.mic} disabled={!canSpeak}>{speech.listening ? <MicOff /> : <Mic />}</button>
        <textarea ref={textarea} rows={1} value={speech.listening && interim ? interim : input} onChange={event => setInput(event.target.value)} placeholder={speech.listening ? t.listening : t.placeholder} aria-label={t.placeholder}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(input); } }} />
        {thinking || live || speaking ? <button type="button" className="icon-btn send stop" onClick={stopEverything} aria-label={t.stopSpeaking}><Square /></button>
          : <button type="submit" className="icon-btn send" disabled={!input.trim()} aria-label={t.send}><Send /></button>}
      </form>
      <div className="status-line">
        <span><i className={`mode-dot ${state.ai.live ? "live" : ""}`} /> {state.ai.live ? t.live : t.offline}</span>
        {canSpeak && <button className={handsFree ? "on" : ""} onClick={toggleHandsFree}><AudioLines />{handsFree ? t.handsFreeOn : t.handsFree}</button>}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{voiceOn ? <Volume2 size={13} /> : <VolumeX size={13} />}</span>
        <span style={{ flex: 1 }} />
        <span>{t.disclaimer}</span>
      </div>
    </div>
  </div>;
}

function MessageView({ message, lang, showTime }: { message: Message; lang: Lang; showTime: boolean }) {
  const t = copy(lang);
  if (message.role === "system") return message.cards.length ? <div className="msg system"><div className="body">{message.cards.map((card, index) => <CardView card={card} lang={lang} key={index} />)}</div></div> : null;
  if (message.role === "user") return <div className="msg user"><div className="body"><p>{message.text}</p>{showTime && <span className="meta">{message.mode === "voice" && <Mic />}{timeOfDay(message.createdAt, lang)}</span>}</div></div>;
  return <div className="msg"><span className="who"><Sparkles aria-hidden /></span><div className="body">
    {message.text && <p>{message.text}</p>}
    {message.cards.map((card, index) => <CardView card={card} lang={lang} key={index} />)}
    {showTime && <time>{timeOfDay(message.createdAt, lang)}{message.mode === "offline" ? ` · ${t.offline}` : ""}</time>}
  </div></div>;
}
