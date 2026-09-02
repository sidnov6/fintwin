"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid, MessageSquare, Settings2, Sparkles, SlidersHorizontal } from "lucide-react";
import type { AppState, Lang, Message } from "@fintwin/contracts";
import { api, ApiError } from "./lib/api";
import { initials } from "./lib/format";
import { copy } from "./lib/i18n";
import { Chat } from "./components/Chat";
import { PictureRail, PictureView } from "./components/Picture";
import { PlanView } from "./components/Plan";
import { SettingsSheet, type Theme } from "./components/Settings";

type View = "chat" | "picture" | "plan";

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
  const sendRef = useRef<(text: string) => void>(() => {});
  const langRef = useRef<Lang | null>(null);
  const t = copy(lang);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const next = await api.state();
      const language: Lang = next.profile?.language ?? langRef.current ?? (typeof navigator !== "undefined" && navigator.language.startsWith("en") ? "en" : "de");
      langRef.current = language;
      setLang(language);
      setState(next);
      const history = await api.messages(language);
      setMessages(history.messages);
      setStatus("ready");
    } catch (error) {
      setLoadError(error instanceof ApiError && error.status === 401 ? "unauthorized" : error instanceof Error ? error.message : "Failed to load.");
      setStatus("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { const stored = localStorage.getItem("fintwin-theme") as Theme | null; if (stored === "light" || stored === "dark" || stored === "auto") setTheme(stored); }, []);
  useEffect(() => {
    if (theme === "auto") { delete document.documentElement.dataset.theme; localStorage.removeItem("fintwin-theme"); }
    else { document.documentElement.dataset.theme = theme; localStorage.setItem("fintwin-theme", theme); }
  }, [theme]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2400); return () => clearTimeout(timer); }, [toast]);

  const applyState = useCallback((next: AppState) => setState(current => ({ ...next, portfolio: next.portfolio ?? current?.portfolio ?? null })), []);
  const registerSend = useCallback((send: (text: string) => void) => { sendRef.current = send; }, []);
  const ask = useCallback((text: string) => { setView("chat"); setTimeout(() => sendRef.current(text), 40); }, []);
  const addMessage = useCallback((message: Message) => setMessages(current => [...current, message]), []);

  async function switchLanguage(next: Lang) {
    if (next === lang) return;
    langRef.current = next;
    setLang(next);
    if (state?.profile) applyState(await api.patchProfile({ language: next }));
    const history = await api.messages(next);
    setMessages(history.messages);
  }

  async function reset() {
    await api.reset();
    setMessages([]);
    await load();
    setToast(t.settings.resetDone);
  }

  if (status === "loading") return <main className="center"><div><div className="pulse" /><p>{t.loading}</p></div></main>;
  if (status === "error" || !state) return <main className="center"><div><h1>{t.brand}</h1><p>{loadError === "unauthorized" ? t.signIn : loadError}</p><button className="btn primary" onClick={() => void load()} style={{ marginTop: 14 }}>{t.retry}</button></div></main>;

  const views: Array<[View, string, typeof MessageSquare]> = [["chat", t.tabs.chat, MessageSquare], ["picture", t.tabs.picture, LayoutGrid], ["plan", t.tabs.plan, SlidersHorizontal]];

  return <div className="shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView("chat")}><span className="mark"><Sparkles /></span><span>{t.brand}<small>{t.tagline}</small></span></button>
      <nav className="tabs" role="tablist" aria-label={t.brand}>{views.map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? "active" : ""} onClick={() => setView(id)}><Icon />{label}</button>)}</nav>
      <div className="topbar-end">
        <div className="lang-toggle">{(["de", "en"] as Lang[]).map(item => <button key={item} className={lang === item ? "active" : ""} onClick={() => void switchLanguage(item)} aria-label={item === "de" ? "Deutsch" : "English"}>{item.toUpperCase()}</button>)}</div>
        <button className="avatar" onClick={() => setSettingsOpen(true)} aria-label={t.settings.title}>{state.profile?.name ? initials(state.profile.name) : <Settings2 size={16} />}</button>
      </div>
    </header>

    <div className="content">
      {view === "chat" && <div className="layout-chat">
        <Chat state={state} lang={lang} messages={messages} setMessages={setMessages} applyState={applyState} registerSend={registerSend} onOpenPicture={() => setView("picture")} />
        <PictureRail state={state} lang={lang} applyState={applyState} send={ask} toast={setToast} addMessage={addMessage} />
      </div>}
      {view === "picture" && <PictureView state={state} lang={lang} applyState={applyState} send={ask} toast={setToast} addMessage={addMessage} />}
      {view === "plan" && <PlanView state={state} lang={lang} applyState={applyState} send={ask} toast={setToast} addMessage={addMessage} />}
    </div>

    <footer className="footer">{t.disclaimer}</footer>

    <nav className="bottom-tabs" aria-label={t.brand}>{views.map(([id, label, Icon]) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)} aria-current={view === id}><Icon />{label}</button>)}</nav>

    {settingsOpen && <SettingsSheet state={state} lang={lang} theme={theme} onTheme={setTheme} onLanguage={value => void switchLanguage(value)} applyState={applyState} onReset={reset} onClose={() => setSettingsOpen(false)} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
