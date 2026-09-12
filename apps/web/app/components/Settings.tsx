"use client";
import { useEffect,useRef,useState } from "react";
import { LogOut, X } from "lucide-react";
import type { AppState, Lang } from "@fintwin/contracts";
import { api } from "../lib/api";
import { copy } from "../lib/i18n";

export type Theme = "auto" | "light" | "dark";

interface SettingsProps { state: AppState; lang: Lang; theme: Theme; onTheme(theme: Theme): void; onLanguage(lang: Lang): void; applyState(state: AppState): void; onReset(): Promise<void>; onClose(): void }

export function SettingsSheet({ state, lang, theme, onTheme, onLanguage, applyState, onReset, onClose }: SettingsProps) {
  const t = copy(lang).settings;
  const [name, setName] = useState(state.profile?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error,setError]=useState('');const sheet=useRef<HTMLElement|null>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;sheet.current?.querySelector<HTMLElement>('button')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close.current();if(e.key==='Tab'){const items=Array.from(sheet.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href]')??[]),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[]);
  async function saveName() { if (!name.trim() || name.trim() === state.profile?.name) return; try{applyState(await api.patchProfile({ name: name.trim() }));}catch(e){setError((e as Error).message);} }
  async function toggleVoice() { try{applyState(await api.patchProfile({ voiceAutoplay: !(state.profile?.voiceAutoplay ?? true) }));}catch(e){setError((e as Error).message);} }
  async function reset() { if (!confirm(t.resetConfirm)) return; setBusy(true);try{await onReset();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);} }

  return <div className="backdrop" onMouseDown={onClose} role="presentation">
    <section ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-label={t.title} onMouseDown={event => event.stopPropagation()}>
      <div className="row"><h2>{t.title}</h2><button className="icon-btn" onClick={onClose} aria-label={t.close}><X /></button></div>
      <div className="field"><label htmlFor="settings-name">{t.name}</label><div className="input"><input id="settings-name" value={name} onChange={event => setName(event.target.value)} onBlur={() => void saveName()} onKeyDown={event => { if (event.key === "Enter") void saveName(); }} maxLength={80} /></div></div>
      <div className="row"><span>{t.language}</span><div className="seg"><button className={lang === "de" ? "active" : ""} onClick={() => onLanguage("de")}>Deutsch</button><button className={lang === "en" ? "active" : ""} onClick={() => onLanguage("en")}>English</button></div></div>
      <div className="row"><span>{t.voice}<small>{lang === "de" ? "Vollständige Antworten im konfigurierten Ersatz-Sprachmodus vorlesen. Echtzeit steuern Sie direkt im Gespräch." : "Read completed replies in configured fallback voice mode. Realtime is controlled in the conversation."}</small></span><button className={`switch ${state.profile?.voiceAutoplay ?? true ? "on" : ""}`} role="switch" aria-checked={state.profile?.voiceAutoplay ?? true} aria-label={t.voice} onClick={() => void toggleVoice()} /></div>
      <div className="row"><span>{t.theme}</span><div className="seg"><button className={theme === "auto" ? "active" : ""} onClick={() => onTheme("auto")}>{t.themeAuto}</button><button className={theme === "light" ? "active" : ""} onClick={() => onTheme("light")}>{t.themeLight}</button><button className={theme === "dark" ? "active" : ""} onClick={() => onTheme("dark")}>{t.themeDark}</button></div></div>
      <p>{t.about} {state.ai.live ? (lang === "de" ? `Live-Modell: ${state.ai.model}.` : `Live model: ${state.ai.model}.`) : (lang === "de" ? "Derzeit ohne Live-Modell; Antworten kommen aus dem eingebauten Begleiter." : "Currently without a live model; replies come from the built-in companion.")}</p>
      {error&&<p role="alert">{error}</p>}
      <div className="row"><button className="btn danger" onClick={() => void reset()} disabled={busy}>{t.reset}</button><button className="btn ghost" onClick={()=>void api.logout().then(()=>window.location.reload()).catch(e=>setError(e.message))}><LogOut />{t.signOut}</button></div>
    </section>
  </div>;
}
