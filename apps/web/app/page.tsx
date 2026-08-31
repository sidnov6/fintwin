"use client";

import {
  ArrowRight, BarChart3, Bot, Check, ChevronRight, CircleAlert, CircleCheck,
  Database, Edit3, FileText, Home, Landmark, Link2, LockKeyhole, LogOut, Menu, Mic,
  MicOff, Play, RotateCcw, Save, Send, Settings2, ShieldCheck, Sparkles, TrendingUp,
  UserRound, Volume2, WalletCards, X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type View = "start" | "review" | "twin" | "planning" | "assistant";
type Lang = "de" | "en";
type Message = { role: "user" | "assistant"; text: string; sources?: string[]; mode?: string };
type Profile = { netWorth: number; income: number; assets: number; property: number; mortgage: number; retirementAge: number; runway: number };
type AccountProfile = { name: string; email?: string; netWorth: number; expectations: string; bankConnected: boolean; language: Lang };
type ReviewKey = "protection" | "retirement" | "wealth" | "home" | "liquidity" | "family";

const api = process.env.NEXT_PUBLIC_API_URL ?? "";
const initialProfile: Profile = { netWorth: 487320, income: 7240, assets: 307320, property: 420000, mortgage: 240000, retirementAge: 63, runway: 7.8 };

const copy = {
  de: {
    nav: ["Start", "Finanzcheck", "Finanz-Twin", "Planung", "KI-Assistent"], demo: "Demo-Daten",
    trust: "Unabhängiger Prototyp mit fiktiven Daten", trust2: "Keine Produktberatung · Jede Zahl ist nachvollziehbar",
    greeting: "Guten Morgen", intro: "Ihre Finanzen sind solide erfasst. Drei Punkte sollten Sie jetzt genauer ansehen.",
    openReview: "Finanzcheck öffnen", ask: "FinTwin fragen", complete: "Daten vollständig", reconciled: "7.666 Buchungen abgeglichen", current: "Stand aktuell",
    netWorth: "Nettovermögen", cashflow: "Freier Cashflow", reserve: "Notfallreserve", quality: "Datenqualität", month: "Monat", target: "Ziel: 6 Monate", matched: "Vollständig abgeglichen",
    important: "Was jetzt wichtig ist", next: "Drei Themen für Ihren nächsten Schritt", all: "Alle Bereiche ansehen",
    mortgage: "Anschlussfinanzierung", mortgageText: "Zinsbindung endet in 14 Monaten", costs: "Laufende Kosten", costsText: "134 € pro Monat mehr als im Vorjahr", protection: "Einkommensschutz", protectionText: "Angaben zu Annas Absicherung fehlen",
    cashTitle: "So verteilt sich Ihr Monat", income: "Einnahmen", expenses: "Ausgaben", left: "Übrig", rise: "Regelmäßige Ausgaben sind zuletzt spürbar gestiegen.",
    askSimple: "Fragen Sie einfach.", askBlurb: "Per Text oder Sprache. Antworten werden aus geprüften Haushaltsdaten erzeugt und mit Quellen belegt.", startVoice: "Sprachgespräch starten", tapSpeak: "Zum Sprechen antippen", noProducts: "Keine Produktvorschläge oder Abschlüsse",
    reviewOver: "Ihr Finanzcheck", reviewTitle: "Klarheit statt Gesamtnote.", reviewText: "Jeder Lebensbereich zeigt, was belegt ist, was fehlt und welche Angaben Sie direkt ergänzen können.", strength: "1 Stärke", checks: "3 Prüfthemen", gaps: "2 Datenlücken",
    ready: "Bereit für das Beratungsgespräch?", readyText: "Ergänzen Sie fehlende Angaben und bereiten Sie Ihre Fragen vor.", prepare: "Fragen vorbereiten",
    twinOver: "Ihr Finanz-Twin", twinText: "Herkunft, Aktualität und Sicherheit bleiben an jedem wichtigen Fakt sichtbar.", edit: "Bearbeiten", fact: "Fakt", value: "Aktueller Wert", source: "Quelle", confidence: "Sicherheit", lastSync: "Zuletzt abgeglichen: 30.08.2026",
    noSilent: "Keine stille Änderung", noSilentText: "Jede Korrektur erzeugt eine neue, unveränderliche Version.", sourcesVisible: "Quellen bleiben sichtbar", sourcesVisibleText: "Berechnungen und KI-Antworten verweisen auf dieselben Belege.", reproducible: "Jeder Stand reproduzierbar", reproducibleText: "Annahmen, Regeln und Zeitpunkte werden mitgespeichert.",
    planningOver: "Szenario-Planung", planningTitle: "Was wäre, wenn? Offen gerechnet.", planningText: "Ändern Sie Annahmen und sehen Sie die Auswirkung sofort – ohne Prognose oder Produktempfehlung.", financing: "Anschlussfinanzierung", pension: "Ruhestand", remaining: "Restschuld", term: "Restlaufzeit", years: "Jahre", rateQuestion: "Wie verändert der Zins Ihre Rate?", modelOnly: "Modellrechnung, kein Kreditangebot", perMonth: "pro Monat", pensionAge: "Rentenalter", monthlySaving: "Monatliche Sparrate", goalCapital: "des Zielkapitals",
    assistantOver: "FinTwin KI-Assistent", assistantTitle: "Fragen Sie Ihre Finanzen.", assistantAccent: "In Ihrer Sprache. Mit Quellen.", assistantBlurb: "Text oder Sprache – Antworten basieren auf geprüften Daten Ihres Finanz-Twins.", live: "Live-KI über Groq verbunden", offline: "Demo-Modus · KI nicht erreichbar", protected: "Geschützter Planungsraum", question: "Frage eingeben …", send: "Frage senden", startRecording: "Sprachfrage starten", stopRecording: "Aufnahme beenden", recording: "Aufnahme läuft – zum Beenden tippen …", voiceHint: "Mikrofon antippen, sprechen, erneut antippen. Die Antwort wird vorgelesen.", micSelect: "Mikrofon auswählen", micTitle: "Audioeingang", micHelp: "Wählen Sie das MacBook-Mikrofon, damit Chrome nicht auf das iPhone wechselt.", micPermission: "Mikrofonzugriff anfragen", noMic: "Keine Mikrofone gefunden", close: "Schließen",
    save: "Speichern", cancel: "Abbrechen", saved: "Gespeichert", details: "Details bearbeiten", notes: "Notizen", status: "Status", confirmed: "Bestätigt", review: "Prüfen", missing: "Fehlt", reset: "Demo zurücksetzen", resetDone: "Demo wurde zurückgesetzt.", local: "Auf diesem Gerät gespeichert", account: "Mein Konto", editAccount: "Antworten bearbeiten", signOut: "Abmelden", connected: "Demo-Bank verbunden", signedIn: "Sicher angemeldet",
  },
  en: {
    nav: ["Home", "Financial review", "Financial twin", "Planning", "AI assistant"], demo: "Demo data",
    trust: "Independent prototype with fictional data", trust2: "No product advice · Every number is traceable",
    greeting: "Good morning", intro: "Your finances are captured consistently. Three areas deserve a closer look now.",
    openReview: "Open financial review", ask: "Ask FinTwin", complete: "Data complete", reconciled: "7,666 transactions reconciled", current: "Up to date",
    netWorth: "Net worth", cashflow: "Free cashflow", reserve: "Emergency reserve", quality: "Data quality", month: "month", target: "Target: 6 months", matched: "Fully reconciled",
    important: "What matters now", next: "Three topics for your next step", all: "View all areas",
    mortgage: "Mortgage refix", mortgageText: "Fixed-rate period ends in 14 months", costs: "Recurring costs", costsText: "€134 per month above last year", protection: "Income protection", protectionText: "Anna’s coverage details are missing",
    cashTitle: "How your month is distributed", income: "Income", expenses: "Expenses", left: "Remaining", rise: "Recurring expenses have risen noticeably.",
    askSimple: "Just ask.", askBlurb: "By text or voice. Answers are generated from verified household data and include sources.", startVoice: "Start voice conversation", tapSpeak: "Tap to speak", noProducts: "No product suggestions or transactions",
    reviewOver: "Your financial review", reviewTitle: "Clarity, not a single score.", reviewText: "Each life area shows what is verified, what is missing, and which details you can add directly.", strength: "1 strength", checks: "3 review topics", gaps: "2 data gaps",
    ready: "Ready for an adviser conversation?", readyText: "Complete missing information and prepare your questions.", prepare: "Prepare questions",
    twinOver: "Your financial twin", twinText: "Origin, freshness and confidence remain visible for every material fact.", edit: "Edit", fact: "Fact", value: "Current value", source: "Source", confidence: "Confidence", lastSync: "Last reconciled: 30 Aug 2026",
    noSilent: "No silent changes", noSilentText: "Every correction creates a new immutable version.", sourcesVisible: "Sources stay visible", sourcesVisibleText: "Calculations and AI answers reference the same evidence.", reproducible: "Every state reproducible", reproducibleText: "Assumptions, rules and timestamps are stored.",
    planningOver: "Scenario planning", planningTitle: "What if? Calculated transparently.", planningText: "Change assumptions and see the impact immediately—without turning it into a forecast or recommendation.", financing: "Mortgage refix", pension: "Retirement", remaining: "Remaining principal", term: "Remaining term", years: "years", rateQuestion: "How does the rate change your payment?", modelOnly: "Model calculation, not a loan offer", perMonth: "per month", pensionAge: "Retirement age", monthlySaving: "Monthly contribution", goalCapital: "of target capital",
    assistantOver: "FinTwin AI assistant", assistantTitle: "Ask your finances.", assistantAccent: "In your language. With sources.", assistantBlurb: "Text or voice—answers are grounded in verified data from your financial twin.", live: "Live AI connected through Groq", offline: "Demo mode · AI unavailable", protected: "Protected planning space", question: "Type a question …", send: "Send question", startRecording: "Start voice question", stopRecording: "Stop recording", recording: "Recording—tap again to stop …", voiceHint: "Tap the microphone, speak, then tap again. The answer will be read aloud.", micSelect: "Choose microphone", micTitle: "Audio input", micHelp: "Choose the MacBook microphone so Chrome does not switch to the iPhone.", micPermission: "Request microphone access", noMic: "No microphones found", close: "Close",
    save: "Save", cancel: "Cancel", saved: "Saved", details: "Edit details", notes: "Notes", status: "Status", confirmed: "Confirmed", review: "Review", missing: "Missing", reset: "Reset demo", resetDone: "Demo was reset.", local: "Saved on this device", account: "My account", editAccount: "Edit answers", signOut: "Sign out", connected: "Demo bank connected", signedIn: "Securely signed in",
  },
} as const;

const onboardingCopy = {
  de: {
    eyebrow: "Willkommen bei FinTwin", title: "Lernen wir uns kurz kennen.", intro: "Keine Formularstrecke. Drei kurze Fragen, dann ist Ihr persönlicher Finanz-Twin bereit.",
    nameTitle: "Wie dürfen wir Sie nennen?", nameText: "So spricht FinTwin Sie im Gespräch an.", nameLabel: "Ihr Name", namePlaceholder: "z. B. Siddharth",
    worthTitle: "Wie hoch ist Ihr Nettovermögen?", worthText: "Eine gute Schätzung genügt. Gemeint sind Vermögen minus Schulden.", worthLabel: "Aktuelles Nettovermögen", worthHint: "Sie können diesen Wert später jederzeit ändern.",
    goalsTitle: "Was erwarten Sie von FinTwin?", goalsText: "Erzählen Sie es so, wie Sie es auch einem Menschen sagen würden.", goalsLabel: "Ihre Erwartungen", goalsPlaceholder: "Ich möchte verstehen, wann ich finanziell unabhängig sein kann und wo ich heute unnötig Geld verliere.",
    bankTitle: "Zum Schluss: Demo-Bank verbinden", bankText: "Für diesen Prototyp verbinden wir keine echte Bank. Jeder Account erhält denselben geprüften, synthetischen Transaktionsbestand.", bankName: "FinTwin Demo Bank", bankMeta: "7.666 fiktive Buchungen · 60 Monate · keine echten Kontodaten", bankPrivacy: "Es werden keine Bank-Zugangsdaten abgefragt.",
    continue: "Weiter", back: "Zurück", connect: "Demo-Bank verbinden", connecting: "Finanz-Twin wird vorbereitet …", finish: "FinTwin öffnen", step: "Schritt", of: "von", error: "Das Konto konnte gerade nicht gespeichert werden. Bitte versuchen Sie es erneut.", loading: "Ihr Finanz-Twin wird geladen …",
  },
  en: {
    eyebrow: "Welcome to FinTwin", title: "Let’s get to know you.", intro: "No long setup form. Three short questions, then your personal financial twin is ready.",
    nameTitle: "What should we call you?", nameText: "This is how FinTwin will address you in conversation.", nameLabel: "Your name", namePlaceholder: "e.g. Siddharth",
    worthTitle: "What is your current net worth?", worthText: "A good estimate is enough. Think assets minus debts.", worthLabel: "Current net worth", worthHint: "You can change this at any time later.",
    goalsTitle: "What do you expect from FinTwin?", goalsText: "Say it the way you would say it to another person.", goalsLabel: "Your expectations", goalsPlaceholder: "I want to understand when I can become financially independent and where I am losing money today.",
    bankTitle: "One last step: connect the demo bank", bankText: "This prototype never connects to a real bank. Every account receives the same verified synthetic transaction history.", bankName: "FinTwin Demo Bank", bankMeta: "7,666 fictional transactions · 60 months · no real account data", bankPrivacy: "We never ask for bank login details.",
    continue: "Continue", back: "Back", connect: "Connect demo bank", connecting: "Preparing your financial twin …", finish: "Open FinTwin", step: "Step", of: "of", error: "We could not save your account just now. Please try again.", loading: "Loading your financial twin …",
  },
} as const;

function money(value: number, lang: Lang, decimals = 0) {
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

export default function FinTwin() {
  const [view, setView] = useState<View>("start");
  const [lang, setLang] = useState<Lang>("de");
  const [menu, setMenu] = useState(false);
  const [version, setVersion] = useState(17);
  const [notice, setNotice] = useState("");
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [accountStatus, setAccountStatus] = useState<"loading" | "onboarding" | "ready">("loading");
  const [accountOpen, setAccountOpen] = useState(false);
  const t = copy[lang];
  useEffect(() => {
    const storedLang = localStorage.getItem("fintwin-language") as Lang | null;
    const storedProfile = localStorage.getItem("fintwin-profile");
    if (storedLang === "de" || storedLang === "en") setLang(storedLang);
    if (storedProfile) try { setProfile({ ...initialProfile, ...JSON.parse(storedProfile) }); } catch { /* ignore invalid local state */ }
    async function loadAccount() {
      try {
        const response = await fetch(`${api}/v1/account`, { cache: "no-store" });
        if (!response.ok) throw new Error("account unavailable");
        const body = await response.json();
        const saved = body.data?.profile as AccountProfile | null;
        if (saved) {
          setAccount(saved); setLang(saved.language); setProfile(current => ({ ...current, netWorth: saved.netWorth })); setAccountStatus("ready"); return;
        }
        setAccountStatus("onboarding");
      } catch {
        const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
        const local = isLocal ? localStorage.getItem("fintwin-local-account") : null;
        if (local) try { const saved = JSON.parse(local) as AccountProfile; setAccount(saved); setLang(saved.language); setProfile(current => ({ ...current, netWorth: saved.netWorth })); setAccountStatus("ready"); return; } catch { /* continue to onboarding */ }
        setAccountStatus("onboarding");
      }
    }
    void loadAccount();
  }, []);
  function switchLanguage() { const next: Lang = lang === "de" ? "en" : "de"; setLang(next); localStorage.setItem("fintwin-language", next); if (account) { const updated: AccountProfile = { ...account, language: next }; setAccount(updated); void fetch(`${api}/v1/account`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: next }) }); } }
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  async function finishOnboarding(next: AccountProfile) {
    try {
      const response = await fetch(`${api}/v1/account`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!response.ok) throw new Error("save failed");
      const body = await response.json();
      const saved = (body.data?.profile ?? next) as AccountProfile;
      setAccount(saved); setProfile(current => ({ ...current, netWorth: saved.netWorth })); setAccountStatus("ready"); setAccountOpen(false); setNotice(t.saved);
    } catch {
      const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      if (!isLocal) throw new Error("save failed");
      localStorage.setItem("fintwin-local-account", JSON.stringify(next)); setAccount(next); setProfile(current => ({ ...current, netWorth: next.netWorth })); setAccountStatus("ready"); setAccountOpen(false);
    }
  }
  function saveProfile(next: Profile) {
    setProfile(next); setVersion(v => v + 1); localStorage.setItem("fintwin-profile", JSON.stringify(next)); setNotice(t.saved);
    if (account && next.netWorth !== account.netWorth) {
      const updated = { ...account, netWorth: next.netWorth, language: lang }; setAccount(updated);
      void fetch(`${api}/v1/account`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ netWorth: next.netWorth, language: lang }) });
    }
  }
  if (accountStatus === "loading") return <AccountLoading lang={lang} onLanguage={switchLanguage} />;
  if (accountStatus === "onboarding") return <Onboarding lang={lang} initial={account} onLanguage={switchLanguage} onCancel={account ? () => setAccountStatus("ready") : undefined} onComplete={finishOnboarding} />;
  const ids: View[] = ["start", "review", "twin", "planning", "assistant"];
  const icons = [Home, BarChart3, Database, Landmark, Sparkles];
  const initials = (account?.name || "FT").split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  return <main>
    <header className="nav-shell">
      <button className="brand" onClick={() => setView("start")} aria-label={t.nav[0]}><span className="brand-symbol"><i /><i /><i /></span><span>FinTwin<small>{lang === "de" ? "Ihr Finanzbild" : "Your financial picture"}</small></span></button>
      <nav className={menu ? "nav-open" : ""} aria-label={lang === "de" ? "Hauptnavigation" : "Main navigation"}>{ids.map((id, index) => { const Icon = icons[index]; return <button key={id} className={view === id ? "active" : ""} onClick={() => { setView(id); setMenu(false); }}><Icon size={17} />{t.nav[index]}</button>; })}</nav>
      <div className="nav-end"><span className="demo-chip"><span />{t.demo}</span><button className="language-switch" onClick={switchLanguage} aria-label={lang === "de" ? "Switch to English" : "Auf Deutsch wechseln"}><strong>{lang.toUpperCase()}</strong><span>{lang === "de" ? "EN" : "DE"}</span></button><button className="profile" onClick={() => setAccountOpen(true)} title={t.account}>{initials}</button><button className="menu-button" onClick={() => setMenu(!menu)} aria-label="Menu"><Menu /></button></div>
    </header>
    <div className="trust-strip"><ShieldCheck size={15} /><span>{t.trust}</span><i />{t.trust2}</div>
    {notice && <div className="toast"><CircleCheck size={18} />{notice}<button onClick={() => setNotice("")} aria-label={t.close}><X size={16} /></button></div>}
    <div className="page-wrap">
      {view === "start" && <Start lang={lang} profile={profile} account={account!} setView={setView} />}
      {view === "review" && <Review lang={lang} setView={setView} onNotice={setNotice} />}
      {view === "twin" && <Twin lang={lang} version={version} profile={profile} saveProfile={saveProfile} />}
      {view === "planning" && <Planning lang={lang} profile={profile} />}
      {view === "assistant" && <Assistant lang={lang} account={account!} profile={profile} />}
    </div>
    <footer><span>FinTwin · {t.demo}</span><span>{lang === "de" ? "Keine Finanz-, Anlage-, Versicherungs-, Steuer- oder Rechtsberatung." : "Not financial, investment, insurance, tax or legal advice."}</span></footer>
    {accountOpen && account && <AccountDialog lang={lang} account={account} onClose={() => setAccountOpen(false)} onEdit={() => { setAccountOpen(false); setAccountStatus("onboarding"); }} />}
  </main>;
}

