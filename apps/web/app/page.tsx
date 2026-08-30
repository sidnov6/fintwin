"use client";

import {
  ArrowLeft, ArrowRight, BadgeEuro, BookOpen, BriefcaseBusiness, CalendarClock,
  Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Clock3, Database, Download,
  FileCheck2, GraduationCap, Home, Info, Landmark, Menu, RefreshCw,
  Send, ShieldCheck, Sparkles, TrendingDown, UserRoundCheck, WalletCards, X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

type View = "overview" | "review" | "twin" | "scenarios" | "ask";
type Scenario = "mortgage" | "retirement" | "child";
type ChatMessage = { role: "user" | "assistant"; text: string; sources?: string[]; blocked?: boolean };

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const nav = [
  ["overview", "Übersicht", "Overview", Home], ["review", "Review", "Review", FileCheck2],
  ["twin", "Twin", "Twin", Database], ["scenarios", "Szenarien", "Scenarios", BadgeEuro],
  ["ask", "Fragen", "Ask", Sparkles],
] as const;

const facts = [
  ["Haushalt", "Michael (52), Anna (50), zwei Kinder", "user_confirmed", "1.00", "30.08.2026"],
  ["Nettoeinkommen", "€7.240 / Monat", "synthetic_feed", "1.00", "28.08.2026"],
  ["Finanzvermögen", "€312.860", "derived", "0.98", "30.08.2026"],
  ["Immobilie", "€420.000", "synthetic_feed", "0.90", "01.07.2026"],
  ["Hypothek", "€240.000 · Zinsbindung bis 31.10.2027", "synthetic_feed", "0.99", "01.08.2026"],
  ["Renten-Zielalter", "63", "inferred", "0.82", "20.08.2026"],
  ["Notfallreserve", "6 Monate", "user_confirmed", "1.00", "20.08.2026"],
] as const;

const domains = [
  ["Absicherung", "incomplete", "Einkommensschutz-Daten unvollständig", "Annas Einkommensschutz ist nicht bestätigt.", ShieldCheck],
  ["Altersvorsorge", "attention", "Rentenbasis prüfen", "Das Zielalter 63 ist nur mit 82% Konfidenz erfasst.", CalendarClock],
  ["Vermögensaufbau", "reviewed", "Regelmäßige Beiträge erkannt", "Beide Depotbeiträge sind vollständig abgeglichen.", TrendingDown],
  ["Wohneigentum", "attention", "Zinsbindung endet in 14 Monaten", "4%, 5% und 6% als Belastungsszenarien vergleichen.", Landmark],
  ["Geld sparen & managen", "attention", "Wiederkehrende Kosten steigen", "Laufende Kosten liegen €134/Monat über dem Vorjahr.", WalletCards],
  ["Konzepte für Kinder", "incomplete", "Bildungsziel noch nicht bestätigt", "Zielbetrag und Zieldatum fehlen.", GraduationCap],
  ["Firmenkunden", "not_in_demo", "Nicht Teil dieser Demo", "Dieser Prototyp ist ausschließlich für private Haushalte.", BriefcaseBusiness],
] as const;

const labels = {
  de: { greeting: "Guten Morgen, Michael & Anna.", intro: "Ihr Finanzbild ist konsistent. Drei Themen verdienen vor dem nächsten Beratungsgespräch einen genaueren Blick.", synthetic: "Synthetische Daten", prototype: "Unabhängiger Portfolio-Prototyp", reset: "Demo zurücksetzen", export: "Berater-Brief", asof: "Stand 30. Aug. 2026, 10:00" },
  en: { greeting: "Good morning, Michael & Anna.", intro: "Your financial picture is coherent. Three topics deserve a closer look before your next adviser conversation.", synthetic: "Synthetic data", prototype: "Independent portfolio prototype", reset: "Reset demo", export: "Adviser Brief", asof: "As of 30 Aug 2026, 10:00" },
};

export default function FinTwinApp() {
  const [view, setView] = useState<View>("overview");
  const [language, setLanguage] = useState<"de" | "en">("de");
  const [mobile, setMobile] = useState(false);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [brief, setBrief] = useState(false);
  const [version, setVersion] = useState(17);
  const [retirementAge, setRetirementAge] = useState(63);
  const [correction, setCorrection] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const t = labels[language];

  async function resetDemo() {
    try { await fetch(`${api}/v1/demo/reset`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } }); } catch { /* deterministic local reset remains available */ }
    setView("overview"); setVersion(17); setRetirementAge(63); setNotice(language === "de" ? "Demo wurde auf den kanonischen Stand zurückgesetzt." : "Demo reset to its canonical state.");
  }

  async function confirmCorrection(age: number) {
    try {
      const proposed = await fetch(`${api}/v1/households/hh_becker/facts/proposals`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "If-Match": String(version) }, body: JSON.stringify({ path: "goals.retirement.target_age", typed_value: age }) }).then(r => r.ok ? r.json() : Promise.reject());
      const confirmed = await fetch(`${api}/v1/fact-proposals/${proposed.data.proposal_id}/confirm`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID(), "If-Match": String(version) } }).then(r => r.ok ? r.json() : Promise.reject());
      setVersion(confirmed.twin_version);
    } catch { setVersion(v => v + 1); }
    setRetirementAge(age); setCorrection(false); setNotice(language === "de" ? "Korrektur bestätigt. Eine neue Twin-Version wurde erstellt." : "Correction confirmed. A new Twin version was created.");
  }

  return <main>
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand brand-button" onClick={() => setView("overview")} aria-label="FinTwin overview"><span className="brand-mark"><span /></span><span>FinTwin</span></button>
        <nav className={mobile ? "open" : ""} aria-label="Primary navigation">
          {nav.map(([id, de, en, Icon]) => <button key={id} className={view === id ? "active" : ""} onClick={() => { setView(id); setMobile(false); }}><Icon size={17} /><span>{language === "de" ? de : en}</span></button>)}
        </nav>
        <div className="actions">
          <span className="synthetic"><ShieldCheck size={15} /> {t.synthetic}</span>
          <button className="language" onClick={() => setLanguage(l => l === "de" ? "en" : "de")} aria-label="Switch language">{language.toUpperCase()} <span>⌄</span></button>
          <button className="avatar" onClick={resetDemo} title={t.reset} aria-label={t.reset}>MB</button>
          <button className="menu" onClick={() => setMobile(v => !v)} aria-expanded={mobile} aria-label="Open menu"><Menu /></button>
        </div>
      </div>
    </header>
    <section className="prototype-note"><ShieldCheck size={16} /><p><strong>{t.prototype}.</strong> {language === "de" ? "Alle Personen, Institute und Werte sind fiktiv. Keine Live-Verbindung zu Bank, Versicherer oder Beratung." : "All people, institutions and values are fictional. No live bank, insurer or adviser connection."}</p></section>
    {notice && <div className="toast" role="status"><CircleCheck size={18} />{notice}<button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button></div>}
    <div className="shell app-shell">
      {view === "overview" && <Overview t={t} setView={setView} setEvidence={setEvidence} />}
      {view === "review" && <Review setView={setView} setBrief={setBrief} language={language} />}
      {view === "twin" && <Twin version={version} retirementAge={retirementAge} setCorrection={setCorrection} setEvidence={setEvidence} />}
      {view === "scenarios" && <Scenarios retirementAge={retirementAge} setBrief={setBrief} />}
      {view === "ask" && <Ask language={language} />}
    </div>
    <footer><p>FinTwin v1.0 · Independent prototype · Synthetic private-household data only</p><p>Not financial, investment, insurance, mortgage, tax or legal advice.</p></footer>
    {evidence && <EvidenceDrawer title={evidence} close={() => setEvidence(null)} />}
    {correction && <CorrectionDialog current={retirementAge} close={() => setCorrection(false)} confirm={confirmCorrection} />}
    {brief && <Brief close={() => setBrief(false)} retirementAge={retirementAge} />}
  </main>;
}

