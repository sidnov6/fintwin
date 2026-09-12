"use client";
import type {Lang,ScenarioSnapshot} from '@fintwin/contracts';
import {assumptionLabel,scenarioLabel,scenarioName} from '../lib/scenarios';
import {mortgage,type MortgageResult} from '@fintwin/engine';
import {money} from '../lib/format';
function MortgageChart({base,result,lang}:{base:MortgageResult;result:MortgageResult;lang:Lang}){
  const series=(r:MortgageResult)=>r.balanceByYear??mortgage(r.principal,r.annualRatePct,r.months,r.specialRepayment).balanceByYear!;
  const maxMonths=Math.max(base.payoffMonths,result.payoffMonths,1),maxBalance=Math.max(base.principal,result.principal,1);
  const path=(r:MortgageResult)=>series(r).map((p,i)=>`${i?'L':'M'}${52+p.month/maxMonths*500},${170-p.balance/maxBalance*140}`).join(' ');
  return <figure className="mortgage-chart"><figcaption>{lang==='de'?'So entwickelt sich die Restschuld':'How your mortgage balance changes'}<small>{lang==='de'?'Modellierter Tilgungsverlauf · kein historischer Kontostand':'Modeled repayment path · not historical account balances'}</small></figcaption><svg viewBox="0 0 590 210" role="img" aria-label={lang==='de'?'Restschuld über die Laufzeit: Ausgangslage und Szenario':'Mortgage balance over time: baseline and alternative'}>{[0,.5,1].map(f=><g key={f}><line x1="52" x2="552" y1={170-f*140} y2={170-f*140} className="chart-rule"/><text x="46" y={174-f*140} textAnchor="end">{new Intl.NumberFormat(lang==='de'?'de-DE':'en-GB',{notation:'compact',maximumFractionDigits:0}).format(f*maxBalance)} €</text></g>)}<path d={path(base)} className="baseline-path"/><path d={path(result)} className="alternative-path"/>{[0,.25,.5,.75,1].map(f=><text key={f} x={52+500*f} y="196" textAnchor="middle">{Math.round(maxMonths*f/12)} {lang==='de'?'J.':'yr'}</text>)}</svg><div className="chart-legend"><span><i className="baseline-key"/>{lang==='de'?'Ausgangslage':'Baseline'} · {base.annualRatePct}%</span><span><i className="spending-key"/>{lang==='de'?'Szenario':'Alternative'} · {result.annualRatePct}%</span></div><div className="mortgage-chart-stats"><span>{lang==='de'?'Monatliche Modellrate':'Modeled monthly payment'}<strong className="num">{money(result.payment+result.specialRepayment,lang,2)}</strong></span><span>{lang==='de'?'Zinsen über die Laufzeit':'Interest over the term'}<strong className="num">{money(result.totalInterest,lang)}</strong></span></div></figure>;
}
export function ScenarioView({snapshot:s,lang}:{snapshot:ScenarioSnapshot;lang:Lang}){
  const de=lang==='de';const format=(value:unknown)=>typeof value==='number'?new Intl.NumberFormat(de?'de-DE':'en-GB',{maximumFractionDigits:2}).format(value):value===null?'—':String(value);
  const keys=s.kind==='mortgage'?['payment','specialRepayment','totalInterest','payoffMonths']:s.kind==='retirement'?['projectedReal','requiredCapital','sustainableMonthlyReal']:['monthly','reachedYearMonth'];
  const result=s.result as unknown as Record<string,unknown>,base=s.baseline as unknown as Record<string,unknown>;
  return <section className="scenario-card card" aria-label={scenarioName(s.kind,lang)}>
    <div className="card-head"><strong>{scenarioName(s.kind,lang)}</strong><span className="chip">{de?'Modellrechnung':'Illustrative scenario'}</span></div>
    {s.stale && <p className="banner">{de?'Basiert auf einer früheren Haushaltsversion. Für aktuelle Aussagen neu berechnen.':'Based on an earlier household revision. Recalculate before using it as current.'}</p>}
    {s.kind==='mortgage'&&<MortgageChart base={s.baseline as MortgageResult} result={s.result as MortgageResult} lang={lang}/>}
    <table className="scenario-table"><thead><tr><th scope="col">{de?'Ergebnis':'Result'}</th><th scope="col">{de?'Ausgangslage':'Baseline'}</th><th scope="col">{de?'Szenario':'Alternative'}</th></tr></thead><tbody>{keys.map(key=><tr key={key}><th scope="row">{scenarioLabel(key,lang)}</th><td className="num">{format(base[key])}</td><td className="num">{format(result[key])}</td></tr>)}</tbody></table>
    <details><summary>{de?'Eingaben und Annahmen ansehen':'View inputs and assumptions'}</summary><dl className="assumption-grid">{Object.entries(s.inputs).map(([key,value])=><div key={key}><dt>{scenarioLabel(key,lang)}</dt><dd className="num">{format(value)}</dd></div>)}</dl><ul className="notes-list">{s.assumptions.map(key=><li key={key}>{assumptionLabel(key,lang)}</li>)}</ul><p className="note">{de?'Stand':'As of'} {s.asOf.slice(0,10)} · {s.engineVersion} · {de?'Haushaltsversion':'Household revision'} {s.revision} · {s.id}</p></details>
  </section>;
}
