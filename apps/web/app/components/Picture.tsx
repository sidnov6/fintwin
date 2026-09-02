"use client";
import { useState } from "react";
import { ChevronRight, Database, Pencil, Plus, Trash2, CircleAlert } from "lucide-react";
import type { AppState, FactKey, Lang, Message, NextStep } from "@fintwin/contracts";
import { FACT_DEFS, type FactGroup } from "@fintwin/engine";
import { api } from "../lib/api";
import { factDisplay, metricValue, money, pct, sourceLabel, yearMonth } from "../lib/format";
import { copy } from "../lib/i18n";
import { FactEditor } from "./FactEditor";

interface PictureProps { state: AppState; lang: Lang; applyState(state: AppState): void; send(text: string): void; toast(text: string): void; addMessage(message: Message): void }

function useFactActions(applyState: (state: AppState) => void, addMessage: (message: Message) => void) {
  return {
    async save(key: FactKey, value: number | string) { const result = await api.patchFacts([{ key, value }]); if (!result.accepted.includes(key)) throw new Error("rejected"); applyState(result.state); if (result.message) addMessage(result.message); },
    async remove(key: FactKey) { applyState(await api.deleteFacts([key])); },
  };
}

export function PictureRail({ state, lang, applyState, send, toast, addMessage }: PictureProps) {
  const t = copy(lang);
  const [editing, setEditing] = useState<FactKey | null>(null);
  const [newStep, setNewStep] = useState("");
  const actions = useFactActions(applyState, addMessage);
  const picture = state.picture;
  const main = picture.metrics.filter(metric => ["net_worth", "free_cashflow", "runway", "savings_rate"].includes(metric.key));
  const known = Object.values(state.facts).filter(Boolean).length;

  async function toggleStep(step: NextStep) { applyState(await api.setStepDone(step, !step.done)); }
  async function addStep(event: React.FormEvent) { event.preventDefault(); if (!newStep.trim()) return; applyState(await api.addNextStep(newStep.trim())); setNewStep(""); }

  return <aside className="rail" aria-label={t.picture}>
    <section className="panel">
      <h3>{t.picture}<span className="spacer" /><small>{t.completeness(picture.completeness.known, picture.completeness.total)}</small></h3>
      <div className="completeness"><div className="bar"><i style={{ width: `${picture.completeness.known / picture.completeness.total * 100}%` }} /></div></div>
      <div className="metric-grid">{main.map(metric => <div className={`metric ${metric.tone}`} key={metric.key}><small><i className={`tone ${metric.tone}`} />{metric.label[lang]}</small><strong className="num">{metricValue(metric.value, metric.unit, lang)}</strong>{metric.value === null ? <em>{lang === "de" ? "Angabe fehlt" : "Fact missing"}</em> : metric.note ? <em>{metric.note[lang]}</em> : null}</div>)}</div>
      {known === 0 && <button className="btn sm ghost" onClick={async () => { applyState(await api.loadSample()); toast(t.sampleLoaded); }}><Database />{t.sample}</button>}
      {state.profile?.sampleLoaded && <span className="chip amber"><Database />{t.sampleNote}</span>}
    </section>

    {picture.insights.length > 0 && <section className="panel">
      <h3>{t.standsOut}</h3>
      <div>{picture.insights.slice(0, 4).map(insight => <button className="insight" key={insight.id} onClick={() => send(insight.ask[lang])}><i className={`tone ${insight.severity === "attention" ? "attention" : insight.severity === "good" ? "positive" : "neutral"}`} /><span><strong>{insight.title[lang]}</strong><span>{insight.body[lang]}</span></span><ChevronRight /></button>)}</div>
    </section>}

    {picture.openQuestions.length > 0 && <section className="panel">
      <h3>{t.stillOpen}</h3>
      <div>{picture.openQuestions.slice(0, 4).map(question => <div key={question.key}>
        {editing === question.key ? <FactEditor factKey={question.key} lang={lang} onSave={async value => { await actions.save(question.key, value); setEditing(null); }} onCancel={() => setEditing(null)} />
          : <div className="open-q"><span>{question.label[lang]}<small>{question.why[lang]}</small></span><button onClick={() => setEditing(question.key)}>{t.answer}</button></div>}
      </div>)}</div>
    </section>}

    <section className="panel">
      <h3>{t.nextSteps}</h3>
      {state.nextSteps.length ? <div className="steps">{state.nextSteps.map(step => <label className={`step ${step.done ? "done" : ""}`} key={step.id}><input type="checkbox" checked={step.done} onChange={() => void toggleStep(step)} /><span>{step.text}</span><button aria-label={t.remove} onClick={async event => { event.preventDefault(); applyState(await api.deleteStep(step)); }}><Trash2 /></button></label>)}</div> : <p className="empty">{t.noSteps}</p>}
      <form className="step-add" onSubmit={addStep}><input value={newStep} onChange={event => setNewStep(event.target.value)} placeholder={t.addStep} aria-label={t.addStep} /><button className="icon-btn" type="submit" aria-label={t.addStep}><Plus /></button></form>
    </section>
  </aside>;
}