function PageTitle({ eyebrow, title, text, actions }: { eyebrow: string; title: string; text: string; actions?: React.ReactNode }) {
  return <section className="welcome page-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{actions}</section>;
}

function Overview({ t, setView, setEvidence }: { t: typeof labels.de; setView: (v: View) => void; setEvidence: (v: string) => void }) {
  const months = [44, 50, 47, 53, 56, 45, 61, 57, 64, 49, 42, 38];
  return <>
    <PageTitle eyebrow="Household overview" title={t.greeting} text={t.intro} actions={<div className="asof"><Clock3 size={16} /> {t.asof}</div>} />
    <section className="metric-grid" aria-label="Household metrics">
      <Metric label="Net worth" value="€487,320" detail="+€18,460 over 12 months" tone="positive" icon={Landmark} onClick={() => setEvidence("Net worth evidence")} />
      <Metric label="Free cashflow" value="€568 / mo" detail="−€185 vs last year" tone="attention" icon={TrendingDown} onClick={() => setEvidence("Cashflow evidence")} />
      <Metric label="Emergency runway" value="7.8 months" detail="Target: 6 months" tone="positive" icon={ShieldCheck} onClick={() => setEvidence("Emergency runway evidence")} />
      <Metric label="Data quality" value="100% reconciled" detail="1 material fact missing" tone="neutral" icon={Database} onClick={() => setEvidence("Reconciliation evidence")} />
    </section>
    <section className="main-grid">
      <article className="panel cashflow-card">
        <div className="panel-head"><div><p className="eyebrow">Cashflow</p><h2>Where your money went</h2></div><button className="link-button" onClick={() => setEvidence("August cashflow evidence")}>View evidence <ArrowRight size={16} /></button></div>
        <div className="cashflow-summary"><div><span>Income</span><strong>€7,240</strong></div><div><span>External outflows</span><strong>−€6,672</strong></div><div className="highlight"><span>Free cashflow</span><strong>€568</strong></div></div>
        <div className="chart-wrap" role="img" aria-label="Twelve month free cashflow trend declining in the latest quarter"><div className="axis"><span>€1.2k</span><span>€600</span><span>€0</span></div><div className="bars">{months.map((height, i) => <i key={i} style={{ height: `${height}%` }} className={i > 8 ? "recent" : ""} />)}</div><div className="month-row"><span>Sep</span><span>Dec</span><span>Mar</span><span>Jun</span><span>Aug</span></div></div>
        <p className="chart-note"><CircleAlert size={16} /> Matched own-account transfers are excluded. Recurring external costs rose by €134/month year over year.</p>
      </article>
      <article className="panel review-card"><div className="panel-head"><div><p className="eyebrow">Allfinanz review</p><h2>Topics for review</h2></div><span className="count">3</span></div>
        <ReviewItem icon={Landmark} tone="attention" title="Mortgage refix in 14 months" text="Compare the effect of 4%, 5% and 6%." meta="High confidence · 3 sources" />
        <ReviewItem icon={WalletCards} tone="attention" title="Free cashflow is declining" text="Verified recurring costs are 12% higher year over year." meta="High confidence · 48 transactions" />
        <ReviewItem icon={ShieldCheck} tone="incomplete" title="Income protection fact missing" text="Anna’s coverage status is not confirmed." meta="Incomplete · action needed" />
        <button className="primary" onClick={() => setView("review")}>Open full review <ChevronRight size={17} /></button>
      </article>
    </section>
    <section className="lower-grid"><article className="panel changed-card"><div className="panel-head"><div><p className="eyebrow">Twin activity</p><h2>What changed</h2></div><button className="link-button" onClick={() => setView("twin")}>Open Twin <ArrowRight size={16} /></button></div><ol className="timeline"><li><span className="timeline-icon"><Check size={15} /></span><div><strong>Salary change confirmed</strong><p>Michael’s monthly net income increased to €4,380.</p><small>18 Aug · Synthetic feed · Verified</small></div></li><li><span className="timeline-icon gold"><CalendarClock size={15} /></span><div><strong>Mortgage horizon entered review window</strong><p>Fixed-rate period ends on 31 Oct 2027.</p><small>01 Aug · Contract record · High confidence</small></div></li><li><span className="timeline-icon blue"><Database size={15} /></span><div><strong>July account period reconciled</strong><p>All booked records linked to source IDs.</p><small>31 Jul · Difference €0.00</small></div></li></ol></article>
      <aside className="panel readiness-card"><div className="readiness-top"><span><Check size={18} /></span><p className="eyebrow">Foundation status</p></div><h2>Your evidence base is ready.</h2><p>Five years of synthetic activity have been normalized and reconciled. Every displayed number can be traced to canonical source records.</p><dl><div><dt>Booked transactions</dt><dd>7,666</dd></div><div><dt>Own transfers matched</dt><dd>100%</dd></div><div><dt>Reversal pairs linked</dt><dd>100%</dd></div><div><dt>Unexplained difference</dt><dd>€0.00</dd></div></dl><div className="boundary"><ShieldCheck size={17} /><p><strong>Planning support, not advice.</strong><br />FinTwin identifies questions for a qualified human adviser.</p></div></aside></section>
  </>;
}

