"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AudioLines, CircleAlert, Mic, MicOff, Send, Sparkles, Square, Volume2, VolumeX } from "lucide-react";
import type { AppState, Card, Lang, Message } from "@fintwin/contracts";
import { api, chat } from "../lib/api";
import { metricValue, timeOfDay } from "../lib/format";
import { copy } from "../lib/i18n";
import { speechInputSupported, useSpeechInput, useSpeaker } from "../lib/voice";
import { CardView } from "./Cards";
import {RealtimeVoice} from './RealtimeVoice';
import {ChainedVoice} from './ChainedVoice';
import {inputErrorMessage} from '../lib/voice-input';
import type {RealtimeClient,VoiceEvent} from '../lib/realtime';

export interface ChatHandle { send(text: string): void }

interface ChatProps {
  state: AppState;
  lang: Lang;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  applyState(state: AppState): void;
  registerSend(send: (text: string,scenarioId?:string) => void): void;
  scenarioId?:string;
  onOpenPicture(): void;
  onLoadSample(): void;
}

/** A message that is still streaming in. */
interface Live { id: string; text: string; cards: Card[] }

export function Chat({ state, lang, messages, setMessages, applyState, registerSend, onOpenPicture, onLoadSample, scenarioId }: ChatProps) {
  const t = copy(lang);
  const [input, setInput] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [handsFree, setHandsFree] = useState(false);
  const [interim, setInterim] = useState("");
  const [inputError,setInputError]=useState('');
  const [microphone,setMicrophone]=useState('');
  useEffect(()=>{try{setMicrophone(localStorage.getItem('fintwin-microphone')??'');}catch{/* optional preference */}},[]);
  const abort = useRef<(() => void) | null>(null);
  const threadEnd = useRef<HTMLDivElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const handsFreeRef = useRef(false);
  const cancelCapture=useRef<()=>void>(()=>{});
  const busy = useRef(false);
  const generation=useRef(0);
  const thread=useRef<HTMLDivElement|null>(null);
  const [atLatest,setAtLatest]=useState(true);
  const realtime=useRef<RealtimeClient|null>(null);
  const [realtimeActive,setRealtimeActive]=useState(false);

  const voiceOn = (handsFree || (state.profile?.voiceAutoplay ?? true)) && state.ai.realtime.mode !== 'text' && !state.ai.realtime.available;
  const speaker = useSpeaker(lang, { enabled: voiceOn, serverVoice: state.ai.voice && (state.ai.speechOut.multilingual || lang === "en"), maxChars: state.ai.speechOut.maxChars });
  const { speaking, feed, flush, stop: stopSpeaking, setOnIdle, voiceError, prepare, resume, speakNow } = speaker;

  const send = useCallback((text: string, mode: "text" | "voice" = "text", selectedScenario?:string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if(mode==='text'){cancelCapture.current();handsFreeRef.current=false;setHandsFree(false);}
    setAtLatest(true);
    if(/^(?:load|show|open|connect)?\s*(?:the )?(?:sample(?: data| household| bank(?: account)?)?|demo(?: data| bank(?: account)?)?)$|^(?:Beispieldaten laden|Beispielhaushalt erkunden|Demo laden)$/i.test(trimmed)){setInput('');onLoadSample();return;}
    if(!selectedScenario&&scenarioId&&/this scenario|previous scenario|dieses szenario|vorherigen szenario/i.test(trimmed))selectedScenario=scenarioId;
    if(realtime.current && !selectedScenario){setInput('');setError('');void realtime.current.text(trimmed).catch(()=>setError(lang==='de'?'Die Sprachverbindung ist noch nicht bereit. Beenden Sie sie, um weiter zu schreiben.':'Voice is not ready. End voice to continue in text.'));return;}
    if(realtime.current){void realtime.current.end();realtime.current=null;}
    abort.current?.();const gen=++generation.current;
    busy.current = true;
    stopSpeaking();
    prepare();
    setError(""); setInput(""); setInterim("");
    setMessages(current => [...current, { id: `local-${Date.now()}`, role: "user", text: trimmed, cards: [], mode: mode === "voice" ? "voice" : undefined, createdAt: new Date().toISOString() }]);
    setThinking(true);
    abort.current = chat(trimmed, lang, mode, {
      onStart: messageId => { if(gen!==generation.current)return;setThinking(false); setLive({ id: messageId, text: "", cards: [] }); },
      onDelta: delta => {if(gen!==generation.current)return; setLive(current => current ? { ...current, text: current.text + delta } : { id: "stream", text: delta, cards: [] }); },
      onCard: card => {if(gen===generation.current)setLive(current => current ? { ...current, cards: [...current.cards, card] } : current);},
      onState: next => {if(gen===generation.current)applyState(next);},
      onReplace:text=>{if(gen!==generation.current)return;stopSpeaking();setLive(current=>current?{...current,text}:null);},
      onDone: message => {
        if(gen!==generation.current)return;
        setLive(null); setThinking(false); busy.current = false; abort.current = null;
        setMessages(current => [...current, message]);
        feed(message.text);flush();
      },
      onError: message => {
        if(gen!==generation.current)return;
        setLive(null); setThinking(false); busy.current = false; abort.current = null;
        setError(message || t.errors.chat);
        handsFreeRef.current = false; setHandsFree(false);
      },
      onFinally:()=>{if(gen!==generation.current)return;busy.current=false;abort.current=null;setThinking(false);setLive(null);},
    },selectedScenario);
  }, [applyState, feed, flush, lang, setMessages, stopSpeaking, prepare, t.errors.chat,scenarioId,onLoadSample]);

  useEffect(() => { registerSend((text,id)=>send(text,'text',id)); }, [registerSend, send]);
  useEffect(()=>()=>{generation.current++;abort.current?.();void realtime.current?.end('navigation');},[]);

  const speech = useSpeechInput({
    lang,
    deviceId:microphone,
    serverTranscription: state.ai.speechIn.provider !== "none",
    onInterim: setInterim,
    onSpeechStart: () => stopSpeaking(),
    onFinal: text => { setInterim(""); send(text, "voice"); },
    onError: kind => {
      setInterim("");
      setInputError(inputErrorMessage(kind,lang));
      handsFreeRef.current = false; setHandsFree(false);
    },
  });

  // Hands-free: when FinTwin finishes speaking, start listening again.
  const cancelSpeech=speech.cancel;
  cancelCapture.current=cancelSpeech;
  useEffect(()=>{if(voiceError){handsFreeRef.current=false;setHandsFree(false);cancelSpeech();}},[voiceError,cancelSpeech]);
  useEffect(() => {
    setOnIdle(() => { if (handsFreeRef.current && !busy.current) setTimeout(() => { if (handsFreeRef.current) void speech.start(); }, 250); });
    return () => setOnIdle(null);
  }, [setOnIdle, speech]);

  function toggleHandsFree() {
    if (handsFreeRef.current) { handsFreeRef.current = false; setHandsFree(false); speech.cancel(); stopSpeaking(); return; }
    stopEverything();setInputError('');setError('');handsFreeRef.current = true; setHandsFree(true); prepare(); void speech.start();
  }

  function previewVoice(text?:string){
    handsFreeRef.current=false;setHandsFree(false);speech.cancel();
    speakNow(text??(lang==='de'?'Hallo, ich bin Ihre KI-Begleitung. Nehmen Sie sich Zeit. Worüber möchten Sie sprechen?':"Hi, I'm your AI companion. Take your time. What would you like to talk about?"));
  }

  function stopEverything() {generation.current++; abort.current?.(); abort.current = null; busy.current = false; setThinking(false); setLive(null); stopSpeaking(); speech.cancel(); handsFreeRef.current = false; setHandsFree(false); }
  function realtimeEvent(event:VoiceEvent){
    if(event.type==='state'&&event.state)applyState(event.state);
    else if(event.type==='user'&&event.text){setMessages(current=>[...current,{id:`local-${event.turnId}`,role:'user',text:event.text!,mode:'voice',cards:[],createdAt:new Date().toISOString()}]);setThinking(true);setLive({id:event.turnId??'voice',text:'',cards:[]});}
    else if(event.type==='transcript'){setThinking(false);setLive(current=>({...current,id:current?.id??'voice',text:event.text??'',cards:current?.cards??[]}));}
    else if(event.type==='card'&&event.card)setLive(current=>({...current,id:current?.id??'voice',text:current?.text??'',cards:[...(current?.cards??[]),event.card!]}));
    else if(event.type==='done'&&typeof event.message==='object'){setMessages(current=>[...current,event.message as Message]);setLive(null);setThinking(false);}
    else if(event.type==='status'&&event.status==='speaking')setThinking(false);
    else if(event.type==='ended'||(event.type==='status'&&['interrupted','ready'].includes(event.status??''))){setThinking(false);setLive(null);}
  }

  useLayoutEffect(() => {
    const scroller=thread.current;if(!scroller||!atLatest)return;
    const lastMessage=messages.at(-1);
    const latest=!live&&lastMessage?.role==='assistant'&&lastMessage.cards.some(c=>c.type==='bank_trends'||c.type==='scenario')?scroller.querySelector(`[data-message-id="${lastMessage.id}"]`):null;
    // A long chart answer starts at its explanation, not below the chart.
    scroller.scrollTop=latest?latest.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop:scroller.scrollHeight;
  }, [messages, live?.text, thinking,atLatest,live]);
  useEffect(() => { const node = textarea.current; if (!node) return; node.style.height = "auto"; node.style.height = `${Math.min(160, node.scrollHeight)}px`; }, [input]);

  const last = messages.at(-1);
  const suggestions = !live && !thinking && last?.role === "assistant" ? last.suggestions ?? [] : [];
  const canSpeak = speechInputSupported();
  const lastReply=[...messages].reverse().find(message=>message.role==='assistant'&&message.text)?.text;
  const generatedVoice=state.ai.voice&&(state.ai.speechOut.multilingual||lang==='en');
  const voiceName=generatedVoice?(['groq','openai'].includes(state.ai.speechOut.provider)?state.ai.speechOut.voice.replace(/^./,c=>c.toUpperCase()):(lang==='de'?'KI-Stimme':'AI voice')):(lang==='de'?'Systemstimme':'System voice');
  const voiceErrors={
    auth:lang==='de'?'Der Sprachanbieter verweigert den API-Zugriff. Aktualisieren Sie den privaten Serverschlüssel. Ihre Audioausgabe ist nicht die Ursache.':'The speech provider rejected API access. Update the private server key. This is not a speaker or microphone permission problem.',
    billing:lang==='de'?'OpenAI meldet fehlendes API-Guthaben oder ein erreichtes Kontolimit. Prüfen Sie die API-Abrechnung. Ein API-Schlüssel allein enthält kein Guthaben.':'OpenAI reports unavailable API credits or an account limit. Check API billing. Creating an API key does not add credits.',
    terms:lang==='de'?'Groq blockiert diese Stimme, bis Sie die Orpheus-Modellbedingungen in Ihrem Groq-Konto geprüft und akzeptiert haben. Danach können Sie die Stimme hier erneut testen.':'Groq has blocked this voice until you review and accept the Orpheus model terms in your Groq account. Then test the voice here again.',
    autoplay:lang==='de'?'Der Browser hat die Wiedergabe blockiert. Klicken Sie auf „Audio abspielen“; die Sprachdatei ist bereits bereit.':'Your browser blocked playback. Click “Play audio”; the voice clip is already ready.',
    budget:lang==='de'?'Das Sprach-Nutzungslimit ist erreicht. Sie können weiter schreiben.':'The voice usage allowance has been reached. You can keep using text.',
    failed:lang==='de'?'Die Sprachausgabe konnte nicht abgespielt werden. Prüfen Sie Ihre Audioausgabe und testen Sie die Stimme erneut.':'Voice playback failed. Check your sound output and test the voice again.',
    unsupported:lang==='de'?'Dieser Browser bietet keine Systemstimme. Verwenden Sie einen Browser mit Sprachausgabe oder eine konfigurierte KI-Stimme.':'This browser has no system voice. Use a browser with speech support or a configured AI voice.',
  };
  const strip = state.picture.metrics.filter(metric => ["net_worth", "free_cashflow", "runway"].includes(metric.key));

  return <div className="chat">
    <div className="conversation-head"><div><span className="conversation-icon"><Sparkles/></span><span><strong>{lang==='de'?'Sprechen wir über Ihr Geld.':'Let’s talk about your money.'}</strong><small>{lang==='de'?'Ein Gespräch, das mitdenkt.':'A conversation that connects the dots.'}</small></span></div><span className="chip">{state.profile?.sampleLoaded?'DEMO':lang==='de'?'Ihr Haushalt':'Your household'}</span></div>
    {!state.profile?.onboardingDone&&<div className="intake-progress" aria-label={lang==='de'?'Kurze Einführung':'Quick introduction'}>{[['age','goal_primary'],['income_net_monthly','expenses_monthly'],['cash_liquid','investments_value','other_debt']].map((keys,index)=>{const complete=keys.every(key=>state.facts[key as keyof typeof state.facts]||last?.meta?.skipped?.includes(key as keyof typeof state.facts));return <span key={index} className={complete?'complete':''}><i>{complete?'✓':index+1}</i>{(lang==='de'?['Sie & Ihr Ziel','Einnahmen & Ausgaben','Vermögen & Schulden']:['You & your goal','Income & spending','Assets & debt'])[index]}</span>;})}</div>}
    <div ref={thread} className="thread" aria-label={t.tabs.chat} tabIndex={0} onScroll={()=>{const el=thread.current;if(el)setAtLatest(el.scrollHeight-el.scrollTop-el.clientHeight<140);}}>
      {messages.map((message, index) => <MessageView key={message.id} message={message} lang={lang} showTime={index === 0 || new Date(message.createdAt).getTime() - new Date(messages[index - 1].createdAt).getTime() > 30 * 60_000} />)}
      {live && (live.text || live.cards.length > 0) && <div className="msg"><span className="who"><Sparkles /></span><div className="body">
        {live.text && <p>{live.text}<span className="caret" /></p>}
        {live.cards.map((card, index) => <CardView card={card} lang={lang} key={index} />)}
      </div></div>}
      {(thinking || (!realtimeActive && live && !live.text)) && <div className="msg"><span className="who"><Sparkles /></span><div className="body"><div className="typing" aria-label={t.thinking}><i /><i /><i /></div></div></div>}
      {error && <div className="error-line"><CircleAlert size={15} />{error}</div>}
      <div ref={threadEnd} />
      {strip.some(metric => metric.value !== null) && <div className="picture-strip">{strip.map(metric => <button key={metric.key} onClick={onOpenPicture}><small>{metric.label[lang]}</small><strong className="num">{metricValue(metric.value, metric.unit, lang)}</strong></button>)}</div>}
    </div>

    <div className="composer-wrap">
      {state.ai.realtime.available?<RealtimeVoice lang={lang} available beforeStart={stopEverything} onClient={client=>{realtime.current=client;setRealtimeActive(Boolean(client));}} onEvent={realtimeEvent}/>:<ChainedVoice lang={lang} available={canSpeak&&state.ai.realtime.mode!=='text'&&state.ai.speechIn.provider!=='none'} active={handsFree} phase={speech.phase} speaking={speaking} thinking={thinking||Boolean(live)} level={speech.level} device={microphone} voiceName={voiceName} error={inputError} onDevice={value=>{setMicrophone(value);try{localStorage.setItem('fintwin-microphone',value);}catch{/* optional preference */}}} onStart={()=>{stopEverything();toggleHandsFree();}} onEnd={stopEverything} onStopRecording={speech.stop}/>}
      {state.ai.realtime.mode!=='text'&&!state.ai.realtime.available&&!realtimeActive&&<section className="voice-preview" aria-label={lang==='de'?'Sprachausgabe':'Voice playback'}>
        <div className="voice-preview-row"><span><Volume2 size={16}/>{voiceName} · {generatedVoice?(lang==='de'?'KI-Stimme':'AI voice'):(lang==='de'?'Deutsch · lokal':'local')}<small>{lang==='de'?'Eine Stimme hören, ohne Ihr Mikrofon einzuschalten.':'Hear a voice without turning on your microphone.'}</small></span>
          <button className="btn sm" type="button" disabled={speaking||thinking||Boolean(live)||speech.listening} onClick={()=>previewVoice()}>{lang==='de'?'Stimme testen':'Test voice'}</button>
          {lastReply&&<button className="btn sm ghost" type="button" disabled={speaking||thinking||Boolean(live)||speech.listening} onClick={()=>previewVoice(lastReply)}>{lang==='de'?'Antwort vorlesen':'Read reply'}</button>}
          {speaking&&<button className="btn sm ghost" type="button" onClick={stopSpeaking}>{lang==='de'?'Audio stoppen':'Stop audio'}</button>}
        </div>
        {voiceError&&<div className="voice-playback-error" role="alert"><p>{voiceErrors[voiceError]}</p>{voiceError==='terms'&&<a href="https://console.groq.com/" target="_blank" rel="noreferrer">{lang==='de'?'Groq Console öffnen':'Open Groq Console'}</a>}{voiceError==='billing'&&<a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">{lang==='de'?'OpenAI API-Abrechnung öffnen':'Open OpenAI API billing'}</a>}{voiceError==='autoplay'&&<button className="btn sm" type="button" onClick={resume}>{lang==='de'?'Audio abspielen':'Play audio'}</button>}</div>}
        {!voiceError&&speaking&&<p className="note" role="status">{lang==='de'?'Sprachausgabe wird vorbereitet oder abgespielt …':'Preparing or playing voice…'}</p>}
      </section>}
      {!atLatest&&<button className="btn sm latest" onClick={()=>{setAtLatest(true);threadEnd.current?.scrollIntoView();}}>{lang==='de'?'Zur neuesten Nachricht':'Return to latest'}</button>}
      <span className="sr-only" role="status">{thinking?t.thinking:error}</span>
      {handsFree && <div className={`voice-banner ${speech.listening ? "" : "quiet"}`}><span className="wave" aria-hidden>{[0, 1, 2, 3, 4].map(index => <i key={index} style={speech.listening ? { height: `${5 + Math.min(13, speech.level * 30 * (index === 2 ? 1.3 : index === 1 || index === 3 ? 1 : 0.7))}px`, animation: "none" } : undefined} />)}</span>
        <span>{speech.listening ? t.listening : speaking ? t.speaking : t.thinking}{interim ? ` — ${interim}` : ""}</span>
        <button onClick={toggleHandsFree}>{t.handsFreeOn}</button></div>}
      {suggestions.length > 0 && <div className="suggestions">{suggestions.map(suggestion => <button key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div>}
      <form className={`composer ${state.ai.realtime.available?'text-composer':''}`} onSubmit={event => { event.preventDefault(); send(input); }}>
        {!state.ai.realtime.available&&<button type="button" className={`icon-btn mic ${speech.listening ? "on" : ""}`} style={speech.listening ? { boxShadow: `0 0 0 ${2 + speech.level * 10}px color-mix(in srgb, var(--red) ${12 + speech.level * 26}%, transparent)` } : undefined} onClick={() => {if(speech.listening)speech.stop();else{stopEverything();setInputError('');prepare();void speech.start();}}} aria-label={speech.listening ? t.stopMic : t.mic} disabled={!canSpeak||realtimeActive||speech.phase==='transcribing'||speech.phase==='requesting'||state.ai.speechIn.provider==='none'}>{speech.listening ? <MicOff /> : <Mic />}</button>}
        <textarea ref={textarea} rows={1} value={speech.listening && interim ? interim : input} onChange={event => setInput(event.target.value)} placeholder={speech.listening ? t.listening : t.placeholder} aria-label={t.placeholder}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(input); } }} />
        {(!input.trim()&&(thinking || live || speaking)) ? <button type="button" className="icon-btn send stop" onClick={()=>{stopEverything();void realtime.current?.interrupt();}} aria-label={t.stopSpeaking}><Square /></button>
          : <button type="submit" className="icon-btn send" disabled={!input.trim()} aria-label={t.send}><Send /></button>}
      </form>
      <div className="status-line">
        <span><i className={`mode-dot ${state.ai.live ? "live" : ""}`} /> {state.ai.live ? t.live : t.offline}</span>
        {!state.ai.realtime.available&&canSpeak && state.ai.speechIn.provider!=='none' && <button disabled={realtimeActive} className={handsFree ? "on" : ""} onClick={toggleHandsFree}><AudioLines />{handsFree ? t.handsFreeOn : t.handsFree}</button>}
        {!state.ai.realtime.available&&<button type="button" aria-pressed={voiceOn} disabled={realtimeActive||state.ai.realtime.mode==='text'} onClick={()=>{stopSpeaking();void api.patchProfile({voiceAutoplay:!voiceOn}).then(applyState).catch(e=>setError(e.message));}}>{voiceOn ? <Volume2 size={13} /> : <VolumeX size={13} />}{lang==='de'?(voiceOn?'Antworten vorlesen: an':'Antworten vorlesen: aus'):(voiceOn?'Read replies: on':'Read replies: off')}</button>}
        <span style={{ flex: 1 }} />
        <span>{t.disclaimer}</span>
      </div>
    </div>
  </div>;
}

function MessageView({ message, lang, showTime }: { message: Message; lang: Lang; showTime: boolean }) {
  if (message.role === "system") return message.cards.length ? <div className="msg system"><div className="body">{message.cards.map((card, index) => <CardView card={card} lang={lang} key={index} />)}</div></div> : null;
  if (message.role === "user") return <div className="msg user"><div className="body"><p>{message.text}</p>{showTime && <span className="meta">{message.mode === "voice" && <Mic />}{timeOfDay(message.createdAt, lang)}</span>}</div></div>;
  return <div className="msg" data-message-id={message.id}><span className="who"><Sparkles aria-hidden /></span><div className="body">
    {message.text && <p>{message.text}</p>}
    {message.cards.map((card, index) => <CardView card={card} lang={lang} key={index} />)}
    <time>{showTime?timeOfDay(message.createdAt, lang):''} · {message.meta?.origin==='live'?(message.meta.fallbackFrom?(lang==='de'?'Groq-Ersatzmodell':'Groq backup model'):(lang==='de'?'KI-Antwort':'Model response')):message.meta?.origin==='fallback'?(lang==='de'?'Lokaler Ersatzmodus':'Local fallback'):message.mode==='policy'?(lang==='de'?'Hinweis zum Umfang':'Scope guidance'):(lang==='de'?'Aus Ihren Angaben berechnet':'Deterministic companion')}</time>
  </div></div>;
}
