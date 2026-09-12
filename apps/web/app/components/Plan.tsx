"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {Flag,Landmark,TrendingUp} from 'lucide-react';
import type {AppState,FactKey,Lang,Message,ScenarioSnapshot} from '@fintwin/contracts';
import {factNumber,goal,mortgage,parseLocalizedNumber,retirement} from '@fintwin/engine';
import {api} from '../lib/api';
import {scenarioLabel,scenarioName} from '../lib/scenarios';
import {ScenarioView} from './Scenario';
import {money} from '../lib/format';
interface PlanProps{state:AppState;lang:Lang;applyState(state:AppState):void;send(text:string,scenarioId?:string):void;toast(text:string):void;addMessage(message:Message):void;onSelect?(id:string):void;onBrief?():void}
type Kind=ScenarioSnapshot['kind'];
function defaults(state:AppState,kind:Kind){
  const n=(key:FactKey)=>factNumber(state.facts,key),assets=n('investments_value')!==null&&n('retirement_assets')!==null?n('investments_value')!+n('retirement_assets')!:null;
  if(kind==='mortgage')return{principal:n('mortgage_balance'),rate_pct:n('mortgage_rate_pct'),months:n('mortgage_remaining_months'),special_repayment_monthly:0};
  if(kind==='retirement')return{age:n('age'),retirement_age:n('retirement_age'),current_assets:assets,monthly_contribution:n('monthly_saving'),pension_monthly:n('expected_pension_monthly'),spending_monthly:n('retirement_spending_monthly'),annual_return_pct:5,annual_fee_pct:0.5,inflation_pct:2,withdrawal_rate_pct:4};
  return{target_amount:n('goal_target_amount'),start:n('cash_liquid')!==null&&n('investments_value')!==null?n('cash_liquid')!+n('investments_value')!:null,monthly:n('monthly_saving'),annual_return_pct:4};
}
export function PlanView(props:PlanProps){
  const [kind,setKind]=useState<Kind>(props.state.facts.mortgage_balance?'mortgage':'retirement');
  return <div className="page"><div className="page-head"><div><span className="eyebrow">{props.lang==='de'?'Eine Änderung. Ein nachvollziehbarer Vergleich.':'One change. One clear comparison.'}</span><h1>{props.lang==='de'?'Was wäre, wenn …':'What if …'}</h1><p className="lead">{props.lang==='de'?'Erkunden Sie eine Alternative. Ihre Angaben bleiben unverändert, bis Sie sie ausdrücklich übernehmen.':'Explore an alternative. Your facts stay unchanged unless you explicitly apply it.'}</p></div></div><div className="plan-tabs" role="tablist" aria-label={props.lang==='de'?'Szenarioart':'Scenario type'}>{(['mortgage','retirement','goal'] as Kind[]).map(k=>{const Icon=k==='mortgage'?Landmark:k==='retirement'?TrendingUp:Flag;return <button key={k} role="tab" aria-selected={k===kind} className={k===kind?'active':''} onClick={()=>setKind(k)}><Icon/>{scenarioName(k,props.lang)}</button>;})}</div>{(['mortgage','retirement','goal'] as Kind[]).map(k=><div key={`${k}:${props.state.epoch}`} hidden={kind!==k}><Planner {...props} kind={k}/></div>)}</div>;
}
function Planner({state,lang,kind,applyState,send,toast,addMessage,onSelect,onBrief}:PlanProps&{kind:Kind}){
  const de=lang==='de',f=(v:number|null|undefined)=>v==null?'':new Intl.NumberFormat(de?'de-DE':'en-GB',{useGrouping:false,maximumFractionDigits:2}).format(v);
  const makeFields=()=>Object.fromEntries(Object.entries(defaults(state,kind)).map(([k,v])=>[k,f(v)]));
  const [fields,setFields]=useState<Record<string,string>>(makeFields),[revision,setRevision]=useState(state.revision),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[snapshot,setSnapshot]=useState<ScenarioSnapshot|null>(state.scenarios.find(s=>s.kind===kind)??null);
  const changed=revision!==state.revision;
  const fieldLanguage=useRef(lang);
  useEffect(()=>{if(fieldLanguage.current===lang)return;const previous=fieldLanguage.current;fieldLanguage.current=lang;setFields(current=>Object.fromEntries(Object.entries(current).map(([k,v])=>{const n=parseLocalizedNumber(v,previous);return[k,n===null?v:new Intl.NumberFormat(lang==='de'?'de-DE':'en-GB',{useGrouping:false,maximumFractionDigits:2}).format(n)];})));},[lang]);
  useEffect(()=>{if(!dirty)return;const prevent=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[dirty]);
  const canonical=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,parseLocalizedNumber(v,lang)]));
  const valid=Object.values(canonical).every(v=>v!==null);
  const inputs=canonical as Record<string,number>;
  const preview=useMemo(()=>{
    if(!valid||changed)return null;
    try{
      if(kind==='mortgage'){const r=mortgage(inputs.principal,inputs.rate_pct,inputs.months,inputs.special_repayment_monthly);return money(r.payment+r.specialRepayment,lang,2);}
      if(kind==='retirement'){const r=retirement({currentAssets:inputs.current_assets,monthlyContribution:inputs.monthly_contribution,years:inputs.retirement_age-inputs.age,annualReturnPct:inputs.annual_return_pct,annualFeePct:inputs.annual_fee_pct,inflationPct:inputs.inflation_pct,withdrawalRatePct:inputs.withdrawal_rate_pct,expectedPensionMonthly:inputs.pension_monthly,targetSpendingMonthly:inputs.spending_monthly});return money(r.projectedReal,lang);}
      return goal(inputs.target_amount,inputs.start,inputs.monthly,inputs.annual_return_pct,new Date(state.picture.asOf)).reachedYearMonth??(de?'Ziel nicht erreicht':'Target not reached');
    }catch{return null;}
  },[fields,kind,lang,valid,changed,state.picture.asOf]); // eslint-disable-line react-hooks/exhaustive-deps
  function rebase(){if(dirty&&!window.confirm(de?'Ungespeicherte Szenarioeingaben durch Ihre aktuellen Angaben ersetzen?':'Replace unsaved scenario inputs with your current facts?'))return;setFields(makeFields());setRevision(state.revision);setDirty(false);setSnapshot(null);setError('');}
  async function calculate(ask=false){
    setBusy(true);setError('');
    try{const result=await api.createScenario(kind,inputs,revision);setSnapshot(result.snapshot);setDirty(false);applyState(result.state);onSelect?.(result.snapshot.id);if(ask)send(de?'Was bedeutet dieses Szenario für mein Ziel?':'What does this scenario mean for my goal?',result.snapshot.id);}
    catch(e){setError(e instanceof Error?e.message:'Calculation unavailable.');}finally{setBusy(false);}
  }
  async function apply(){
    if(!window.confirm(de?'Diese Szenariowerte ausdrücklich als Ihre neuen Angaben übernehmen?':'Explicitly apply these scenario values as your new facts?'))return;
    const mapping:Record<string,FactKey>={principal:'mortgage_balance',rate_pct:'mortgage_rate_pct',months:'mortgage_remaining_months',retirement_age:'retirement_age',monthly_contribution:'monthly_saving',pension_monthly:'expected_pension_monthly',spending_monthly:'retirement_spending_monthly',target_amount:'goal_target_amount',monthly:'monthly_saving'};
    setBusy(true);try{const result=await api.patchFacts(Object.entries(inputs).filter(([k])=>mapping[k]).map(([k,value])=>({key:mapping[k],value})),revision);if(result.rejected.length)throw new Error(de?'Einige Werte wurden nicht übernommen.':'Some values could not be applied.');applyState(result.state);setRevision(result.state.revision);setSnapshot(null);setDirty(false);if(result.message)addMessage(result.message);toast(de?'Ihre Angaben wurden aktualisiert.':'Your facts were updated.');}catch(e){setError(String((e as Error).message));}finally{setBusy(false);}
  }
  return <><div className="scenario-context"><span>{de?'Haushaltsversion':'Household revision'} {revision}</span><span>{de?'Beträge in EUR · ausdrücklich hypothetisch':'Amounts in EUR · explicitly hypothetical'}</span></div>
    {changed&&<div className="banner"><span>{de?'Ihr Haushaltsbild hat sich geändert. Vor der nächsten Berechnung aktualisieren.':'Your household picture changed. Refresh the inputs before calculating.'}</span><button className="btn sm" onClick={rebase}>{de?'Aktuelle Angaben laden':'Load current facts'}</button></div>}
    <div className="grid-2"><section className="panel"><h3>{de?'Ihre Alternative':'Your alternative'}</h3><div className="scenario-fields">{Object.entries(fields).map(([key,value])=><div className="field" key={key}><label htmlFor={`scenario-${kind}-${key}`}>{scenarioLabel(key,lang)}</label><div className="input"><input id={`scenario-${kind}-${key}`} inputMode="decimal" value={value} placeholder={de?'Nicht angegeben':'Not provided'} onChange={e=>{setFields({...fields,[key]:e.target.value});setDirty(true);}}/></div>{kind==='mortgage'&&['rate_pct','special_repayment_monthly'].includes(key)&&<input type="range" aria-label={`${scenarioLabel(key,lang)} ${de?'Schieberegler':'slider'}`} min="0" max={key==='rate_pct'?10:1000} step={key==='rate_pct'?0.05:25} value={canonical[key]??0} onChange={e=>{setFields({...fields,[key]:f(Number(e.target.value))});setDirty(true);}}/>}</div>)}</div>
    {kind==='retirement'&&state.facts.expected_pension_monthly===undefined&&<p className="note">{de?'Rente unbekannt. Tragen Sie für ein bewusstes Null-Renten-Szenario 0 ein; dies ändert Ihre persönlichen Angaben nicht.':'Pension is unknown. Enter 0 to explore an explicit zero-pension scenario; this does not change your facts.'}</p>}
    {!valid&&<p className="note">{de?'Fehlende Angaben bleiben offen. Ergänzen Sie die Eingaben, bevor Sie dieses Szenario besprechen.':'Missing information stays unknown. Complete the inputs before discussing this scenario.'}</p>}
    <div className="field-actions"><button className="btn primary" disabled={!preview||changed||busy} onClick={()=>void calculate(true)}>{de?'Mit FinTwin besprechen':'Ask FinTwin'}</button><button className="btn" disabled={!preview||changed||busy} onClick={()=>void calculate()}>{de?'Szenario speichern':'Save scenario'}</button></div><button className="btn sm ghost" disabled={!preview||changed||busy} onClick={()=>void apply()}>{de?'Als meine Angaben übernehmen':'Apply to my facts'}</button>
    {error&&<p className="error-line" role="alert">{error}</p>}</section>
    <section><div className="panel result-big"><small>{de?'Lokale Vorschau':'Local preview'} · {kind==='mortgage'?(de?'Monatsrate inklusive Zusatztilgung':'Monthly payment including extra'):kind==='retirement'?(de?'Kapital in heutiger Kaufkraft':'Capital in today’s purchasing power'):(de?'Zielzeitpunkt':'Target date')}</small><strong className="num">{preview??'—'}</strong><p className="note">{de?'Gespeicherte Ergebnisse werden auf dem Server neu berechnet.':'Saved results are independently recalculated on the server.'}</p></div>
    {snapshot&&<><ScenarioView snapshot={{...snapshot,stale:snapshot.revision!==state.revision}} lang={lang}/>{dirty&&<p className="banner">{de?'Ungespeicherte Änderungen: Der gespeicherte Vergleich zeigt die vorige Eingabe.':'Unsaved changes: the saved comparison still shows the previous inputs.'}</p>}<button className="btn" disabled={dirty||changed||snapshot.revision!==state.revision} onClick={()=>{onSelect?.(snapshot.id);onBrief?.();}}>{de?'Beratungsgespräch vorbereiten':'Prepare adviser meeting'}</button></>}
    </section></div></>;
}