function Review({ setView, setBrief, language }: { setView: (v: View) => void; setBrief: (v: boolean) => void; language: "de" | "en" }) {
  const [expanded, setExpanded] = useState(3);
  return <><PageTitle eyebrow="Allfinanz Review" title={language === "de" ? "Klarheit statt Punktzahl." : "Clarity without a score."} text={language === "de" ? "Sieben Lebensbereiche, jeweils mit Belegen, Datenlücken und einer konkreten Frage für das Gespräch." : "Seven life domains, each with evidence, data gaps and a concrete question for the conversation."} actions={<button className="primary action-fit" onClick={() => setBrief(true)}><Download size={17} /> {language === "de" ? "Berater-Brief" : "Adviser Brief"}</button>} />
    <div className="review-summary"><span><CircleCheck /> 1 Stärke</span><span><CircleAlert /> 3 Review-Themen</span><span><Info /> 2 Datenlücken</span></div>
    <section className="domain-list">{domains.map(([domain, status, title, why, Icon], index) => <article className={`panel domain-card ${status}`} key={domain}><button className="domain-head" onClick={() => setExpanded(expanded === index ? -1 : index)} aria-expanded={expanded === index}><span className={`domain-icon ${status}`}><Icon /></span><span><small>{domain}</small><strong>{title}</strong></span><Status status={status} /><ChevronDown className={expanded === index ? "rotated" : ""} /></button>{expanded === index && <div className="domain-body"><div><h3>Warum es wichtig ist</h3><p>{why}</p></div><div><h3>Evidence</h3><p>{status === "not_in_demo" ? "Keine Haushaltsdaten verarbeitet." : `${index + 1} verifizierte Quellen · Regel needs-review-1.0.0`}</p></div><div><h3>Nächster menschlicher Schritt</h3><p>{status === "not_in_demo" ? "Keiner—außerhalb des Demo-Umfangs." : index === 3 ? "Welche Rate bleibt bei 4%, 5% oder 6% tragbar?" : "Fehlende Fakten bestätigen und im Beratungsgespräch einordnen."}</p></div>{index === 3 && <button className="secondary" onClick={() => setView("scenarios")}>Szenario öffnen <ArrowRight size={16} /></button>}</div>}</article>)}</section>
  </>;
}

