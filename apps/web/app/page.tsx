"use client";

import {
  ArrowRight, BarChart3, Bot, Check, ChevronRight, CircleAlert, CircleCheck,
  Database, FileText, Home, Landmark, Menu, Mic, MicOff, Play, RotateCcw,
  Send, ShieldCheck, Sparkles, TrendingUp, Volume2, WalletCards, X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

type View = "start" | "analyse" | "twin" | "planung" | "assistent";
type Message = { role: "user" | "assistant"; text: string; sources?: string[]; mode?: string };
const api = process.env.NEXT_PUBLIC_API_URL ?? "";
const nav: Array<[View, string, typeof Home]> = [
  ["start", "Start", Home], ["analyse", "Finanzcheck", BarChart3],
  ["twin", "Finanz-Twin", Database], ["planung", "Planung", Landmark],
  ["assistent", "KI-Assistent", Sparkles],
];

const topics = [
  { icon: Landmark, title: "Anschlussfinanzierung", text: "Zinsbindung endet in 14 Monaten", meta: "Hohe Priorität · 3 Belege", tone: "amber" },
  { icon: WalletCards, title: "Laufende Kosten", text: "134 € pro Monat mehr als im Vorjahr", meta: "Prüfen · 48 Buchungen", tone: "coral" },
  { icon: ShieldCheck, title: "Einkommensschutz", text: "Angaben zu Annas Absicherung fehlen", meta: "Datenlücke · Bestätigung nötig", tone: "blue" },
];

export default function FinTwin() {
  const [view, setView] = useState<View>("start");
  const [menu, setMenu] = useState(false);
  const [version, setVersion] = useState(17);
  const [notice, setNotice] = useState("");
  return <main>
    <header className="nav-shell">
      <button className="brand" onClick={() => setView("start")} aria-label="Zur Startseite"><span className="brand-symbol"><i /><i /><i /></span><span>FinTwin<small>Ihr Finanzbild</small></span></button>
      <nav className={menu ? "nav-open" : ""} aria-label="Hauptnavigation">
        {nav.map(([id, label, Icon]) => <button key={id} className={view === id ? "active" : ""} onClick={() => { setView(id); setMenu(false); }}><Icon size={17} />{label}</button>)}
      </nav>
      <div className="nav-end"><span className="demo-chip"><span />Demo-Daten</span><button className="profile" onClick={() => { setView("start"); setVersion(17); setNotice("Demo wurde zurückgesetzt."); }}>MB</button><button className="menu-button" onClick={() => setMenu(!menu)} aria-label="Menü öffnen"><Menu /></button></div>
    </header>
    <div className="trust-strip"><ShieldCheck size={15} /><span>Unabhängiger Prototyp mit fiktiven Daten</span><i />Keine Produktberatung · Jede Zahl ist nachvollziehbar</div>
    {notice && <div className="toast"><CircleCheck size={18} />{notice}<button onClick={() => setNotice("")} aria-label="Hinweis schließen"><X size={16} /></button></div>}
    <div className="page-wrap">
      {view === "start" && <Start setView={setView} />}
      {view === "analyse" && <Analyse setView={setView} />}
      {view === "twin" && <Twin version={version} onCorrect={() => { setVersion(version + 1); setNotice("Zielalter bestätigt. Finanz-Twin v18 wurde erstellt."); }} />}
      {view === "planung" && <Planung />}
      {view === "assistent" && <Assistent />}
    </div>
    <footer><span>FinTwin · Synthetischer Privathaushalt</span><span>Keine Finanz-, Anlage-, Versicherungs-, Steuer- oder Rechtsberatung.</span></footer>
  </main>;
}

function Start({ setView }: { setView: (view: View) => void }) {
  return <>
    <section className="hero">
      <div className="hero-copy"><p className="kicker"><span />Finanzlage · 30. August 2026</p><h1>Guten Morgen,<br /><em>Michael &amp; Anna.</em></h1><p>Ihre Finanzen sind solide erfasst. Drei Punkte sollten Sie jetzt genauer ansehen.</p><div className="hero-actions"><button className="button light" onClick={() => setView("analyse")}>Finanzcheck öffnen <ArrowRight size={17} /></button><button className="button ghost" onClick={() => setView("assistent")}><Mic size={17} /> FinTwin fragen</button></div></div>
      <div className="hero-score"><div className="score-ring"><span><strong>96</strong><small>%</small></span></div><div><strong>Daten vollständig</strong><p>7.666 Buchungen abgeglichen</p><span className="verified"><Check size={13} /> Stand aktuell</span></div></div>
    </section>
    <section className="numbers" aria-label="Finanzielle Kennzahlen">
      <article><p>Nettovermögen</p><strong>487.320 €</strong><span className="up"><TrendingUp size={14} /> 18.460 € in 12 Monaten</span></article>
      <article><p>Freier Cashflow</p><strong>568 € <small>/ Monat</small></strong><span className="down">185 € unter Vorjahr</span></article>
      <article><p>Notfallreserve</p><strong>7,8 <small>Monate</small></strong><span className="up"><Check size={14} /> Ziel: 6 Monate</span></article>
      <article><p>Datenqualität</p><strong>100 %</strong><span><Database size={14} /> Vollständig abgeglichen</span></article>
    </section>
    <section className="section-head"><div><p className="kicker dark">Was jetzt wichtig ist</p><h2>Drei Themen für Ihren nächsten Schritt</h2></div><button className="text-button" onClick={() => setView("analyse")}>Alle Bereiche ansehen <ArrowRight size={16} /></button></section>
    <section className="topic-grid">{topics.map(({ icon: Icon, title, text, meta, tone }) => <button key={title} className="topic-card" onClick={() => setView("analyse")}><span className={`topic-icon ${tone}`}><Icon /></span><span><small>{title}</small><strong>{text}</strong><em>{meta}</em></span><ChevronRight /></button>)}</section>
    <section className="flow-grid">
      <article className="panel cash-panel"><div className="panel-title"><div><p className="kicker dark">Cashflow</p><h2>So verteilt sich Ihr Monat</h2></div><span>August 2026</span></div><div className="flow"><div><span>Einnahmen</span><strong>7.240 €</strong></div><ArrowRight /><div><span>Ausgaben</span><strong>6.672 €</strong></div><ArrowRight /><div className="flow-result"><span>Übrig</span><strong>568 €</strong></div></div><div className="mini-chart">{[48,54,51,60,58,66,64,72,62,55,49,43].map((v,i)=><i key={i} style={{height:`${v}%`}} className={i>8?"warn":""} />)}</div><p className="insight"><CircleAlert size={16} /> Regelmäßige Ausgaben sind zuletzt spürbar gestiegen.</p></article>
      <article className="panel ask-preview"><span className="ai-orb"><Sparkles /></span><p className="kicker dark">FinTwin KI</p><h2>Fragen Sie einfach.</h2><p>Per Text oder Sprache. Antworten werden aus geprüften Haushaltsdaten erzeugt und mit Quellen belegt.</p><button className="voice-preview" onClick={() => setView("assistent")}><span><Mic /></span><strong>Sprachgespräch starten</strong><small>Zum Sprechen antippen</small><Play size={18} /></button><p className="safe"><ShieldCheck size={14} /> Keine Produktvorschläge oder Abschlüsse</p></article>
    </section>
  </>;
}

function Analyse({ setView }: { setView: (view: View) => void }) {
  const rows = [
    ["Absicherung", "Daten ergänzen", "Annas Einkommensschutz ist nicht bestätigt", "offen"],
    ["Altersvorsorge", "Prüfen", "Netto-Rentenansprüche fehlen", "prüfen"],
    ["Vermögensaufbau", "Gut aufgestellt", "Depotbeiträge sind vollständig abgeglichen", "gut"],
    ["Wohneigentum", "Handlungsbedarf", "Zinsbindung endet am 31.10.2027", "offen"],
    ["Sparen & Liquidität", "Beobachten", "Laufende Kosten steigen", "prüfen"],
    ["Familie & Bildung", "Ziel klären", "Zielbetrag und Zeitpunkt fehlen", "offen"],
  ];
  return <><PageHead overline="Ihr Finanzcheck" title="Klarheit statt Gesamtnote." text="Jeder Lebensbereich zeigt, was belegt ist, was fehlt und welche Frage als Nächstes sinnvoll ist." /><div className="review-summary"><span><CircleCheck /> 1 Stärke</span><span><CircleAlert /> 3 Prüfthemen</span><span><Database /> 2 Datenlücken</span></div><section className="review-list">{rows.map(([area,status,text,tone])=><article key={area}><span className={`status-dot ${tone}`} /><div><small>{area}</small><strong>{status}</strong><p>{text}</p></div><button aria-label={`${area} öffnen`}><ChevronRight /></button></article>)}</section><div className="next-banner"><div><FileText /><span><strong>Bereit für das Beratungsgespräch?</strong><p>Erstellen Sie eine kompakte Liste mit Fakten, Lücken und Fragen.</p></span></div><button className="button dark" onClick={() => setView("assistent")}>Fragen vorbereiten <ArrowRight /></button></div></>;
}

function Twin({ version, onCorrect }: { version: number; onCorrect: () => void }) {
  const [done, setDone] = useState(false);
  const facts = [["Nettoeinkommen","7.240 € / Monat","Bankdaten","100 %"],["Finanzvermögen","312.860 €","Berechnet","98 %"],["Immobilie","420.000 €","Bewertung","90 %"],["Hypothek","240.000 €","Vertrag","99 %"],["Renten-Zielalter",done?"64 Jahre":"63 Jahre","Abgeleitet",done?"100 %":"82 %"]];
  return <><PageHead overline="Ihr Finanz-Twin" title={`Version ${version}. Vollständig nachvollziehbar.`} text="Herkunft, Aktualität und Sicherheit bleiben an jedem wichtigen Fakt sichtbar." /><section className="panel twin-card"><div className="twin-top"><span><Database /> Finanz-Twin v{version}</span><small>Zuletzt abgeglichen: 30.08.2026</small></div><div className="fact-table"><div className="fact-head"><span>Fakt</span><span>Aktueller Wert</span><span>Quelle</span><span>Sicherheit</span><span /></div>{facts.map(([name,value,source,confidence])=><div className="fact-row" key={name}><strong>{name}</strong><span>{value}</span><span className="source">{source}</span><span>{confidence}</span>{name==="Renten-Zielalter"&&!done?<button onClick={()=>{setDone(true);onCorrect();}}>Korrigieren</button>:<CircleCheck size={18}/>}</div>)}</div></section><section className="principle-grid"><article><ShieldCheck /><h3>Keine stille Änderung</h3><p>Jede Korrektur erzeugt eine neue, unveränderliche Version.</p></article><article><Database /><h3>Quellen bleiben sichtbar</h3><p>Berechnungen und KI-Antworten verweisen auf dieselben Belege.</p></article><article><RotateCcw /><h3>Jeder Stand reproduzierbar</h3><p>Annahmen, Regeln und Zeitpunkte werden mitgespeichert.</p></article></section></>;
}

function Planung() {
  const [tab,setTab]=useState<"zins"|"rente">("zins");
  return <><PageHead overline="Szenario-Planung" title="Was wäre, wenn? Offen gerechnet." text="Vergleichen Sie Annahmen, ohne dass daraus eine Prognose oder Produktempfehlung wird." /><div className="plan-tabs"><button className={tab==="zins"?"active":""} onClick={()=>setTab("zins")}><Landmark /> Anschlussfinanzierung</button><button className={tab==="rente"?"active":""} onClick={()=>setTab("rente")}><TrendingUp /> Ruhestand</button></div>{tab==="zins"?<section className="scenario"><div className="scenario-copy"><p className="kicker dark">Restschuld 240.000 € · 20 Jahre</p><h2>Wie verändert der Zins Ihre Rate?</h2><p>Gleiche Laufzeit, gleiche Restschuld – nur der Nominalzins variiert.</p><div className="assumption"><ShieldCheck /> Modellrechnung, kein Kreditangebot</div></div><div className="rate-cards">{[["4 %","1.454,35 €","Ausgangswert"],["5 %","1.583,89 €","+129,54 €"],["6 %","1.719,43 €","+265,08 €"]].map(([rate,payment,delta],i)=><article className={i===1?"focus":""} key={rate}><span>{rate} Zins</span><strong>{payment}</strong><small>pro Monat</small><em>{delta}</em></article>)}</div></section>:<section className="scenario retirement"><div><p className="kicker dark">Basis: Ruhestand mit 63</p><h2>92 % des Zielkapitals</h2><p>299.810 € voraussichtliches Realvermögen stehen 325.714 € Modellbedarf gegenüber.</p></div><div className="retire-ring"><span><strong>92</strong>%</span></div></section>}</>;
}

function Assistent() {
  const [messages,setMessages]=useState<Message[]>([{role:"assistant",text:"Hallo Michael, hallo Anna. Fragen Sie mich zu Cashflow, Vermögen, Absicherung, Zinsen oder Ruhestand – gern auch per Sprache.",sources:["get_allfinanz_review"],mode:"start"}]);
  const [input,setInput]=useState(""); const [loading,setLoading]=useState(false); const [listening,setListening]=useState(false); const [aiLive,setAiLive]=useState(false); const recorder=useRef<MediaRecorder|null>(null); const chunks=useRef<Blob[]>([]); const stream=useRef<MediaStream|null>(null);
  useEffect(()=>{ fetch(`${api}/health`).then(r=>r.json()).then(v=>setAiLive(Boolean(v.ai_available))).catch(()=>setAiLive(false)); },[]);
  async function ask(question:string){ if(!question.trim()||loading)return; setMessages(m=>[...m,{role:"user",text:question}]);setInput("");setLoading(true);let reply:Message;try{const body=await fetch(`${api}/v1/households/hh_becker/copilot/turns`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({question,language:"de"})}).then(r=>r.ok?r.json():Promise.reject());reply={role:"assistant",text:body.data.display_response,sources:body.data.claims.flatMap((c:{source_ids:string[]})=>c.source_ids),mode:body.data.mode};setAiLive(body.data.mode==="openai_live");}catch{reply=localAnswer(question);}setMessages(m=>[...m,reply]);setLoading(false);speak(reply.text);}
  function submit(e:FormEvent){e.preventDefault();void ask(input);}
  function speak(text:string){if(typeof window!=="undefined"&&"speechSynthesis" in window){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang="de-DE";utterance.rate=.96;speechSynthesis.speak(utterance);}}
  async function toggleVoice(){
    if(listening){recorder.current?.stop();return;}
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){setMessages(m=>[...m,{role:"assistant",text:"Dieser Browser kann keine Audioaufnahme starten. Bitte öffnen Sie die Seite in einem aktuellen Browser oder geben Sie Ihre Frage ein."}]);return;}
    try{
      stream.current=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
      chunks.current=[];
      const active=new MediaRecorder(stream.current,{mimeType:MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":"audio/webm"});
      recorder.current=active;
      active.ondataavailable=event=>{if(event.data.size)chunks.current.push(event.data);};
      active.onstop=async()=>{setListening(false);stream.current?.getTracks().forEach(track=>track.stop());const audio=new Blob(chunks.current,{type:active.mimeType});if(audio.size<500){setMessages(m=>[...m,{role:"assistant",text:"Ich habe keine verständliche Aufnahme erhalten. Bitte halten Sie das Mikrofon etwas länger gedrückt."}]);return;}setLoading(true);try{const form=new FormData();form.set("audio",audio,"frage.webm");const body=await fetch(`${api}/v1/households/hh_becker/voice/transcribe`,{method:"POST",body:form}).then(r=>r.ok?r.json():Promise.reject());const transcript=body.data.transcript;if(!transcript)throw new Error();setInput(transcript);setLoading(false);await ask(transcript);}catch{setLoading(false);setMessages(m=>[...m,{role:"assistant",text:"Die Aufnahme konnte nicht transkribiert werden. Prüfen Sie die Mikrofonfreigabe und versuchen Sie es erneut."}]);}};
      setListening(true);active.start();
    }catch{setListening(false);setMessages(m=>[...m,{role:"assistant",text:"Der Mikrofonzugriff wurde nicht erlaubt. Bitte geben Sie FinTwin in den Browser-Einstellungen Zugriff und versuchen Sie es erneut."}]);}
  }
  const suggestions=["Wofür geben wir am meisten aus?","Was bedeutet ein Zins von 6 %?","Was fehlt für das Beratungsgespräch?"];
  return <section className="assistant-page"><div className="assistant-intro"><p className="kicker dark"><Sparkles /> FinTwin KI-Assistent</p><h1>Fragen Sie Ihre Finanzen.<br /><em>Auf Deutsch. Mit Quellen.</em></h1><p>Text oder Sprache – Antworten basieren auf geprüften Daten Ihres Finanz-Twins.</p><div className={`ai-status ${aiLive?"live":"demo"}`}><span />{aiLive?"Live-KI über Groq verbunden":"Demo-Modus · API-Schlüssel nicht eingerichtet"}</div></div><div className="chat-card"><div className="chat-top"><span><Bot /> FinTwin</span><small><ShieldCheck /> Geschützter Planungsraum</small></div><div className="messages" aria-live="polite">{messages.map((m,i)=><div className={`message ${m.role}`} key={i}><span>{m.role==="assistant"?<Sparkles/>:"MB"}</span><div><p>{m.text}</p>{m.sources&&m.sources.length>0&&<details><summary><Database size={13}/> {m.sources.length} Quellen anzeigen</summary>{m.sources.slice(0,5).map(s=><code key={s}>{s}</code>)}</details>}</div></div>)}{loading&&<div className="typing"><i/><i/><i/></div>}</div><div className="suggestions">{suggestions.map(s=><button key={s} onClick={()=>{setInput(s);}}>{s}</button>)}</div><form className="composer" onSubmit={submit}><button type="button" className={`mic ${listening?"listening":""}`} onClick={toggleVoice} aria-label={listening?"Aufnahme beenden":"Sprachfrage starten"}>{listening?<MicOff/>:<Mic/>}</button><label><span className="sr-only">Ihre Frage</span><input value={input} onChange={e=>setInput(e.target.value)} placeholder={listening?"Aufnahme läuft – zum Beenden tippen …":"Frage eingeben …"}/></label><button type="submit" disabled={!input.trim()||loading} aria-label="Frage senden"><Send /></button></form><p className="voice-note"><Volume2 size={13} /> Mikrofon antippen, sprechen, erneut antippen. Die Antwort wird vorgelesen.</p></div></section>;
}

function PageHead({overline,title,text}:{overline:string;title:string;text:string}){return <section className="page-head"><p className="kicker dark">{overline}</p><h1>{title}</h1><p>{text}</p></section>}
function localAnswer(q:string):Message{const s=q.toLowerCase();if(["empfehlen","kaufen","bestes produkt"].some(x=>s.includes(x)))return{role:"assistant",text:"Dabei kann FinTwin keine konkrete Produktempfehlung oder Transaktion geben. Ich kann neutrale Vergleichskriterien für das Gespräch strukturieren.",mode:"policy_guard"};if(s.includes("zins")||s.includes("6 %"))return{role:"assistant",text:"Bei 240.000 € Restschuld und 20 Jahren beträgt die Modellrate bei 6 % rund 1.719,43 € pro Monat. Das sind 265,08 € mehr als bei 4 %. Es handelt sich um eine Sensitivitätsrechnung, nicht um ein Kreditangebot.",sources:["scenario_mortgage_6","fact_mortgage_balance"],mode:"scripted_fallback"};if(s.includes("fehlt")||s.includes("beratung"))return{role:"assistant",text:"Für das Gespräch fehlen vor allem Annas aktuelle Einkommensschutz-Police, bestätigte Netto-Rentenansprüche, der Darlehensvertrag und das gewünschte Ausgabenniveau im Ruhestand.",sources:["finding_protection_data_incomplete","fact_goal_retirement"],mode:"scripted_fallback"};return{role:"assistant",text:"Im August lagen die externen Einnahmen bei 7.240 € und die Ausgaben bei 6.672 €. Eigenüberträge sind herausgerechnet; der freie Cashflow betrug 568 €.",sources:["agg_cashflow_202608","transfer_matches_202608"],mode:"scripted_fallback"}}