const GROUPS: FactGroup[] = ["cashflow", "assets", "debts", "retirement", "goals", "protection", "person"];

export function PictureView({ state, lang, applyState, send, toast, addMessage }: PictureProps) {
  const t = copy(lang);
  const [editing, setEditing] = useState<FactKey | null>(null);
  const actions = useFactActions(applyState, addMessage);
  const picture = state.picture, facts = state.facts, portfolio = state.portfolio;

  return <div className="page">
    <div className="page-head"><div><h1>{t.picture}</h1><p className="lead">{lang === "de" ? "Alles, was FinTwin von Ihnen weiß – mit Herkunft. Jede Angabe lässt sich hier direkt ändern; das Gespräch sieht die Änderung sofort." : "Everything FinTwin knows about you, with its origin. Change any fact here; the conversation sees it immediately."}</p></div>
      <div style={{ display: "flex", gap: 8 }}>{!state.profile?.sampleLoaded && <button className="btn ghost" onClick={async () => { applyState(await api.loadSample()); toast(t.sampleLoaded); }}><Database />{t.sample}</button>}<button className="btn primary" onClick={() => send(lang === "de" ? "Was ist gerade wichtig?" : "What matters right now?")}>{lang === "de" ? "Mit FinTwin besprechen" : "Discuss with FinTwin"}</button></div></div>
    {state.profile?.sampleLoaded && <div className="banner"><CircleAlert />{t.sampleNote}. {lang === "de" ? "Ersetzen Sie einzelne Werte einfach durch Ihre eigenen." : "Replace individual values with your own whenever you like."}</div>}

    <div className="grid-4">{picture.metrics.filter(metric => ["net_worth", "free_cashflow", "runway", "savings_rate"].includes(metric.key)).map(metric => <div className={`metric ${metric.tone}`} key={metric.key}><small><i className={`tone ${metric.tone}`} />{metric.label[lang]}</small><strong className="num">{metricValue(metric.value, metric.unit, lang)}</strong>{metric.note && <em>{metric.note[lang]}</em>}{metric.value === null && metric.missing.length > 0 && <em>{lang === "de" ? "Fehlt: " : "Missing: "}{metric.missing.map(key => FACT_DEFS.find(def => def.key === key)?.label[lang].toLowerCase()).join(", ")}</em>}</div>)}</div>

    <div className="grid-2">
      {GROUPS.map(group => {
        const defs = FACT_DEFS.filter(def => def.group === group);
        const hasProperty = (facts.property_value?.value ?? 0) !== 0;
        const visible = defs.filter(def => !(def.key.startsWith("mortgage_") && def.key !== "mortgage_balance" && !facts.mortgage_balance && !hasProperty));
        return <section className="panel" key={group}>
          <h3>{t.groups[group]}</h3>
          <div>{visible.map(def => { const fact = facts[def.key]; return <div key={def.key}>
            <div className="fact"><span className="label">{def.label[lang]}<small>{def.why[lang]}</small></span><span><span className={`value num ${fact ? "" : "unknown"}`}>{fact ? factDisplay(def.key, fact.value, lang) : "—"}</span><span className={`src ${fact?.source ?? ""}`}>{sourceLabel(fact?.source, lang)}</span></span><button className="icon-btn" aria-label={`${t.edit}: ${def.label[lang]}`} onClick={() => setEditing(editing === def.key ? null : def.key)}><Pencil /></button></div>
            {editing === def.key && <FactEditor factKey={def.key} lang={lang} initial={fact?.value} onSave={async value => { await actions.save(def.key, value); setEditing(null); toast(t.save); }} onCancel={() => setEditing(null)} onRemove={fact ? async () => { await actions.remove(def.key); setEditing(null); } : undefined} />}
          </div>; })}</div>
        </section>;
      })}

      {picture.mortgage && <section className="panel"><h3>{t.plan.mortgage}</h3>
        <div className="mini-table">{picture.mortgage.currentPayment !== null && <div className="mini-row"><span>{t.plan.current}</span><b className="num">{money(picture.mortgage.currentPayment, lang, 2)}</b><small>{facts.mortgage_rate_pct ? pct(Number(facts.mortgage_rate_pct.value), lang, 2) : ""}</small></div>}
          {picture.mortgage.sensitivity.map(item => <div className="mini-row" key={item.annualRatePct}><span>{t.cards.at} {pct(item.annualRatePct, lang)}</span><b className="num">{money(item.payment, lang, 2)}</b><small className="num">{money(item.totalInterest, lang)} {lang === "de" ? "Zinsen" : "interest"}</small></div>)}</div>
        {picture.mortgage.monthsUntilRefix !== null && <p className="note">{lang === "de" ? `Zinsbindung endet ${facts.mortgage_fixed_until ? yearMonth(String(facts.mortgage_fixed_until.value), lang) : ""} – in ${picture.mortgage.monthsUntilRefix} Monaten.` : `Fixed rate ends ${facts.mortgage_fixed_until ? yearMonth(String(facts.mortgage_fixed_until.value), lang) : ""}, in ${picture.mortgage.monthsUntilRefix} months.`}</p>}
        <p className="note">{picture.mortgage.assumedMonths ? picture.assumptions.find(item => item.en.includes("term"))?.[lang] : ""} {t.plan.model}</p></section>}

      {picture.retirement && <section className="panel"><h3>{t.plan.retirement}</h3>
        <div className="metric-grid"><div className="metric"><small>{t.plan.projected}</small><strong className="num">{money(picture.retirement.projectedReal, lang)}</strong><em>{picture.retirement.input.years} {t.plan.years}</em></div><div className="metric"><small>{t.plan.sustainable}</small><strong className="num">{money(picture.retirement.sustainableMonthlyReal, lang)}</strong></div>
          {picture.retirement.requiredCapital !== null && <div className="metric"><small>{t.plan.required}</small><strong className="num">{money(picture.retirement.requiredCapital, lang)}</strong></div>}
          {picture.retirement.readinessRatio !== null && <div className="metric"><small>{t.plan.readiness}</small><strong className="num">{pct(picture.retirement.readinessRatio * 100, lang, 0)}</strong><div className="bar"><i className={picture.retirement.readinessRatio < .8 ? "warn" : ""} style={{ width: `${Math.min(100, picture.retirement.readinessRatio * 100)}%` }} /></div></div>}</div>
        <p className="note">{picture.assumptions.filter(item => item.en.startsWith("Retirement") || item.en.startsWith("Monthly")).map(item => item[lang]).join(" ")}</p></section>}

      {portfolio && <section className="panel" style={{ gridColumn: "1 / -1" }}><h3>{t.portfolio}<span className="spacer" /><small>{t.delayed} · {portfolio.pricing.containsFallback ? (lang === "de" ? "teilweise Snapshot" : "partly snapshot") : (lang === "de" ? "öffentliche Kurse" : "public quotes")}</small></h3>
        <div className="metric-grid"><div className="metric"><small>{t.valueNow}</small><strong className="num">{money(portfolio.summary.marketValueEur, lang)}</strong><em className={portfolio.summary.gainEur >= 0 ? "pos" : "neg"}>{portfolio.summary.gainEur >= 0 ? "+" : ""}{money(portfolio.summary.gainEur, lang)} · {pct(portfolio.summary.gainPct, lang)}</em></div><div className="metric"><small>{t.top3}</small><strong className="num">{pct(portfolio.summary.topThreeWeightPct, lang, 0)}</strong><em>{portfolio.sectors[0]?.name} {pct(portfolio.sectors[0]?.weightPct ?? 0, lang, 0)}</em></div></div>
        <div className="bar">{portfolio.sectors.map((sector, index) => <i key={sector.name} className={`s${Math.min(3, index)}`} style={{ width: `${sector.weightPct}%` }} />)}</div>
        <div className="legend">{portfolio.sectors.map((sector, index) => <span key={sector.name}><i className={`s${Math.min(3, index)}`} />{sector.name} {pct(sector.weightPct, lang, 0)}</span>)}</div>
        <div><div className="holding"><span>{t.holdings}</span><span className="r">{lang === "de" ? "Wert" : "Value"}</span><span className="r">{lang === "de" ? "Anteil" : "Weight"}</span><span className="r">12M</span></div>
          {portfolio.holdings.map(item => <div className="holding" key={item.symbol}><span><b>{item.symbol}</b><small>{item.name} · {item.quantity} × {item.currency === "EUR" ? money(item.price, lang, 2) : new Intl.NumberFormat("en-US", { style: "currency", currency: item.currency }).format(item.price)}</small></span><span className="r num">{money(item.valueEur, lang)}</span><span className="r num">{pct(item.weightPct, lang)}</span><span className={`r num ${item.oneYearChangePct >= 0 ? "pos" : "neg"}`}>{item.oneYearChangePct >= 0 ? "+" : ""}{pct(item.oneYearChangePct, lang)}</span></div>)}</div>
        <p className="note">{lang === "de" ? "Fiktives Beispieldepot mit verzögerten öffentlichen Kursen. Nicht für Handelsentscheidungen." : "Fictional sample portfolio with delayed public prices. Not for trading decisions."}</p></section>}
    </div>

    {picture.assumptions.length > 0 && <section className="panel"><h3>{t.assumptions}</h3><p className="note">{picture.assumptions.map(item => item[lang]).join(" ")}</p></section>}
  </div>;
}