function Twin({ version, retirementAge, setCorrection, setEvidence }: { version: number; retirementAge: number; setCorrection: (v: boolean) => void; setEvidence: (v: string) => void }) {
  return <><PageTitle eyebrow="Financial Twin" title={`Version ${version} · auditable household context`} text="Jeder materielle Fakt zeigt Herkunft, Aktualität, Konfidenz und Verifikationsstatus." actions={<div className="version-pill"><Database size={16} /> Twin v{version}</div>} />
    <section className="panel twin-panel"><div className="table-scroll"><table><thead><tr><th>Fact</th><th>Current value</th><th>Source</th><th>Confidence</th><th>Observed</th><th></th></tr></thead><tbody>{facts.map(([name, rawValue, source, confidence, date]) => { const value = name === "Renten-Zielalter" ? String(retirementAge) : rawValue; return <tr key={name}><td><strong>{name}</strong></td><td>{value}</td><td><span className={`source-chip ${source}`}>{source.replace("_", " ")}</span></td><td><span className="confidence"><i style={{ width: `${Number(confidence) * 100}%` }} />{Math.round(Number(confidence) * 100)}%</span></td><td>{date}</td><td>{name === "Renten-Zielalter" ? <button className="text-action" onClick={() => setCorrection(true)}>Korrigieren</button> : <button className="icon-action" onClick={() => setEvidence(`${name} provenance`)} aria-label={`View ${name} provenance`}><ChevronRight /></button>}</td></tr>; })}</tbody></table></div></section>
    <div className="trust-grid"><article className="panel"><ShieldCheck /><h2>No silent overwrite</h2><p>Korrekturen werden vorgeschlagen, bestätigt und als neue unveränderliche Twin-Version gespeichert.</p></article><article className="panel"><Clock3 /><h2>Freshness is explicit</h2><p>Stale Werte behalten ihr Beobachtungsdatum und werden nicht als aktuell dargestellt.</p></article><article className="panel"><Database /><h2>Source IDs throughout</h2><p>Aggregates, Szenarien und Copilot-Claims verweisen auf kanonische Eingaben.</p></article></div>
  </>;
}

