"use client";
import {useEffect,useState} from 'react';
import {ArrowDownLeft,ArrowUpRight,ChevronLeft,ChevronRight,Landmark,Search,ShieldCheck,SlidersHorizontal} from 'lucide-react';
import type {AppState,BankCategory,BankQuery,BankReport,BankTransaction,Lang} from '@fintwin/contracts';
import {BANK_CATEGORIES,type BankMonth} from '@fintwin/engine';
import {api} from '../lib/api';

const cash=(cents:number,lang:Lang)=>new Intl.NumberFormat(lang==='de'?'de-DE':'en-GB',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(cents/100);
const monthLabel=(value:string,lang:Lang,full=false)=>new Intl.DateTimeFormat(lang==='de'?'de-DE':'en-GB',{month:full?'long':'short',...(full?{year:'numeric' as const}:{}),timeZone:'UTC'}).format(new Date(`${value}-01T00:00:00Z`));
export function SpendingChart({months,lang,selected,onSelect,compact=false}:{months:BankMonth[];lang:Lang;selected?:string;onSelect?:(month:string)=>void;compact?:boolean}){
  const [hover,setHover]=useState<string>();
  const active=months.find(m=>m.month===(hover??selected))??months.at(-1);
  const max=Math.max(1,...months.flatMap(m=>[m.incomeCents,m.spendingCents]));
  return <div className={`spending-chart ${compact?'compact':''}`} aria-label={lang==='de'?'Monatlicher Ausgabenverlauf':'Monthly spending chart'}>
    {!compact&&<div className="chart-readout" aria-live="polite"><span>{active?monthLabel(active.month,lang,true):'—'}</span><strong className="num">{active?cash(active.spendingCents,lang):'—'} <small>{lang==='de'?'Ausgaben':'spent'}</small></strong></div>}
    <div className="chart-plot"><div className="chart-grid" aria-hidden="true"><span/><span/><span/></div>
      <div className="chart-columns">{months.map(m=><button key={m.month} type="button" className={`chart-column ${m.month===(hover??selected)?'selected':''}`} onMouseEnter={()=>setHover(m.month)} onMouseLeave={()=>setHover(undefined)} onFocus={()=>setHover(m.month)} onBlur={()=>setHover(undefined)} onClick={()=>onSelect?.(m.month)} aria-pressed={selected===m.month} aria-label={`${monthLabel(m.month,lang,true)}: ${lang==='de'?'Ausgaben':'spending'} ${cash(m.spendingCents,lang)}, ${lang==='de'?'Einkommen':'income'} ${cash(m.incomeCents,lang)}`}>
        <span className="column-pair"><i className="income-column" style={{height:`${m.incomeCents/max*100}%`}}/><i className="spending-column" style={{height:`${m.spendingCents/max*100}%`}}/></span><span className="column-label">{monthLabel(m.month,lang)}</span>
      </button>)}</div>
    </div>
    {!compact&&<div className="chart-legend"><span><i className="income-key"/>{lang==='de'?'Einkommen':'Income'}</span><span><i className="spending-key"/>{lang==='de'?'Ausgaben':'Spending'}</span><small>{lang==='de'?'Monat anklicken zum Filtern':'Select a month to inspect'}</small></div>}
  </div>;
}

function TransactionList({rows,lang}:{rows:BankTransaction[];lang:Lang}){
  const [page,setPage]=useState(0);
  useEffect(()=>setPage(0),[rows]);
  const visible=rows.slice(page*8,page*8+8),de=lang==='de';
  return <div className="ledger">
    {rows.length===0?<p className="bank-empty">{de?'Keine passenden Buchungen. Ändern Sie die Filter.':'No matching transactions. Try a different filter.'}</p>:<>
      <div className="ledger-head"><span>{de?'Buchung':'Transaction'}</span><span>{de?'Betrag':'Amount'}</span></div>
      {visible.map(row=><div className="transaction" key={row.id}><span className={`transaction-icon ${row.kind}`}>{row.kind==='income'?<ArrowDownLeft/>:<ArrowUpRight/>}</span><div><strong>{row.merchant}</strong><small>{new Intl.DateTimeFormat(de?'de-DE':'en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${row.date}T00:00:00Z`))} · {BANK_CATEGORIES[row.category][de?1:0]}{row.recurring?(de?' · regelmäßig':' · recurring'):''}</small></div><div className="transaction-amount"><strong className={`num ${row.kind==='income'?'pos':''}`}>{row.amountCents>0?'+':''}{cash(row.amountCents,lang)}</strong><small className="num">{de?'Kontostand':'Balance'} {cash(row.balanceCents,lang)}</small></div></div>)}
      <div className="ledger-pagination"><small>{page*8+1}–{Math.min((page+1)*8,rows.length)} / {rows.length} {de?'Buchungen':'transactions'}</small><div><button className="icon-btn" aria-label={de?'Vorherige Buchungen':'Previous transactions'} disabled={page===0} onClick={()=>setPage(p=>p-1)}><ChevronLeft/></button><button className="icon-btn" aria-label={de?'Weitere Buchungen':'Next transactions'} disabled={(page+1)*8>=rows.length} onClick={()=>setPage(p=>p+1)}><ChevronRight/></button></div></div>
    </>}
  </div>;
}

export function BankTrendsCard({report,lang,full=false}:{report:BankReport;lang:Lang;full?:boolean}){
  const de=lang==='de';
  const [selected,setSelected]=useState<string>();
  const [category,setCategory]=useState<BankCategory>();
  useEffect(()=>{setSelected(undefined);setCategory(undefined);},[report]);
  const categoryRows=category?report.transactions.filter(row=>row.category===category):report.transactions;
  const rows=selected?categoryRows.filter(row=>row.date.startsWith(selected)):categoryRows;
  const months=category?report.months.map(m=>({...m,incomeCents:0,spendingCents:-categoryRows.filter(r=>r.date.startsWith(m.month)&&r.kind==='expense').reduce((sum,r)=>sum+r.amountCents,0)})):report.months;
  const spent=-rows.filter(row=>row.kind==='expense').reduce((sum,row)=>sum+row.amountCents,0);
  const categories=report.categories.map(item=>({...item,amountCents:-report.transactions.filter(r=>r.category===item.category&&(!selected||r.date.startsWith(selected))).reduce((sum,r)=>sum+r.amountCents,0)})).filter(item=>item.amountCents>0).sort((a,b)=>b.amountCents-a.amountCents);
  const dateRange=selected?monthLabel(selected,lang,true):`${report.query.from} – ${report.query.to}`;
  return <section className={`bank-report ${full?'full':'card'}`} aria-label={de?'Analyse der Demo-Buchungen':'Demo transaction analysis'}>
    <div className="card-head"><Landmark/><strong>{report.query.category?BANK_CATEGORIES[report.query.category][de?1:0]:de?'Wohin Ihr Geld fließt':'Where your money goes'}</strong><span className="spacer"/><span className="chip">{de?'Synthetische Daten':'Synthetic data'}</span></div>
    <div className="bank-report-total"><div><small>{category?BANK_CATEGORIES[category][de?1:0]:de?'Ausgaben im Zeitraum':'Spending in period'}</small><strong className="num">{cash(spent,lang)}</strong></div><span>{dateRange}<small>{rows.length} {de?'passende Buchungen':'matching transactions'}</small></span></div>
    {(selected||category)&&<div className="bank-filter-chips"><button onClick={()=>{setSelected(undefined);setCategory(undefined);}}>{de?'Auswahl aufheben':'Clear chart selection'} ×</button></div>}
    <SpendingChart months={months} lang={lang} selected={selected} onSelect={month=>setSelected(current=>current===month?undefined:month)}/>
    <div className="bank-analysis-grid">
      <div className="category-section"><h3>{de?'Nach Kategorie':'By category'} <small>{selected?monthLabel(selected,lang):de?'Gesamter Zeitraum':'Full period'}</small></h3><div className="category-list">{categories.map((item,index)=><button className={`category-row ${category===item.category?'active':''}`} key={item.category} onClick={()=>setCategory(current=>current===item.category?undefined:item.category)} aria-pressed={category===item.category}><span><i style={{background:`var(--chart-${index%5})`}}/>{BANK_CATEGORIES[item.category][de?1:0]}<b className="num">{cash(item.amountCents,lang)}</b></span><span className="category-track"><i style={{width:`${item.amountCents/(categories[0]?.amountCents||1)*100}%`,background:`var(--chart-${index%5})`}}/></span></button>)}</div></div>
      {full&&<div className="bank-merchants"><h3>{de?'Häufigste Ausgabenempfänger':'Top spending merchants'}</h3>{report.merchants.slice(0,5).map((m,index)=><div key={m.merchant}><span className="merchant-rank">{String(index+1).padStart(2,'0')}</span><span>{m.merchant}<small>{m.count} {de?'Buchungen':'transactions'}</small></span><b className="num">{cash(m.amountCents,lang)}</b></div>)}<p className="note">{de?'Empfänger-Rangfolge für den gesamten oben gewählten Zeitraum.':'Merchant ranking for the full report period.'}</p></div>}
    </div>
    <details className="ledger-details" open={full}><summary>{de?'Buchungen & Nachweis ansehen':'Inspect transactions & evidence'} <span>{rows.length}</span></summary><TransactionList rows={rows} lang={lang}/></details>
    <p className="note bank-source"><ShieldCheck/>{de?'Fiktives Konto · März–August 2026. Anlageüberträge sind keine Ausgaben. Kontostände zeigen den vollständigen Kontoverlauf, nicht nur die Filterauswahl.':'Fictional account · March–August 2026. Investment transfers are not spending. Balances reflect the full account ledger, not just filtered rows.'}</p>
    {!report.transactions.length&&<p className="banner">{de?'Außerhalb der Demo-Daten ist der Verlauf unbekannt, nicht null.':'Activity outside the demo coverage is unknown, not zero.'}</p>}
  </section>;
}

export function BankView({state,lang,onLoadSample,send}:{state:AppState;lang:Lang;onLoadSample:()=>void;send:(text:string)=>void}){
  const de=lang==='de';
  const [query,setQuery]=useState<BankQuery>({}),[search,setSearch]=useState(''),[report,setReport]=useState<BankReport|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const bankVersion=state.bank?.version;
  useEffect(()=>{if(!bankVersion)return;let active=true;setLoading(true);setError('');api.bank(query).then(result=>{if(active)setReport(result);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[query,bankVersion,state.epoch]);
  if(!state.bank)return <section className="page bank-empty-state"><span className="bank-empty-icon"><Landmark/></span><span className="eyebrow">{de?'Ihr Demo-Konto':'Your demo account'}</span><h1>{de?'Nicht nur Zahlen. Die Geschichte dahinter.':'Beyond the balance. The story behind it.'}</h1><p>{de?'Erkunden Sie sechs Monate synthetischer Buchungen. Finden Sie Ausgabentreiber und fragen Sie FinTwin nach jedem Detail.':'Explore six months of synthetic transactions. Find what drives spending, and ask FinTwin about the details.'}</p><button className="btn primary" onClick={onLoadSample}>{de?'Beispielhaushalt erkunden':'Explore a sample household'}</button><p className="note">{de?'Keine echten Bankdaten oder Zugangsdaten erforderlich.':'No real banking data or credentials needed.'}</p></section>;
  return <div className="page bank-page">
    <div className="page-head"><div><span className="eyebrow">{de?'Kontoeinblicke':'Account intelligence'}</span><h1>{de?'Jede Buchung. Ein klareres Bild.':'Every transaction. A clearer picture.'}</h1><p className="lead">{de?'Erkunden Sie den synthetischen Verlauf – bis auf die einzelne Buchung.':'Explore your synthetic history, right down to the individual transaction.'}</p></div><button className="btn primary" onClick={()=>send(de?'Zeig meine Ausgabentrends':'Show my spending trends')}>{de?'Mit FinTwin analysieren':'Analyze with FinTwin'}<ArrowUpRight/></button></div>
    <div className="bank-account-band"><div><span className="account-logo"><Landmark/></span><span><strong>{state.bank.name}</strong><small>{state.bank.account} · EUR · {de?'Demo-Verbindung':'Demo connection'}</small></span></div><div><small>{de?'Kontostand zum 31. August':'Balance on 31 August'}</small><strong className="num">{cash(state.bank.balanceCents,lang)}</strong></div><span className="demo-connected"><ShieldCheck/>{de?'Synthetisch · keine echte Bank':'Synthetic · not a real bank'}</span></div>
    <form className="bank-filters" onSubmit={e=>{e.preventDefault();setQuery(q=>({...q,merchant:search.trim()||undefined}));}}>
      <SlidersHorizontal aria-hidden="true"/>
      <label>{de?'Zeitraum':'Period'}
        <select aria-label={de?'Zeitraum':'Period'} value={query.from?.slice(0,7)??''} onChange={e=>{const month=e.target.value;setQuery(q=>({...q,from:month?`${month}-01`:undefined,to:month?`${month}-${new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate()}`:undefined}));}}>
          <option value="">{de?'Alle sechs Monate':'All six months'}</option>
          {state.bank.months.map(m=><option key={m.month} value={m.month}>{monthLabel(m.month,lang,true)}</option>)}
        </select>
      </label>
      <label>{de?'Kategorie':'Category'}
        <select aria-label={de?'Kategorie':'Category'} value={query.category??''} onChange={e=>setQuery(q=>({...q,category:(e.target.value||undefined) as BankCategory|undefined}))}>
          <option value="">{de?'Alle Kategorien':'All categories'}</option>
          {Object.entries(BANK_CATEGORIES).map(([key,label])=><option key={key} value={key}>{label[de?1:0]}</option>)}
        </select>
      </label>
      <label className="bank-search">{de?'Empfänger suchen':'Search merchant'}<span>
        <input aria-label={de?'Empfänger suchen':'Search merchant'} value={search} onChange={e=>setSearch(e.target.value)} placeholder={de?'z. B. Fresh Market':'e.g. Fresh Market'}/>
        <button aria-label={de?'Empfänger suchen':'Search merchant'} type="submit"><Search/></button>
      </span></label>
      <label className="bank-recurring"><input type="checkbox" checked={query.recurring??false} onChange={e=>setQuery(q=>({...q,recurring:e.target.checked||undefined}))}/>{de?'Regelmäßig':'Recurring'}</label>
    </form>
    {error&&<p role="alert" className="banner">{error}<button className="btn sm" onClick={()=>setQuery(q=>({...q}))}>{de?'Erneut versuchen':'Retry'}</button></p>}
    {loading&&<p role="status">{de?'Buchungen werden geladen …':'Loading transactions…'}</p>}
    {report&&!loading&&!error&&<BankTrendsCard report={report} lang={lang} full/>}
  </div>;
}