function AccountLoading({ lang, onLanguage }: { lang: Lang; onLanguage: () => void }) {
  const t = onboardingCopy[lang];
  return <main className="onboarding-shell"><div className="onboarding-nav"><span className="onboarding-brand"><span className="brand-symbol"><i /><i /><i /></span>FinTwin</span><button className="language-switch" onClick={onLanguage} aria-label={lang === "de" ? "Switch to English" : "Auf Deutsch wechseln"}><strong>{lang.toUpperCase()}</strong><span>{lang === "de" ? "EN" : "DE"}</span></button></div><section className="account-loading"><span className="ai-orb"><Sparkles /></span><p>{t.loading}</p><div className="loading-line"><i /><i /><i /></div></section></main>;
}

function Onboarding({ lang, initial, onLanguage, onCancel, onComplete }: { lang: Lang; initial: AccountProfile | null; onLanguage: () => void; onCancel?: () => void; onComplete: (account: AccountProfile) => Promise<void> }) {
  const t = onboardingCopy[lang];
  const [step, setStep] = useState(0); const [name, setName] = useState(initial?.name ?? ""); const [netWorth, setNetWorth] = useState(String(initial?.netWorth ?? "")); const [expectations, setExpectations] = useState(initial?.expectations ?? ""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const titles = [t.nameTitle, t.worthTitle, t.goalsTitle, t.bankTitle]; const descriptions = [t.nameText, t.worthText, t.goalsText, t.bankText];
  const valid = step === 0 ? name.trim().length > 1 : step === 1 ? netWorth !== "" && Number.isFinite(Number(netWorth)) : step === 2 ? expectations.trim().length > 4 : true;
  function next(event: FormEvent) { event.preventDefault(); if (valid) setStep(current => Math.min(3, current + 1)); }
  async function connect() { setSaving(true); setError(""); try { await onComplete({ name: name.trim(), netWorth: Number(netWorth), expectations: expectations.trim(), bankConnected: true, language: lang }); } catch { setError(t.error); setSaving(false); } }
  return <main className="onboarding-shell">
    <div className="onboarding-nav"><span className="onboarding-brand"><span className="brand-symbol"><i /><i /><i /></span>FinTwin</span><div>{onCancel && <button className="onboarding-cancel" onClick={onCancel}>{copy[lang].cancel}</button>}<button className="language-switch" onClick={onLanguage} aria-label={lang === "de" ? "Switch to English" : "Auf Deutsch wechseln"}><strong>{lang.toUpperCase()}</strong><span>{lang === "de" ? "EN" : "DE"}</span></button></div></div>
    <section className="onboarding-layout"><aside><p className="kicker"><span />{t.eyebrow}</p><h1>{t.title}</h1><p>{t.intro}</p><div className="setup-promise"><ShieldCheck /><span><strong>{lang === "de" ? "Sicher angemeldet" : "Securely signed in"}</strong><small>{lang === "de" ? "Ihr Profil gehört nur zu Ihrem Account." : "Your profile belongs only to your account."}</small></span></div></aside>
      <div className="onboarding-card"><div className="onboarding-progress"><span>{t.step} {step + 1} {t.of} 4</span><div>{[0, 1, 2, 3].map(item => <i key={item} className={item <= step ? "active" : ""} />)}</div></div><div className="onboarding-question"><span className="question-icon">{step === 0 ? <UserRound /> : step === 1 ? <TrendingUp /> : step === 2 ? <Sparkles /> : <Link2 />}</span><h2>{titles[step]}</h2><p>{descriptions[step]}</p></div>
        {step < 3 ? <form className="onboarding-form" onSubmit={next}>{step === 0 && <label>{t.nameLabel}<input autoFocus autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder={t.namePlaceholder} maxLength={80} /></label>}{step === 1 && <label>{t.worthLabel}<span className="currency-input"><b>€</b><input autoFocus type="number" inputMode="decimal" value={netWorth} onChange={event => setNetWorth(event.target.value)} placeholder="487320" /></span><small>{t.worthHint}</small></label>}{step === 2 && <label>{t.goalsLabel}<textarea autoFocus rows={5} value={expectations} onChange={event => setExpectations(event.target.value)} placeholder={t.goalsPlaceholder} maxLength={500} /><small>{expectations.length}/500</small></label>}<div className="onboarding-actions">{step > 0 && <button type="button" className="button secondary" onClick={() => setStep(current => current - 1)}>{t.back}</button>}<button className="button dark" disabled={!valid}>{t.continue}<ArrowRight /></button></div></form> : <div className="bank-connect"><div className="bank-card"><span><Landmark /></span><div><strong>{t.bankName}</strong><p>{t.bankMeta}</p></div><CircleCheck /></div><p className="privacy-note"><LockKeyhole />{t.bankPrivacy}</p>{error && <p className="onboarding-error"><CircleAlert />{error}</p>}<div className="onboarding-actions"><button type="button" className="button secondary" disabled={saving} onClick={() => setStep(2)}>{t.back}</button><button type="button" className="button dark connect-bank" disabled={saving} onClick={() => void connect()}>{saving ? <>{t.connecting}</> : <>{t.connect}<Link2 /></>}</button></div></div>}
      </div></section>
  </main>;
}

function AccountDialog({ lang, account, onClose, onEdit }: { lang: Lang; account: AccountProfile; onClose: () => void; onEdit: () => void }) {
  const t = copy[lang];
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="edit-dialog account-dialog" onMouseDown={event => event.stopPropagation()} aria-label={t.account}><button type="button" className="modal-close" onClick={onClose} aria-label={t.close}><X /></button><span className="account-avatar">{account.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><div><p className="kicker dark">{t.account}</p><h2>{account.name}</h2><p className="account-status"><ShieldCheck />{t.signedIn}</p></div><div className="account-facts"><div><span>{t.netWorth}</span><strong>{money(account.netWorth, lang)}</strong></div><div><span>{lang === "de" ? "Erwartungen" : "Expectations"}</span><p>{account.expectations}</p></div><div><span>{lang === "de" ? "Datenverbindung" : "Data connection"}</span><strong><CircleCheck />{t.connected}</strong></div></div><div className="dialog-actions account-actions"><a className="button secondary" href="/signout-with-chatgpt?return_to=/" target="_top"><LogOut />{t.signOut}</a><button className="button dark" onClick={onEdit}><Edit3 />{t.editAccount}</button></div></section></div>;
}

function Start({ lang, profile, account, setView }: { lang: Lang; profile: Profile; account: AccountProfile; setView: (view: View) => void }) {
  const t = copy[lang]; const netWorth = profile.netWorth;
  const topics = [[t.mortgage, t.mortgageText, "amber", Landmark], [t.costs, t.costsText, "coral", WalletCards], [t.protection, t.protectionText, "blue", ShieldCheck]] as const;
  return <>
    <section className="hero"><div className="hero-copy"><p className="kicker"><span />{lang === "de" ? "Finanzlage · 30. August 2026" : "Financial position · 30 August 2026"}</p><h1>{t.greeting},<br /><em>{account.name}.</em></h1><p>{t.intro}</p><p className="goal-line"><Sparkles />{account.expectations}</p><div className="hero-actions"><button className="button light" onClick={() => setView("review")}>{t.openReview} <ArrowRight size={17} /></button><button className="button ghost" onClick={() => setView("assistant")}><Mic size={17} /> {t.ask}</button></div></div><div className="hero-score"><div className="score-ring"><span><strong>96</strong><small>%</small></span></div><div><strong>{t.complete}</strong><p>{t.reconciled}</p><span className="verified"><Check size={13} /> {t.current}</span></div></div></section>
    <section className="numbers" aria-label="Metrics"><article><p>{t.netWorth}</p><strong>{money(netWorth, lang)}</strong><span className="up"><TrendingUp size={14} /> {money(18460, lang)} · 12M</span></article><article><p>{t.cashflow}</p><strong>{money(568, lang)} <small>/ {t.month}</small></strong><span className="down">{money(185, lang)} {lang === "de" ? "unter Vorjahr" : "below last year"}</span></article><article><p>{t.reserve}</p><strong>{profile.runway.toLocaleString(lang === "de" ? "de-DE" : "en-GB")} <small>{lang === "de" ? "Monate" : "months"}</small></strong><span className="up"><Check size={14} /> {t.target}</span></article><article><p>{t.quality}</p><strong>100 %</strong><span><Database size={14} /> {t.matched}</span></article></section>
    <section className="section-head"><div><p className="kicker dark">{t.important}</p><h2>{t.next}</h2></div><button className="text-button" onClick={() => setView("review")}>{t.all} <ArrowRight size={16} /></button></section>
    <section className="topic-grid">{topics.map(([title, text, tone, Icon]) => <button key={title} className="topic-card" onClick={() => setView("review")}><span className={`topic-icon ${tone}`}><Icon /></span><span><small>{title}</small><strong>{text}</strong><em>{lang === "de" ? "Öffnen und Angaben ergänzen" : "Open and add details"}</em></span><ChevronRight /></button>)}</section>
    <section className="flow-grid"><article className="panel cash-panel"><div className="panel-title"><div><p className="kicker dark">Cashflow</p><h2>{t.cashTitle}</h2></div><span>{lang === "de" ? "August 2026" : "August 2026"}</span></div><div className="flow"><div><span>{t.income}</span><strong>{money(profile.income, lang)}</strong></div><ArrowRight /><div><span>{t.expenses}</span><strong>{money(profile.income - 568, lang)}</strong></div><ArrowRight /><div className="flow-result"><span>{t.left}</span><strong>{money(568, lang)}</strong></div></div><div className="mini-chart">{[48,54,51,60,58,66,64,72,62,55,49,43].map((v,i)=><i key={i} style={{height:`${v}%`}} className={i>8?"warn":""} />)}</div><p className="insight"><CircleAlert size={16} /> {t.rise}</p></article><article className="panel ask-preview"><span className="ai-orb"><Sparkles /></span><p className="kicker dark">FinTwin AI</p><h2>{t.askSimple}</h2><p>{t.askBlurb}</p><button className="voice-preview" onClick={() => setView("assistant")}><span><Mic /></span><strong>{t.startVoice}</strong><small>{t.tapSpeak}</small><Play size={18} /></button><p className="safe"><ShieldCheck size={14} /> {t.noProducts}</p></article></section>
  </>;
}

const reviewData: Record<ReviewKey, { de: [string,string,string]; en: [string,string,string] }> = {
  protection:{de:["Absicherung","Daten ergänzen","Annas Einkommensschutz ist nicht bestätigt"],en:["Protection","Add details","Anna’s income protection is not confirmed"]},
  retirement:{de:["Altersvorsorge","Prüfen","Netto-Rentenansprüche fehlen"],en:["Retirement","Review","Confirmed net pension income is missing"]},
  wealth:{de:["Vermögensaufbau","Gut aufgestellt","Depotbeiträge sind vollständig abgeglichen"],en:["Wealth building","Well positioned","Investment contributions are fully reconciled"]},
  home:{de:["Wohneigentum","Handlungsbedarf","Zinsbindung endet am 31.10.2027"],en:["Home ownership","Action needed","Fixed-rate period ends on 31 Oct 2027"]},
  liquidity:{de:["Sparen & Liquidität","Beobachten","Laufende Kosten steigen"],en:["Saving & liquidity","Monitor","Recurring costs are rising"]},
  family:{de:["Familie & Bildung","Ziel klären","Zielbetrag und Zeitpunkt fehlen"],en:["Family & education","Clarify goal","Target amount and date are missing"]},
};

function Review({ lang, setView, onNotice }: { lang: Lang; setView: (view: View) => void; onNotice: (text: string) => void }) {
  const t = copy[lang]; const [selected, setSelected] = useState<ReviewKey | null>(null);
  const [details, setDetails] = useState<Record<string,{status:string;notes:string}>>({});
  useEffect(()=>{const raw=localStorage.getItem("fintwin-review-details");if(raw)try{setDetails(JSON.parse(raw));}catch{}},[]);
  function save(key: ReviewKey, value:{status:string;notes:string}){const next={...details,[key]:value};setDetails(next);localStorage.setItem("fintwin-review-details",JSON.stringify(next));setSelected(null);onNotice(t.saved);}
  return <><PageHead overline={t.reviewOver} title={t.reviewTitle} text={t.reviewText} /><div className="review-summary"><span><CircleCheck /> {t.strength}</span><span><CircleAlert /> {t.checks}</span><span><Database /> {t.gaps}</span></div><section className="review-list">{(Object.keys(reviewData) as ReviewKey[]).map((key,index)=>{const row=reviewData[key][lang];const tone=index===2?"good":index===1||index===4?"check":"open";return <button className="review-row" key={key} onClick={()=>setSelected(key)}><span className={`status-dot ${tone}`} /><span className="review-row-copy"><small>{row[0]}</small><strong>{row[1]}</strong><p>{details[key]?.notes||row[2]}</p></span><span className="row-action"><Edit3 size={15}/>{t.edit}</span><ChevronRight /></button>})}</section><div className="next-banner"><div><FileText /><span><strong>{t.ready}</strong><p>{t.readyText}</p></span></div><button className="button dark" onClick={() => setView("assistant")}>{t.prepare} <ArrowRight /></button></div>{selected&&<ReviewDialog lang={lang} itemKey={selected} initial={details[selected]} onClose={()=>setSelected(null)} onSave={save}/>}</>;
}

function ReviewDialog({lang,itemKey,initial,onClose,onSave}:{lang:Lang;itemKey:ReviewKey;initial?:{status:string;notes:string};onClose:()=>void;onSave:(key:ReviewKey,value:{status:string;notes:string})=>void}){
  const t=copy[lang];const item=reviewData[itemKey][lang];const [status,setStatus]=useState(initial?.status||"review");const [notes,setNotes]=useState(initial?.notes||item[2]);
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="edit-dialog" onSubmit={e=>{e.preventDefault();onSave(itemKey,{status,notes})}} onMouseDown={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={onClose} aria-label={t.close}><X/></button><p className="kicker dark">{item[0]}</p><h2>{t.details}</h2><label>{t.status}<select value={status} onChange={e=>setStatus(e.target.value)}><option value="confirmed">{t.confirmed}</option><option value="review">{t.review}</option><option value="missing">{t.missing}</option></select></label><label>{t.notes}<textarea rows={5} value={notes} onChange={e=>setNotes(e.target.value)}/></label><p className="local-note"><Database size={14}/>{t.local}</p><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>{t.cancel}</button><button className="button dark"><Save size={16}/>{t.save}</button></div></form></div>;
}

const factDefs: Array<{key:keyof Profile;de:string;en:string;source:string;confidence:string}> = [
  {key:"netWorth",de:"Angegebenes Nettovermögen",en:"Declared net worth",source:"Onboarding",confidence:"100 %"}, {key:"income",de:"Nettoeinkommen",en:"Net household income",source:"Demo bank",confidence:"100 %"}, {key:"assets",de:"Finanzvermögen",en:"Financial assets",source:"Demo model",confidence:"98 %"}, {key:"property",de:"Immobilie",en:"Property",source:"Demo model",confidence:"90 %"}, {key:"mortgage",de:"Hypothek",en:"Mortgage",source:"Demo model",confidence:"99 %"}, {key:"retirementAge",de:"Renten-Zielalter",en:"Retirement target age",source:"Confirmed",confidence:"100 %"}, {key:"runway",de:"Notfallreserve",en:"Emergency runway",source:"Calculated",confidence:"100 %"},
];

function Twin({lang,version,profile,saveProfile}:{lang:Lang;version:number;profile:Profile;saveProfile:(profile:Profile)=>void}){
  const t=copy[lang];const [editing,setEditing]=useState<keyof Profile|null>(null);
  function display(key:keyof Profile){const value=profile[key];if(["netWorth","income","assets","property","mortgage"].includes(key))return key==="income"?`${money(value,lang)} / ${t.month}`:money(value,lang);if(key==="retirementAge")return `${value} ${lang==="de"?"Jahre":"years"}`;return `${value.toLocaleString(lang==="de"?"de-DE":"en-GB")} ${lang==="de"?"Monate":"months"}`}
  return <><PageHead overline={t.twinOver} title={`${lang==="de"?"Version":"Version"} ${version}. ${lang==="de"?"Vollständig nachvollziehbar.":"Fully traceable."}`} text={t.twinText}/><section className="panel twin-card"><div className="twin-top"><span><Database/>FinTwin v{version}</span><small>{t.lastSync}</small></div><div className="fact-table"><div className="fact-head"><span>{t.fact}</span><span>{t.value}</span><span>{t.source}</span><span>{t.confidence}</span><span/></div>{factDefs.map(def=><div className="fact-row" key={def.key}><strong>{lang==="de"?def.de:def.en}</strong><span>{display(def.key)}</span><span className="source">{def.source}</span><span>{def.confidence}</span><button onClick={()=>setEditing(def.key)}><Edit3 size={13}/>{t.edit}</button></div>)}</div></section><section className="principle-grid"><article><ShieldCheck/><h3>{t.noSilent}</h3><p>{t.noSilentText}</p></article><article><Database/><h3>{t.sourcesVisible}</h3><p>{t.sourcesVisibleText}</p></article><article><RotateCcw/><h3>{t.reproducible}</h3><p>{t.reproducibleText}</p></article></section>{editing&&<FactDialog lang={lang} field={editing} value={profile[editing]} onClose={()=>setEditing(null)} onSave={value=>{saveProfile({...profile,[editing]:value});setEditing(null)}}/>}</>;
}

function FactDialog({lang,field,value,onClose,onSave}:{lang:Lang;field:keyof Profile;value:number;onClose:()=>void;onSave:(value:number)=>void}){const t=copy[lang];const def=factDefs.find(x=>x.key===field)!;const [next,setNext]=useState(value);return <div className="modal-backdrop" onMouseDown={onClose}><form className="edit-dialog compact" onSubmit={e=>{e.preventDefault();onSave(next)}} onMouseDown={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={onClose}><X/></button><p className="kicker dark">{t.twinOver}</p><h2>{lang==="de"?def.de:def.en}</h2><label>{t.value}<input autoFocus type="number" step={field==="runway"?.1:1} min="0" value={next} onChange={e=>setNext(Number(e.target.value))}/></label><p className="local-note"><ShieldCheck size={14}/>{lang==="de"?"Bestätigung erstellt eine neue Twin-Version.":"Confirmation creates a new twin version."}</p><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>{t.cancel}</button><button className="button dark"><Save size={16}/>{t.save}</button></div></form></div>}

function Planning({lang,profile}:{lang:Lang;profile:Profile}){
  const t=copy[lang];const [tab,setTab]=useState<"mortgage"|"retirement">("mortgage");const [principal,setPrincipal]=useState(profile.mortgage);const [years,setYears]=useState(20);const [age,setAge]=useState(profile.retirementAge);const [saving,setSaving]=useState(850);
  const payments=useMemo(()=>[4,5,6].map(rate=>{const months=years*12,r=rate/100/12;return principal*r/(1-Math.pow(1+r,-months))}),[principal,years]);
  const projected=useMemo(()=>{const months=Math.max(1,(age-52)*12),r=.035/12;return profile.assets*Math.pow(1+r,months)+saving*((Math.pow(1+r,months)-1)/r)},[age,saving,profile.assets]);const required=325714;const ratio=Math.min(199,Math.round(projected/required*100));
  return <><PageHead overline={t.planningOver} title={t.planningTitle} text={t.planningText}/><div className="plan-tabs"><button className={tab==="mortgage"?"active":""} onClick={()=>setTab("mortgage")}><Landmark/>{t.financing}</button><button className={tab==="retirement"?"active":""} onClick={()=>setTab("retirement")}><TrendingUp/>{t.pension}</button></div>{tab==="mortgage"?<section className="scenario editable-scenario"><div className="scenario-copy"><p className="kicker dark">{t.financing}</p><h2>{t.rateQuestion}</h2><label>{t.remaining}<span>{money(principal,lang)}</span><input type="range" min="50000" max="600000" step="5000" value={principal} onChange={e=>setPrincipal(Number(e.target.value))}/></label><label>{t.term}<span>{years} {t.years}</span><input type="range" min="5" max="35" value={years} onChange={e=>setYears(Number(e.target.value))}/></label><div className="assumption"><ShieldCheck/>{t.modelOnly}</div></div><div className="rate-cards">{[4,5,6].map((rate,i)=><article className={i===1?"focus":""} key={rate}><span>{rate} %</span><strong>{money(payments[i],lang,2)}</strong><small>{t.perMonth}</small><em>{i===0?(lang==="de"?"Basis":"Baseline"):`+ ${money(payments[i]-payments[0],lang,2)}`}</em></article>)}</div></section>:<section className="scenario editable-scenario retirement"><div className="scenario-copy"><p className="kicker dark">{t.pension}</p><h2>{ratio} % {t.goalCapital}</h2><label>{t.pensionAge}<span>{age}</span><input type="range" min="58" max="70" value={age} onChange={e=>setAge(Number(e.target.value))}/></label><label>{t.monthlySaving}<span>{money(saving,lang)}</span><input type="range" min="0" max="2500" step="50" value={saving} onChange={e=>setSaving(Number(e.target.value))}/></label><p>{money(projected,lang)} {lang==="de"?"modelliertes Kapital":"modelled capital"}</p></div><div className="retire-ring" style={{background:`conic-gradient(var(--teal) 0 ${Math.min(100,ratio)}%,#dfe8e4 ${Math.min(100,ratio)}%)`}}><span><strong>{ratio}</strong>%</span></div></section>}</>;
}

function Assistant({lang,account,profile}:{lang:Lang;account:AccountProfile;profile:Profile}){
  const t=copy[lang];const welcome=lang==="de"?`Hallo ${account.name}. Ich kenne jetzt Ihr Ziel: ${account.expectations} Womit möchten Sie anfangen? Sie können tippen oder einfach sprechen.`:`Hi ${account.name}. I know what you want from FinTwin: ${account.expectations} Where would you like to start? You can type or simply speak.`;const [messages,setMessages]=useState<Message[]>([{role:"assistant",text:welcome,sources:["account_profile","shared_demo_ledger"],mode:"start"}]);
  const [input,setInput]=useState("");const [loading,setLoading]=useState(false);const [listening,setListening]=useState(false);const [aiLive,setAiLive]=useState(false);const [devices,setDevices]=useState<MediaDeviceInfo[]>([]);const [deviceId,setDeviceId]=useState("");const [micOpen,setMicOpen]=useState(false);const recorder=useRef<MediaRecorder|null>(null);const chunks=useRef<Blob[]>([]);const stream=useRef<MediaStream|null>(null);
  useEffect(()=>{fetch(`${api}/health`).then(r=>r.json()).then(v=>setAiLive(Boolean(v.ai_available))).catch(()=>setAiLive(false));},[]);
  useEffect(()=>{setMessages(m=>m.length===1?[{...m[0],text:lang==="de"?`Hallo ${account.name}. Ich kenne jetzt Ihr Ziel: ${account.expectations} Womit möchten Sie anfangen? Sie können tippen oder einfach sprechen.`:`Hi ${account.name}. I know what you want from FinTwin: ${account.expectations} Where would you like to start? You can type or simply speak.`}]:m)},[lang,account.name,account.expectations]);
  async function ask(question:string){if(!question.trim()||loading)return;setMessages(m=>[...m,{role:"user",text:question}]);setInput("");setLoading(true);let reply:Message;try{const body=await fetch(`${api}/v1/households/shared-demo/copilot/turns`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({question,language:lang,profile:{name:account.name,netWorth:profile.netWorth,expectations:account.expectations}})}).then(r=>r.ok?r.json():Promise.reject());reply={role:"assistant",text:body.data.display_response,sources:body.data.claims.flatMap((c:{source_ids:string[]})=>c.source_ids),mode:body.data.mode};setAiLive(["groq_live","openai_live"].includes(body.data.mode));}catch{reply=localAnswer(question,lang,account,profile)}setMessages(m=>[...m,reply]);setLoading(false);speak(reply.text)}
  function submit(e:FormEvent){e.preventDefault();void ask(input)}
  function speak(text:string){if("speechSynthesis" in window){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang=lang==="de"?"de-DE":"en-GB";utterance.rate=.96;speechSynthesis.speak(utterance)}}
  async function loadDevices(){try{const probe=await navigator.mediaDevices.getUserMedia({audio:true});const all=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="audioinput");setDevices(all);const preferred=all.find(d=>/macbook/i.test(d.label)&&!/iphone/i.test(d.label))||all[0];if(!deviceId&&preferred)setDeviceId(preferred.deviceId);probe.getTracks().forEach(track=>track.stop())}catch{setMessages(m=>[...m,{role:"assistant",text:lang==="de"?"Der Mikrofonzugriff wurde nicht erlaubt. Öffnen Sie die Website-Einstellungen in Chrome und erlauben Sie das Mikrofon.":"Microphone access was not allowed. Open Chrome’s site settings and allow microphone access."}])}}
  async function toggleVoice(){if(listening){recorder.current?.stop();return}if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){setMessages(m=>[...m,{role:"assistant",text:lang==="de"?"Dieser Browser unterstützt keine Audioaufnahme.":"This browser does not support audio recording."}]);return}try{stream.current=await navigator.mediaDevices.getUserMedia({audio:deviceId?{deviceId:{exact:deviceId},echoCancellation:true,noiseSuppression:true}:{echoCancellation:true,noiseSuppression:true}});const all=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="audioinput");setDevices(all);if(!deviceId){const active=stream.current.getAudioTracks()[0].getSettings().deviceId;setDeviceId(active||"")}chunks.current=[];const active=new MediaRecorder(stream.current,{mimeType:MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":"audio/webm"});recorder.current=active;active.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)};active.onstop=async()=>{setListening(false);stream.current?.getTracks().forEach(track=>track.stop());const audio=new Blob(chunks.current,{type:active.mimeType});if(audio.size<500){setMessages(m=>[...m,{role:"assistant",text:lang==="de"?"Ich habe keine verständliche Aufnahme erhalten. Bitte sprechen Sie etwas länger.":"I did not receive a usable recording. Please speak for a little longer."}]);return}setLoading(true);try{const form=new FormData();form.set("audio",audio,"question.webm");form.set("language",lang);const body=await fetch(`${api}/v1/households/hh_becker/voice/transcribe`,{method:"POST",body:form}).then(r=>r.ok?r.json():Promise.reject());const transcript=body.data.transcript;if(!transcript)throw new Error();setInput(transcript);setLoading(false);await ask(transcript)}catch{setLoading(false);setMessages(m=>[...m,{role:"assistant",text:lang==="de"?"Die Aufnahme konnte nicht transkribiert werden. Prüfen Sie Mikrofon und Verbindung.":"The recording could not be transcribed. Check the microphone and connection."}])}};setListening(true);active.start()}catch{setListening(false);setMicOpen(true);await loadDevices()}}
  const suggestions=lang==="de"?["Wann erreiche ich 1 Million Euro?","Wofür gebe ich am meisten aus?","Was bedeutet ein Zins von 6 %?"]:["When could I reach €1 million?","What do I spend most on?","What would a 6% rate mean?"];
  return <section className="assistant-page"><div className="assistant-intro"><p className="kicker dark"><Sparkles/>{t.assistantOver}</p><h1>{t.assistantTitle}<br/><em>{t.assistantAccent}</em></h1><p>{t.assistantBlurb}</p><div className={`ai-status ${aiLive?"live":"demo"}`}><span/>{aiLive?t.live:t.offline}</div></div><div className="chat-card"><div className="chat-top"><span><Bot/>FinTwin</span><div className="chat-tools"><button onClick={()=>{setMicOpen(!micOpen);if(!devices.length)void loadDevices()}} aria-label={t.micSelect}><Settings2/>{t.micSelect}</button><small><ShieldCheck/>{t.protected}</small></div></div>{micOpen&&<div className="mic-panel"><div><strong>{t.micTitle}</strong><p>{t.micHelp}</p></div>{devices.length?<select value={deviceId} onChange={e=>setDeviceId(e.target.value)}>{devices.map((d,i)=><option value={d.deviceId} key={d.deviceId}>{d.label||`${t.micTitle} ${i+1}`}</option>)}</select>:<button onClick={()=>void loadDevices()}>{t.micPermission}</button>}</div>}<div className="messages" aria-live="polite">{messages.map((m,i)=><div className={`message ${m.role}`} key={i}><span>{m.role==="assistant"?<Sparkles/>:account.name.slice(0,2).toUpperCase()}</span><div><p>{m.text}</p>{m.sources&&m.sources.length>0&&<details><summary><Database size={13}/>{m.sources.length} {lang==="de"?"Quellen anzeigen":"sources"}</summary>{m.sources.slice(0,5).map(s=><code key={s}>{s}</code>)}</details>}</div></div>)}{loading&&<div className="typing"><i/><i/><i/></div>}</div><div className="suggestions">{suggestions.map(s=><button key={s} onClick={()=>setInput(s)}>{s}</button>)}</div><form className="composer" onSubmit={submit}><button type="button" className={`mic ${listening?"listening":""}`} onClick={()=>void toggleVoice()} aria-label={listening?t.stopRecording:t.startRecording}>{listening?<MicOff/>:<Mic/>}</button><label><span className="sr-only">{t.question}</span><input value={input} onChange={e=>setInput(e.target.value)} placeholder={listening?t.recording:t.question}/></label><button type="submit" disabled={!input.trim()||loading} aria-label={t.send}><Send/></button></form><p className="voice-note"><Volume2 size={13}/>{t.voiceHint}</p></div></section>;
}

function PageHead({overline,title,text}:{overline:string;title:string;text:string}){return <section className="page-head"><p className="kicker dark">{overline}</p><h1>{title}</h1><p>{text}</p></section>}
function localAnswer(q:string,lang:Lang,account:AccountProfile,profile:Profile):Message{const lower=q.toLowerCase();const million=lower.includes("million")||lower.includes("1.000.000")||lower.includes("1000000");if(million)return{role:"assistant",text:lang==="de"?`${account.name}, Sie sind deutlich näher dran als 71 Jahre. Wenn Ihr heutiges Nettovermögen von ${money(profile.netWorth,lang)} ebenfalls 4 % pro Jahr wächst und Sie monatlich 568 € investieren, läge die Million grob Anfang 2041. Wenn nur die neuen Einzahlungen wachsen und Ihr heutiges Vermögen unverändert bleibt, wäre es eher 2061. Der Unterschied ist wichtig – als Nächstes sollten wir trennen, welcher Teil Ihres Vermögens tatsächlich investierbar ist.`:`${account.name}, you are much closer than 71 years. If your current ${money(profile.netWorth,lang)} also grows at 4% a year and you invest €568 each month, you would reach €1 million around early 2041. If only the new contributions grow while today’s net worth stays flat, it is closer to 2061. That difference matters—next, we should separate the part of your wealth that is actually investable.`,sources:["account_net_worth","goal_projection_4pct","agg_cashflow_202608"],mode:"fallback"};const rate=lower.includes("6")||lower.includes("zins")||lower.includes("rate");if(rate)return{role:"assistant",text:lang==="de"?`${account.name}, bei 240.000 € Restschuld und 20 Jahren läge die Rate bei 6 % bei rund 1.719,43 € im Monat. Das wären etwa 265 € mehr als im 4-%-Szenario. Es ist eine Modellrechnung, kein Kreditangebot – aber sie zeigt gut, wie viel Puffer Sie für die Anschlussfinanzierung brauchen.`:`${account.name}, with €240,000 remaining over 20 years, a 6% rate would mean roughly €1,719.43 a month—about €265 more than the 4% scenario. It is a model calculation, not a loan offer, but it gives you a useful sense of the buffer you may need.`,sources:["scenario_mortgage_6","fact_mortgage_balance"],mode:"fallback"};return{role:"assistant",text:lang==="de"?`${account.name}, im August kamen 7.240 € von außen herein und 6.672 € gingen ab. Damit blieben 568 € frei. Eigene Überträge habe ich herausgerechnet, damit das Bild nicht künstlich aufgebläht wird.`:`${account.name}, €7,240 came in from outside the household in August and €6,672 went out, leaving €568 free. I excluded transfers between your own accounts so the picture is not artificially inflated.`,sources:["agg_cashflow_202608","transfer_matches_202608"],mode:"fallback"}}