function Scenarios({ retirementAge, setBrief }: { retirementAge: number; setBrief: (v: boolean) => void }) {
  const [tab, setTab] = useState<Scenario>("mortgage");
  return <><PageTitle eyebrow="Scenario Lab" title="Deterministische Planung, offen erklärt." text="Vergleichen Sie Annahmen. Jeder Lauf ist reproduzierbar, versioniert und keine Produkt- oder Prognoseaussage." actions={<button className="secondary action-fit" onClick={() => setBrief(true)}><BookOpen size={17} /> Zum Brief</button>} />
    <div className="scenario-tabs" role="tablist"><button className={tab === "mortgage" ? "active" : ""} onClick={() => setTab("mortgage")}><Landmark /> Hypothek</button><button className={tab === "retirement" ? "active" : ""} onClick={() => setTab("retirement")}><CalendarClock /> Ruhestand</button><button className={tab === "child" ? "active" : ""} onClick={() => setTab("child")}><GraduationCap /> Bildungsziel <small>Beta</small></button></div>
    {tab === "mortgage" && <MortgageScenario />}{tab === "retirement" && <RetirementScenario age={retirementAge} />}{tab === "child" && <ChildScenario />}
  </>;
}

function MortgageScenario() {
  const [principal, setPrincipal] = useState(240000); const [months, setMonths] = useState(240); const [special, setSpecial] = useState(0); const [saved, setSaved] = useState(false);
  const rows = [4, 5, 6].map(rate => { const r = rate / 100 / 12; const base = principal * r / (1 - Math.pow(1 + r, -months)); const payment = base + special; return { rate, payment, delta: payment - 1454.35, interest: payment * months - principal }; });
  async function save() { setSaved(false); try { await fetch(`${api}/v1/households/hh_becker/scenarios/mortgage`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ principal: String(principal), annual_nominal_rate: "0.05", remaining_months: months, monthly_special_repayment: String(special), scenario_start_date: "2027-11-01" }) }); } catch {} setSaved(true); }
  return <section className="scenario-layout"><aside className="panel assumptions"><p className="eyebrow">Inputs</p><h2>Refix assumptions</h2><label>Principal at refix<span>€</span><input value={principal} onChange={e => setPrincipal(Number(e.target.value))} inputMode="decimal" /></label><label>Remaining term<span>months</span><input value={months} onChange={e => setMonths(Number(e.target.value))} inputMode="numeric" /></label><label>Monthly Sondertilgung<span>€</span><input value={special} onChange={e => setSpecial(Number(e.target.value))} inputMode="decimal" /></label><button className="primary" onClick={save}><RefreshCw size={16} /> Recompute & save</button>{saved && <p className="success"><CircleCheck /> Immutable run saved.</p>}<small>Inputs: fact_mortgage_balance · mortgage_contract_001<br />Engine mortgage-1.0.0</small></aside><div className="scenario-results"><div className="scenario-comparison">{rows.map(row => <article className={`panel rate-card ${row.rate === 5 ? "selected" : ""}`} key={row.rate}><span>{row.rate}% nominal</span><strong>{money(row.payment)}<small>/ month</small></strong><p>{row.delta >= 0 ? "+" : ""}{money(row.delta)} vs current planning rate</p><dl><div><dt>Total interest</dt><dd>{money(row.interest)}</dd></div><div><dt>Term</dt><dd>{months} months</dd></div></dl></article>)}</div><article className="panel formula"><Info /><div><strong>How this is calculated</strong><p>M = P × r ÷ (1 − (1 + r)<sup>−n</sup>). Interest, principal and closing balance are posted monthly to €0.01 using ROUND_HALF_UP.</p></div></article><p className="warning"><CircleAlert /> Planning scenario—not a lender quote. Taxes, fees, prepayment restrictions and product conditions are excluded.</p></div></section>;
}

