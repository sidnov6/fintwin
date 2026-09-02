"use client";
import { useMemo, useState } from "react";
import { Flag, Landmark, TrendingUp } from "lucide-react";
import type { AppState, Lang, Message } from "@fintwin/contracts";
import { factNumber, goal, mortgage, retirement } from "@fintwin/engine";
import { api } from "../lib/api";
import { money, pct, yearMonth } from "../lib/format";
import { copy } from "../lib/i18n";

interface PlanProps { state: AppState; lang: Lang; applyState(state: AppState): void; send(text: string): void; toast(text: string): void; addMessage(message: Message): void }
type Tab = "mortgage" | "retirement" | "goal";

export function PlanView({ state, lang, applyState, send, toast, addMessage }: PlanProps) {
  const t = copy(lang).plan;
  const facts = state.facts;
  const n = (key: Parameters<typeof factNumber>[1]) => factNumber(facts, key);
  const [tab, setTab] = useState<Tab>(n("mortgage_balance") ? "mortgage" : "retirement");

  // Mortgage
  const [principal, setPrincipal] = useState(n("mortgage_balance") ?? 240000);
  const [years, setYears] = useState(Math.round((n("mortgage_remaining_months") ?? 240) / 12));
  const [rate, setRate] = useState(n("mortgage_rate_pct") ?? 4);
  const [special, setSpecial] = useState(0);
  const mortgageResult = useMemo(() => mortgage(principal, rate, years * 12, special), [principal, rate, years, special]);
  const baseline = useMemo(() => [4, 5, 6].map(item => mortgage(principal, item, years * 12)), [principal, years]);
  const currentPayment = n("mortgage_payment_monthly");

  // Retirement
  const age = n("age");
  const [retireAt, setRetireAt] = useState(n("retirement_age") ?? 65);
  const [investing, setInvesting] = useState(n("monthly_saving") ?? Math.max(0, (n("income_net_monthly") ?? 0) - (n("expenses_monthly") ?? 0)));
  const [spending, setSpending] = useState(n("retirement_spending_monthly") ?? 3000);
  const [pension, setPension] = useState(n("expected_pension_monthly") ?? 0);
  const [returnPct, setReturnPct] = useState(5);
  const retirementResult = useMemo(() => age === null ? null : retirement({ currentAssets: (n("investments_value") ?? 0) + (n("retirement_assets") ?? 0), monthlyContribution: investing, years: retireAt - age, annualReturnPct: returnPct, expectedPensionMonthly: pension, targetSpendingMonthly: spending }), [age, retireAt, investing, spending, pension, returnPct, facts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Goal
  const [target, setTarget] = useState(n("goal_target_amount") ?? 100000);
  const [goalMonthly, setGoalMonthly] = useState(investing);
  const start = (n("cash_liquid") ?? 0) + (n("investments_value") ?? 0);
  const goalResult = useMemo(() => goal(target, start, goalMonthly, 4, new Date()), [target, start, goalMonthly]);

  async function saveFacts(facts: Array<{ key: Parameters<typeof factNumber>[1]; value: number }>) { const result = await api.patchFacts(facts); applyState(result.state); if (result.message) addMessage(result.message); toast(copy(lang).save); }

  return <div className="page">
    <div className="page-head"><div><h1>{t.title}</h1><p className="lead">{lang === "de" ? "Regler bewegen, sofort sehen, was passiert. Alles bleibt eine Modellrechnung – und FinTwin kann jedes Szenario mit Ihnen besprechen." : "Move the sliders and see what happens instantly. Everything stays a model, and FinTwin can talk any scenario through with you."}</p></div>
      <div className="plan-tabs" role="tablist"><button role="tab" aria-selected={tab === "mortgage"} className={tab === "mortgage" ? "active" : ""} onClick={() => setTab("mortgage")}><Landmark />{t.mortgage}</button><button role="tab" aria-selected={tab === "retirement"} className={tab === "retirement" ? "active" : ""} onClick={() => setTab("retirement")}><TrendingUp />{t.retirement}</button><button role="tab" aria-selected={tab === "goal"} className={tab === "goal" ? "active" : ""} onClick={() => setTab("goal")}><Flag />{t.goal}</button></div></div>

    {tab === "mortgage" && <div className="grid-2">
      <section className="panel">
        <div className="slider"><label>{t.balance}<b className="num">{money(principal, lang)}</b></label><input type="range" min={20000} max={1000000} step={5000} value={principal} onChange={event => setPrincipal(Number(event.target.value))} aria-label={t.balance} /></div>
        <div className="slider"><label>{t.term}<b className="num">{years} {t.years}</b></label><input type="range" min={5} max={35} value={years} onChange={event => setYears(Number(event.target.value))} aria-label={t.term} /></div>
        <div className="slider"><label>{t.rate}<b className="num">{pct(rate, lang, 2)}</b></label><input type="range" min={0.5} max={9} step={0.05} value={rate} onChange={event => setRate(Number(event.target.value))} aria-label={t.rate} /></div>
        <div className="slider"><label>{lang === "de" ? "Sondertilgung / Monat" : "Extra repayment / month"}<b className="num">{money(special, lang)}</b></label><input type="range" min={0} max={2000} step={50} value={special} onChange={event => setSpecial(Number(event.target.value))} /></div>
        <div className="field-actions"><button className="btn sm ghost" onClick={() => void saveFacts([{ key: "mortgage_balance", value: principal }, { key: "mortgage_remaining_months", value: years * 12 }, { key: "mortgage_rate_pct", value: rate }])}>{t.saveFacts}</button><button className="btn sm primary" onClick={() => send(lang === "de" ? `Was bedeutet ein Zins von ${rate.toFixed(2).replace(".", ",")} % bei ${money(principal, lang)} Restschuld über ${years} Jahre für mich?` : `What does a ${rate.toFixed(2)}% rate on ${money(principal, lang)} over ${years} years mean for me?`)}>{t.ask}</button></div>
      </section>
      <section className="panel">
        <div className="result-big"><small>{t.payment} · {pct(rate, lang, 2)}</small><strong className="num">{money(mortgageResult.payment + special, lang, 2)}</strong><em>{currentPayment !== null ? `${t.current}: ${money(currentPayment, lang)} → ${mortgageResult.payment + special - currentPayment >= 0 ? "+" : "−"}${money(Math.abs(mortgageResult.payment + special - currentPayment), lang)}` : `${t.interest}: ${money(mortgageResult.totalInterest, lang)}`}{special > 0 ? ` · ${lang === "de" ? "abbezahlt in" : "paid off in"} ${Math.round(mortgageResult.payoffMonths / 12 * 10) / 10} ${t.years}` : ""}</em></div>
        <div className="rates">{baseline.map(item => <div className={Math.abs(item.annualRatePct - rate) < 0.5 ? "focus" : ""} key={item.annualRatePct}><span>{pct(item.annualRatePct, lang, 0)}</span><b className="num">{money(item.payment, lang, 0)}</b><span className="num">{money(item.totalInterest, lang)} {lang === "de" ? "Zinsen" : "interest"}</span></div>)}</div>
        <p className="note">{t.model}</p>
      </section>
    </div>}

    {tab === "retirement" && (age === null ? <div className="banner"><span>{t.needs} {lang === "de" ? "Alter" : "age"}.</span><button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => send(lang === "de" ? "Ich möchte meine Rente planen." : "I want to plan my retirement.")}>{t.ask}</button></div>
      : <div className="grid-2">
        <section className="panel">
          <div className="slider"><label>{t.retireAt}<b className="num">{retireAt}</b></label><input type="range" min={Math.max(age + 1, 50)} max={75} value={retireAt} onChange={event => setRetireAt(Number(event.target.value))} aria-label={t.retireAt} /></div>
          <div className="slider"><label>{t.investing}<b className="num">{money(investing, lang)}</b></label><input type="range" min={0} max={5000} step={50} value={investing} onChange={event => setInvesting(Number(event.target.value))} aria-label={t.investing} /></div>
          <div className="slider"><label>{t.spending}<b className="num">{money(spending, lang)}</b></label><input type="range" min={500} max={10000} step={100} value={spending} onChange={event => setSpending(Number(event.target.value))} aria-label={t.spending} /></div>
          <div className="slider"><label>{t.pension}<b className="num">{money(pension, lang)}</b></label><input type="range" min={0} max={5000} step={50} value={pension} onChange={event => setPension(Number(event.target.value))} aria-label={t.pension} /></div>
          <div className="slider"><label>{lang === "de" ? "Rendite p. a." : "Return p.a."}<b className="num">{pct(returnPct, lang)}</b></label><input type="range" min={1} max={9} step={0.5} value={returnPct} onChange={event => setReturnPct(Number(event.target.value))} /></div>
          <div className="field-actions"><button className="btn sm ghost" onClick={() => void saveFacts([{ key: "retirement_age", value: retireAt }, { key: "monthly_saving", value: investing }, { key: "retirement_spending_monthly", value: spending }, ...(pension > 0 ? [{ key: "expected_pension_monthly" as const, value: pension }] : [])])}>{t.saveFacts}</button><button className="btn sm primary" onClick={() => send(lang === "de" ? `Wie sieht meine Rente mit ${retireAt} aus, wenn ich ${money(investing, lang)} im Monat anlege und ${money(spending, lang)} im Monat brauche?` : `What does retiring at ${retireAt} look like if I invest ${money(investing, lang)} a month and need ${money(spending, lang)} a month?`)}>{t.ask}</button></div>
        </section>
        {retirementResult && <section className="panel">
          <div className="ring" style={{ background: `conic-gradient(var(--accent) 0 ${Math.min(100, (retirementResult.readinessRatio ?? 0) * 100)}%, var(--surface-3) ${Math.min(100, (retirementResult.readinessRatio ?? 0) * 100)}%)` }}><span className="num">{pct(Math.min(999, (retirementResult.readinessRatio ?? 0) * 100), lang, 0)}</span></div>
          <div className="metric-grid"><div className="metric"><small>{t.projected}</small><strong className="num">{money(retirementResult.projectedReal, lang)}</strong><em>{retirementResult.input.years} {t.years}</em></div><div className="metric"><small>{t.required}</small><strong className="num">{money(retirementResult.requiredCapital ?? 0, lang)}</strong><em>{lang === "de" ? "bei 4 % Entnahme" : "at 4% withdrawal"}</em></div><div className="metric"><small>{t.sustainable}</small><strong className="num">{money(retirementResult.sustainableMonthlyReal, lang)}</strong></div><div className="metric"><small>{lang === "de" ? "Lücke pro Monat" : "Gap per month"}</small><strong className="num">{money(retirementResult.gapMonthly ?? 0, lang)}</strong></div></div>
          <p className="note">{lang === "de" ? `${returnPct} % Rendite, 0,5 % Kosten, 2 % Inflation, heutige Kaufkraft.` : `${returnPct}% return, 0.5% fees, 2% inflation, today's purchasing power.`} {t.model}</p>
        </section>}
      </div>)}

    {tab === "goal" && <div className="grid-2">
      <section className="panel">
        <div className="field"><label htmlFor="goal-target">{t.target}</label><div className="input"><b>€</b><input id="goal-target" type="text" inputMode="numeric" value={target} onChange={event => setTarget(Number(event.target.value.replace(/[^\d]/g, "")) || 0)} /></div></div>
        <div className="slider"><label>{t.investing}<b className="num">{money(goalMonthly, lang)}</b></label><input type="range" min={0} max={5000} step={50} value={goalMonthly} onChange={event => setGoalMonthly(Number(event.target.value))} aria-label={t.investing} /></div>
        <p className="note">{lang === "de" ? `Start: ${money(start, lang)} (Guthaben + Depot), 4 % Rendite. Immobilie zählt nicht mit.` : `Start: ${money(start, lang)} (cash + investments), 4% return. Property is excluded.`}</p>
        <div className="field-actions"><button className="btn sm ghost" onClick={() => void saveFacts([{ key: "goal_target_amount", value: target }, { key: "monthly_saving", value: goalMonthly }])}>{t.saveFacts}</button><button className="btn sm primary" onClick={() => send(lang === "de" ? `Wann erreiche ich ${money(target, lang)}, wenn ich ${money(goalMonthly, lang)} im Monat anlege?` : `When will I reach ${money(target, lang)} if I invest ${money(goalMonthly, lang)} a month?`)}>{t.ask}</button></div>
      </section>
      <section className="panel">
        <div className="result-big"><small>{t.reached}</small><strong className="num">{goalResult.reachedYearMonth ? yearMonth(goalResult.reachedYearMonth, lang) : t.never}</strong><em>{goalResult.months !== null ? `${Math.round(goalResult.months / 12)} ${t.years}` : ""}</em></div>
        <div className="mini-table">{goalResult.requiredMonthlyForYears.map(item => <div className="mini-row" key={item.years}><span>{t.needFor(item.years)}</span><b className="num">{money(item.monthly, lang)}</b><small>/ {lang === "de" ? "Monat" : "month"}</small></div>)}</div>
        <p className="note">{t.model}</p>
      </section>
    </div>}
  </div>;
}
