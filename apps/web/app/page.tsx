"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid, MessageSquare, Settings2, Sparkles, SlidersHorizontal, Landmark } from "lucide-react";
import type { AppState, Lang, Message } from "@fintwin/contracts";
import { api, ApiError } from "./lib/api";
import { initials } from "./lib/format";
import { copy } from "./lib/i18n";
import { Chat } from "./components/Chat";
import { PictureView } from "./components/Picture";
import { Welcome, WorkspaceOverview, InsightRail } from './components/Workspace';
import { BankView } from './components/Bank';
import { PlanView } from "./components/Plan";
import { SettingsSheet, type Theme } from "./components/Settings";
import {BriefView} from './components/Brief';
import {Preflight} from './components/Preflight';

type View = "chat" | "picture" | "plan" | "brief" | "preflight" | "bank";

export default function FinTwinApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [lang, setLang] = useState<Lang>("de");
  const [view, setView] = useState<View>("chat");
  const [theme, setTheme] = useState<Theme>("auto");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<"unauthorized" | string>("");
  const [passphrase,setPassphrase]=useState('');
  const [gateError,setGateError]=useState('');
  const [started,setStarted]=useState(false);
  const [scenarioId,setScenarioId]=useState<string|undefined>();
  const [planMounted,setPlanMounted]=useState(false);
  const sendRef = useRef<((text: string,scenarioId?:string) => void)|null>(null);
  const queued=useRef<{text:string;scenarioId?:string}|null>(null);
  const langRef = useRef<Lang | null>(null);
  const t = copy(lang);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      let next = await api.openState();
      const language: Lang = next.profile?.language ?? langRef.current ?? (typeof navigator !== "undefined" && navigator.language.startsWith("en") ? "en" : "de");
      if(!next.profile)next=await api.patchProfile({language});
      langRef.current = language;
      setLang(language);
      setState(next);
      const history = await api.messages(language);
      setMessages(history.messages);
      setStarted(Object.keys(next.facts).length>0 || history.messages.some(m=>m.role==='user'));
      setStatus("ready");
    } catch (error) {
      setLoadError(error instanceof ApiError && error.status === 401 ? "unauthorized" : error instanceof Error ? error.message : "Failed to load.");
      setStatus("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(()=>{if(view==='plan')setPlanMounted(true);},[view]);
  useEffect(() => { const stored = localStorage.getItem("fintwin-theme") as Theme | null; if (stored === "light" || stored === "dark" || stored === "auto") setTheme(stored); }, []);
  useEffect(() => {
    if (theme === "auto") { delete document.documentElement.dataset.theme; localStorage.removeItem("fintwin-theme"); }
    else { document.documentElement.dataset.theme = theme; localStorage.setItem("fintwin-theme", theme); }
  }, [theme]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2400); return () => clearTimeout(timer); }, [toast]);

  const applyState = useCallback((next: AppState) => setState(current => current && (next.epoch<current.epoch || (next.epoch===current.epoch && next.revision<current.revision))?current:next), []);
  const registerSend = useCallback((send: (text: string,scenarioId?:string) => void) => { sendRef.current = send;if(queued.current){const q=queued.current;queued.current=null;send(q.text,q.scenarioId);} }, []);
  const ask = useCallback((text: string,id?:string) => {setStarted(true);if(id)setScenarioId(id);if(view==='chat'&&sendRef.current)sendRef.current(text,id);else{queued.current={text,scenarioId:id};setView('chat');}}, [view]);
  const addMessage = useCallback((message: Message) => setMessages(current => [...current, message]), []);

  async function switchLanguage(next: Lang) {
    if (next === lang) return;
    langRef.current = next;
    setLang(next);
    applyState(await api.patchProfile({ language: next }));
    const history = await api.messages(next);
    setMessages(history.messages);
  }

  async function reset() {
    await api.reset();
    setMessages([]);
    setScenarioId(undefined);setStarted(false);
    await load();
    setToast(t.settings.resetDone);
  }

  async function exploreSample(){
    try{const hasFacts=Object.keys(state?.facts??{}).length>0;if(hasFacts&&!window.confirm(lang==='de'?'Diesen synthetischen Haushalt auf das feste Beispiel zurücksetzen? Eigene Angaben werden nicht ersetzt.':'Reset this synthetic household to the frozen sample? Your own figures will not be overwritten.'))return;
      const next=await api.loadSample(hasFacts);applyState(next);setScenarioId(undefined);setMessages((await api.messages(lang)).messages);setStarted(true);setView('chat');
    }catch(e){setToast((e as Error).message);}
  }

  if (status === "loading") return <main className="center"><div><div className="pulse" /><p>{t.loading}</p></div></main>;
  if (status === "error" || !state) return <main className="center"><div className="gate"><span className="mark"><Sparkles/></span><h1>{t.brand}</h1><p>{lang==='de'?'Ihr Gespräch. Ihr Überblick. Gut vorbereitet zur Beratung.':'Your conversation. Your picture. A better-prepared adviser meeting.'}</p>{loadError==='unauthorized'?<form onSubmit={e=>{e.preventDefault();setGateError('');void api.login(passphrase).then(()=>{setPassphrase('');return load();}).catch(e=>setGateError(e.message));}}><label htmlFor="demo-pass">{lang==='de'?'Zugang zur geschützten Demo':'Protected demo access'}</label><div className="input"><input id="demo-pass" type="password" autoComplete="current-password" value={passphrase} onChange={e=>setPassphrase(e.target.value)} required/></div><button className="btn primary" type="submit">{lang==='de'?'Demo öffnen':'Enter demo'}</button><p className="note">{lang==='de'?'Nur synthetische Daten. Kein Kundenkonto.':'Synthetic data only. This is not a client-account system.'}</p>{gateError&&<p role="alert">{gateError}</p>}</form>:<><p>{loadError}</p><button className="btn primary" onClick={()=>void load()}>{t.retry}</button></>}<div className="lang-toggle"><button onClick={()=>setLang('de')}>DE</button><button onClick={()=>setLang('en')}>EN</button></div></div></main>;

  const views: Array<[View, string, typeof MessageSquare]> = [["chat", t.tabs.chat, MessageSquare], ['bank',lang==='de'?'Bank':'Bank',Landmark], ["picture", t.tabs.picture, LayoutGrid], ["plan", t.tabs.plan, SlidersHorizontal]];

  return <div className="shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView("chat")}><span className="mark"><Sparkles /></span><span>{t.brand}<small>{t.tagline}</small></span></button>
      <nav className="tabs" role="tablist" aria-label={t.brand}>{views.map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? "active" : ""} onClick={() => setView(id)}><Icon />{label}</button>)}</nav>
      <div className="topbar-end">
        <button className="brief-shortcut" onClick={()=>setView('brief')}>{lang==='de'?'Gespräch vorbereiten':'Prepare meeting'}</button>
        <div className="lang-toggle">{(["de", "en"] as Lang[]).map(item => <button key={item} className={lang === item ? "active" : ""} onClick={() => void switchLanguage(item)} aria-label={item === "de" ? "Deutsch" : "English"}>{item.toUpperCase()}</button>)}</div>
        <button className="avatar" onClick={() => setSettingsOpen(true)} aria-label={t.settings.title}>{state.profile?.name ? initials(state.profile.name) : <Settings2 size={16} />}</button>
      </div>
    </header>
    {state.profile?.sampleLoaded&&<div className="sample-bar"><span><Landmark size={14}/>{lang==='de'?'Synthetischer Beispielhaushalt · Demo-Bank verbunden · März–August 2026 · keine echte Bank':'Synthetic sample household · Demo bank connected · March–August 2026 · not a real bank'}</span><button onClick={()=>void exploreSample()}>{lang==='de'?'Beispiel zurücksetzen':'Reset sample'}</button></div>}

    <div className="content">
      {view==='chat'&&!started?<Welcome lang={lang} onStart={()=>setStarted(true)} onSample={()=>void exploreSample()}/>:view === 'chat' && <><WorkspaceOverview state={state} lang={lang} onPicture={()=>setView('picture')}/><div className="layout-chat">
        <Chat key={state.epoch} state={state} lang={lang} messages={messages} setMessages={setMessages} applyState={applyState} registerSend={registerSend} onOpenPicture={() => setView("picture")} onLoadSample={()=>void exploreSample()} scenarioId={scenarioId} />
        <InsightRail state={state} lang={lang} send={ask} onBank={()=>setView('bank')} onPicture={()=>setView('picture')} onSample={()=>void exploreSample()}/>
      </div></>}
      {view==='bank'&&<BankView state={state} lang={lang} onLoadSample={()=>void exploreSample()} send={ask}/>}
      {view === "picture" && <PictureView state={state} lang={lang} applyState={applyState} send={ask} toast={setToast} addMessage={addMessage} />}
      {(view === "plan"||planMounted) && <div hidden={view!=='plan'}><PlanView key={state.epoch} state={state} lang={lang} applyState={applyState} send={ask} toast={setToast} addMessage={addMessage} onSelect={setScenarioId} onBrief={()=>setView('brief')} /></div>}
      {view==='brief'&&<BriefView state={state} lang={lang} scenarioId={scenarioId} onEdit={()=>setView('picture')}/>}
      {view==='preflight'&&<Preflight state={state} lang={lang} onClose={()=>setView('chat')}/>}
    </div>

    <footer className="footer">{t.disclaimer} <button onClick={()=>setView('preflight')}>{lang==='de'?'Vorführungscheck':'Presenter preflight'}</button></footer>

    <nav className="bottom-tabs" aria-label={t.brand}>{views.map(([id, label, Icon]) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)} aria-current={view === id}><Icon />{label}</button>)}</nav>

    {settingsOpen && <SettingsSheet state={state} lang={lang} theme={theme} onTheme={setTheme} onLanguage={value => void switchLanguage(value)} applyState={applyState} onReset={reset} onClose={() => setSettingsOpen(false)} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