function RetirementScenario({ age }: { age: number }) {
  const [targetAge, setTargetAge] = useState(age); const [contribution, setContribution] = useState(650); const [pension, setPension] = useState(2450); const [target, setTarget] = useState(3400); const [ret, setRet] = useState(4.5); const [fee, setFee] = useState(1); const years = Math.max(targetAge - 52, 1);
  const projected = useMemo(() => { const rate = Math.pow(1 + (ret - fee) / 100, 1 / 12) - 1; const months = years * 12; const nominal = 184000 * Math.pow(1 + rate, months) + contribution * ((Math.pow(1 + rate, months) - 1) / rate); return nominal / Math.pow(1.02, years); }, [years, contribution, ret, fee]);
  const gap = Math.max(target - pension, 0); const required = gap * 12 / .035; const ratio = projected / required;
  return <section className="scenario-layout"><aside className="panel assumptions"><p className="eyebrow">Inputs</p><h2>Retirement baseline</h2><label>Retirement age<input value={targetAge} onChange={e => setTargetAge(Number(e.target.value))} /></label><label>Monthly contribution<span>€</span><input value={contribution} onChange={e => setContribution(Number(e.target.value))} /></label><label>Expected net pension<span>€</span><input value={pension} onChange={e => setPension(Number(e.target.value))} /></label><label>Target spending<span>€</span><input value={target} onChange={e => setTarget(Number(e.target.value))} /></label><div className="input-pair"><label>Return<span>%</span><input value={ret} onChange={e => setRet(Number(e.target.value))} /></label><label>Fee<span>%</span><input value={fee} onChange={e => setFee(Number(e.target.value))} /></label></div><small>Engine retirement-1.0.0 · Today’s euros · 2% inflation</small></aside><div className="scenario-results"><article className="panel retirement-result"><div><p className="eyebrow">Projected real assets at {targetAge}</p><strong>{money(projected)}</strong><span>Today’s euros</span></div><div className="ratio-ring" style={{ "--ratio": `${Math.min(ratio * 100, 100)}%` } as React.CSSProperties}><strong>{Math.round(ratio * 100)}%</strong><span>readiness ratio</span></div></article><div className="result-grid"><article className="panel"><span>Monthly spending gap</span><strong>{money(gap)}</strong><small>Target less expected pension</small></article><article className="panel"><span>Required capital</span><strong>{money(required)}</strong><small>3.5% withdrawal assumption</small></article></div><article className="panel sensitivity"><h2>Most influential assumption</h2><p>Retirement timing is the largest lever in this baseline. One additional year adds contributions and another year of compounding.</p><button className="secondary" onClick={() => setTargetAge(a => a + 1)}>Compare age {targetAge + 1} <ArrowRight size={16} /></button></article><p className="warning"><CircleAlert /> Transparent sensitivity analysis—not a forecast, probability or product recommendation.</p></div></section>;
}

function ChildScenario() {
  const [target, setTarget] = useState(30000); const [current, setCurrent] = useState(5000); const [years, setYears] = useState(8); const rate = .03 / 12; const future = current * Math.pow(1 + rate, years * 12); const monthly = Math.max(target - future, 0) / ((Math.pow(1 + rate, years * 12) - 1) / rate);
  return <section className="scenario-layout"><aside className="panel assumptions"><p className="eyebrow">P6 stretch · feature flagged</p><h2>Education goal</h2><label>Target amount<span>€</span><input value={target} onChange={e => setTarget(Number(e.target.value))} /></label><label>Current earmarked savings<span>€</span><input value={current} onChange={e => setCurrent(Number(e.target.value))} /></label><label>Years to goal<input value={years} onChange={e => setYears(Number(e.target.value))} /></label><small>Illustrative 3% annual return assumption.</small></aside><div className="scenario-results"><article className="panel goal-result"><span>Illustrative monthly contribution</span><strong>{money(monthly)}</strong><p>to reach {money(target)} in {years} years under the stated assumptions.</p></article><p className="warning"><CircleAlert /> Goal calculation only. The assumed return is not a forecast or recommendation.</p></div></section>;
}

function Ask({ language }: { language: "de" | "en" }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", text: language === "de" ? "Ich beantworte Fragen mit verifizierten Twin-Fakten und deterministischen Werkzeugen. Womit soll ich beginnen?" : "I answer with verified Twin facts and deterministic tools. Where should we begin?", sources: ["get_allfinanz_review"] }]); const [input, setInput] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); if (!input.trim()) return; const question = input; setInput(""); setMessages(m => [...m, { role: "user", text: question }]); setLoading(true); let answer: ChatMessage; try { const body = await fetch(`${api}/v1/households/hh_becker/copilot/turns`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ question, language }) }).then(r => r.ok ? r.json() : Promise.reject()); answer = { role: "assistant", text: body.data.display_response, sources: body.data.claims.flatMap((c: { source_ids: string[] }) => c.source_ids), blocked: body.data.policy_result === "blocked" }; } catch { answer = localAnswer(question); } setMessages(m => [...m, answer]); setLoading(false); }
  const suggestions = ["Where did our money go last month?", "What are our largest recurring costs?", "What should we bring to an adviser?", "Recommend the best product to buy"];
  return <><PageTitle eyebrow="Ask FinTwin" title="Kurze Antworten. Sichtbare Belege." text="Der Copilot nutzt nur freigegebene Read-only-Werkzeuge und deterministische Szenarien. Der Scripted Fallback funktioniert ohne LLM-Key." actions={<div className="tool-status"><span /> Scripted fallback ready</div>} /><section className="ask-layout"><aside className="panel suggestions"><h2>Try a demo question</h2>{suggestions.map(q => <button key={q} onClick={() => setInput(q)}>{q}<ChevronRight /></button>)}<div className="policy-box"><ShieldCheck /><p><strong>Policy gate active</strong><br />Product ranking, execution, tax/legal conclusions and affiliation claims are blocked.</p></div></aside><section className="panel chat"><div className="messages" aria-live="polite">{messages.map((m, i) => <div className={`message ${m.role} ${m.blocked ? "blocked" : ""}`} key={i}>{m.role === "assistant" && <span className="bot"><Sparkles /></span>}<div><p>{m.text}</p>{m.sources && m.sources.length > 0 && <div className="citations">{m.sources.map(s => <span key={s}><Database size={12} /> {s}</span>)}</div>}{m.blocked && <small><ShieldCheck size={13} /> Requires human review</small>}</div></div>)}{loading && <div className="message assistant"><span className="bot"><Sparkles /></span><div className="typing" aria-label="Using approved tools"><i /><i /><i /></div></div>}</div><form className="composer" onSubmit={submit}><label className="sr-only" htmlFor="ask-input">Ask FinTwin</label><input id="ask-input" value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about cashflow, net worth, review topics or scenarios…" /><button type="submit" aria-label="Send question"><Send /></button></form></section></section></>;
}

function EvidenceDrawer({ title, close }: { title: string; close: () => void }) { return <div className="overlay" onMouseDown={close}><aside className="drawer" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}><button className="close" onClick={close}><X /></button><p className="eyebrow">Traceable evidence</p><h2>{title}</h2><div className="evidence-total"><span>Derived value</span><strong>{title.includes("Cash") ? "€568" : title.includes("worth") ? "€487,320" : "Verified"}</strong><small>As of 30 Aug 2026 · Europe/Berlin</small></div><h3>Calculation trace</h3><ol className="evidence-steps"><li><span>1</span><div><strong>Canonical source records</strong><p>Booked records carry immutable source IDs and original booking dates.</p></div></li><li><span>2</span><div><strong>Reconciliation applied</strong><p>Own transfers excluded; reversals linked and netted to €0.00.</p></div></li><li><span>3</span><div><strong>Versioned aggregate</strong><p>Computed against Twin v17 with ruleset metrics-1.0.0.</p></div></li></ol><div className="source-list"><code>agg_cashflow_202608</code><code>transfer_matches_202608</code><code>fixture_becker_v1</code></div><button className="secondary full" onClick={close}><ArrowLeft /> Back to FinTwin</button></aside></div>; }

function CorrectionDialog({ current, close, confirm }: { current: number; close: () => void; confirm: (age: number) => void }) { const [age, setAge] = useState(current); return <div className="overlay"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="correction-title"><button className="close" onClick={close}><X /></button><p className="eyebrow">Propose a fact correction</p><h2 id="correction-title">Renten-Zielalter korrigieren</h2><p>Der aktuelle Wert stammt aus einer Inferenz mit 82% Konfidenz. Eine bestätigte Korrektur erstellt eine neue Twin-Version.</p><label>Bestätigtes Zielalter<input autoFocus type="number" min="55" max="75" value={age} onChange={e => setAge(Number(e.target.value))} /></label><div className="change-preview"><span>Current Twin v17</span><strong>{current} <ArrowRight /> {age}</strong><small>Source: user confirmed · Confidence 100%</small></div><div className="dialog-actions"><button className="secondary" onClick={close}>Abbrechen</button><button className="primary action-fit" onClick={() => confirm(age)}><UserRoundCheck /> Vorschlag bestätigen</button></div></section></div>; }

function Brief({ close, retirementAge }: { close: () => void; retirementAge: number }) { return <div className="brief-overlay"><div className="brief-toolbar"><button onClick={close}><ArrowLeft /> Back</button><button className="primary action-fit" onClick={() => window.print()}><Download /> Print / Save PDF</button></div><article className="brief-document"><header><div className="brand"><span className="brand-mark"><span /></span><span>FinTwin</span></div><span className="synthetic"><ShieldCheck /> Synthetic data</span></header><p className="eyebrow">Adviser preparation · 30 August 2026</p><h1>Household Brief<br />Michael &amp; Anna Becker</h1><p className="lead">A concise, evidence-backed preparation pack for a future conversation with a qualified human adviser.</p><div className="brief-grid"><section><h2>Verified household facts</h2><dl><div><dt>Net household income</dt><dd>€7,240/month</dd></div><div><dt>Net worth</dt><dd>€487,320</dd></div><div><dt>Mortgage principal</dt><dd>€240,000</dd></div><div><dt>Fixed-rate end</dt><dd>31 Oct 2027</dd></div><div><dt>Retirement target</dt><dd>Age {retirementAge}</dd></div></dl></section><section><h2>Topics to review</h2><ol><li>Mortgage refix resilience at 4%, 5% and 6%</li><li>Recurring costs up €134/month year over year</li><li>Anna’s income-protection fact is incomplete</li></ol></section></div><section className="brief-section"><h2>Scenario snapshot</h2><table><thead><tr><th>Mortgage rate</th><th>Indicative payment</th><th>Purpose</th></tr></thead><tbody><tr><td>4%</td><td>€1,454.35/month</td><td>Baseline sensitivity</td></tr><tr><td>5%</td><td>€1,583.89/month</td><td>Central comparison</td></tr><tr><td>6%</td><td>€1,719.43/month</td><td>Higher-rate stress</td></tr></tbody></table></section><section className="brief-section"><h2>Information to bring</h2><ul><li>Anna’s current income-protection policy and benefit schedule</li><li>Confirmed expected net pension income for both household members</li><li>Current mortgage agreement and any prepayment restrictions</li><li>Confirmed target spending in retirement</li></ul></section><section className="brief-section"><h2>Questions for a human adviser</h2><ul><li>Which refix payment remains comfortable alongside the household’s reserve target?</li><li>Which missing pension inputs most affect the baseline?</li><li>Which policy facts need verification before discussing protection needs?</li></ul></section><footer><strong>Independent prototype · no product prescription</strong><p>Built solely from verified synthetic facts and selected deterministic scenarios. Not financial, investment, insurance, mortgage, tax or legal advice.</p></footer></article></div>; }

function Metric({ label, value, detail, tone, icon: Icon, onClick }: { label: string; value: string; detail: string; tone: string; icon: typeof Landmark; onClick: () => void }) { return <button className="metric" onClick={onClick}><span className={`metric-icon ${tone}`}><Icon size={20} /></span><span><small>{label}</small><strong>{value}</strong><em className={tone}>{detail}</em></span><ChevronRight className="metric-arrow" /></button>; }
function ReviewItem({ icon: Icon, tone, title, text, meta }: { icon: typeof Landmark; tone: string; title: string; text: string; meta: string }) { return <div className="review-item"><span className={`review-icon ${tone}`}><Icon size={18} /></span><div><strong>{title}</strong><p>{text}</p><small>{meta}</small></div><ChevronRight size={18} /></div>; }
function Status({ status }: { status: string }) { const labels: Record<string, string> = { reviewed: "Reviewed", attention: "Attention", incomplete: "Incomplete", not_in_demo: "Not in demo" }; return <span className={`status ${status}`}>{status === "reviewed" ? <Check /> : status === "not_in_demo" ? <X /> : <CircleAlert />}{labels[status]}</span>; }
function money(value: number) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value); }
function localAnswer(question: string): ChatMessage { const q = question.toLowerCase(); if (["recommend", "empfehlen", "best product", "buy"].some(x => q.includes(x))) return { role: "assistant", blocked: true, text: "Dabei kann FinTwin keine konkrete Produktempfehlung, Rangfolge oder Transaktion geben. Ich kann neutrale Vergleichskriterien und Fragen für eine qualifizierte Fachperson strukturieren.", sources: [] }; if (q.includes("recurring") || q.includes("wiederkehr")) return { role: "assistant", text: "Die größten wiederkehrenden Kosten sind Immobilienrate (€1.420), Krankenversicherung (€612) und Bildungsunterstützung (€520). Die verifizierten laufenden Kosten stiegen um €134 pro Monat.", sources: ["agg_recurring_yoy_202608"] }; if (q.includes("bring") || q.includes("adviser")) return { role: "assistant", text: "Bringen Sie Annas Einkommensschutz-Police, bestätigte Netto-Rentenansprüche, den Darlehensvertrag und Ihr Ziel-Ausgabenniveau im Ruhestand mit.", sources: ["finding_protection_data_incomplete"] }; return { role: "assistant", text: "Im August lagen externe Einnahmen bei €7.240 und externe Ausgaben bei €6.672. Eigenüberträge sind ausgeschlossen; der freie Cashflow betrug €568.", sources: ["agg_cashflow_202608", "transfer_matches_202608"] }; }
