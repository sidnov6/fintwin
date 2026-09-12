import { FACT_BY_KEY, factNumber, factText, goal, mortgage, retirement, sampleFacts, SAMPLE_AS_OF } from '@fintwin/engine';
import type { FactKey, Lang } from '@fintwin/engine';
import type { AppState, MeetingBrief, ScenarioSnapshot } from '@fintwin/contracts';
import { atomic, db, getHead, receipt, setFacts, upsertProfile, type Env, type MutationContext } from './db';
import { AppError } from './errors';
import { buildState } from './state';

const cents=(v:number)=>Math.round(v*100)/100;
function input(args:Record<string,unknown>,key:string,fallback:number|null,min:number,max:number,integer=false):number {
  const value=Object.hasOwn(args,key)?args[key]:fallback;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw new AppError('invalid_scenario',422,`A valid ${key} is needed before this scenario can be calculated.`);
  return value;
}
const nullable=(args:Record<string,unknown>,key:string,fallback:number|null)=>Object.hasOwn(args,key)?input(args,key,null,0,1e6):fallback;
export async function readScenario(env:Env,userId:string,id:string):Promise<ScenarioSnapshot> {
  const row=await db(env).prepare('SELECT payload FROM scenario_snapshots WHERE user_id=? AND id=?').bind(userId,id).first<{payload:string}>();
  if(!row)throw new AppError('scenario_not_found',404,'This scenario does not belong to this demo session.');
  const snapshot=JSON.parse(row.payload) as ScenarioSnapshot,head=await getHead(env,userId);
  return {...snapshot,stale:snapshot.revision!==head.revision||snapshot.epoch!==head.epoch};
}

export async function createScenario(env:Env,userId:string,kind:ScenarioSnapshot['kind'],args:Record<string,unknown>,context:MutationContext):Promise<ScenarioSnapshot>{
  const old=await receipt<ScenarioSnapshot>(env,userId,context.id);if(old)return old;
  const state=await buildState(env,userId),n=(k:FactKey)=>factNumber(state.facts,k);
  if(state.revision!==context.expectedRevision||state.epoch!==context.epoch)throw new AppError('state_changed',409,'Your picture changed. Refresh before calculating.');
  const snapshot:ScenarioSnapshot={id:crypto.randomUUID(),kind,revision:state.revision,epoch:state.epoch,createdAt:new Date().toISOString(),asOf:state.sampleVersion?SAMPLE_AS_OF:new Date().toISOString(),engineVersion:'',stale:false,inputs:{},assumptions:[],sources:[],synthetic:Boolean(state.sampleVersion),result:null as never,baseline:null as never,delta:{},previousId:state.scenarios.find(s=>s.kind===kind)?.id};
  const allowed:Record<string,string[]>={mortgage:['principal','rate_pct','months','special_repayment_monthly'],retirement:['age','retirement_age','current_assets','monthly_contribution','pension_monthly','spending_monthly','annual_return_pct','annual_fee_pct','inflation_pct','withdrawal_rate_pct'],goal:['target_amount','start','monthly','annual_return_pct','as_of']};
  if(!allowed[kind])throw new AppError('invalid_scenario_kind');
  if(Object.keys(args).some(k=>!allowed[kind].includes(k)))throw new AppError('invalid_scenario_field',422,'Submit scenario inputs only, never a calculated result.');
  if(kind==='mortgage'){
    const principal=input(args,'principal',n('mortgage_balance'),1,1e9),rate=input(args,'rate_pct',n('mortgage_rate_pct'),0,20),months=input(args,'months',n('mortgage_remaining_months'),1,600,true),extra=input(args,'special_repayment_monthly',0,0,1e6);
    const basePrincipal=input({},'principal',n('mortgage_balance'),1,1e9),baseRate=input({},'rate',n('mortgage_rate_pct'),0,20),baseMonths=input({},'months',n('mortgage_remaining_months'),1,600,true);
    const baseline=mortgage(basePrincipal,baseRate,baseMonths),result=mortgage(principal,rate,months,extra);
    const currentPayment=n('mortgage_payment_monthly')??baseline.payment;
    snapshot.inputs={principal,rate_pct:rate,months,special_repayment_monthly:extra,extra_frequency:'monthly',baseline_payment:currentPayment,baseline_principal:basePrincipal,baseline_rate_pct:baseRate,baseline_months:baseMonths};
    snapshot.baseline=baseline;snapshot.result=result;
    const available=state.picture.metrics.find(m=>m.key==='available_after_saving')?.value;
    const sameRateWithoutExtra=mortgage(principal,rate,months);
    snapshot.delta={payment:cents(result.payment+extra-currentPayment),interest:cents(result.totalInterest-baseline.totalInterest),months:result.payoffMonths-baseline.payoffMonths,extra_interest_saved:cents(sameRateWithoutExtra.totalInterest-result.totalInterest),extra_months_saved:sameRateWithoutExtra.payoffMonths-result.payoffMonths,remaining_after_saving:available==null?null:cents(available-(result.payment+extra-currentPayment))};
    snapshot.assumptions=['monthly_extra_not_contract_permission','spending_includes_housing','no_tax_fees_refinancing_costs','rounded_monthly_interest'];
  }else if(kind==='retirement'){
    const age=input(args,'age',n('age'),16,100,true),retire=input(args,'retirement_age',n('retirement_age'),age,100,true);
    const assets=n('investments_value')!==null&&n('retirement_assets')!==null?n('investments_value')!+n('retirement_assets')!:null;
    const a={currentAssets:input(args,'current_assets',assets,0,2e9),monthlyContribution:input(args,'monthly_contribution',n('monthly_saving'),0,1e6),years:retire-age,annualReturnPct:input(args,'annual_return_pct',5,-50,30),annualFeePct:input(args,'annual_fee_pct',0.5,0,10),inflationPct:input(args,'inflation_pct',2,0,20),withdrawalRatePct:input(args,'withdrawal_rate_pct',4,0.1,20),expectedPensionMonthly:nullable(args,'pension_monthly',n('expected_pension_monthly')),targetSpendingMonthly:nullable(args,'spending_monthly',n('retirement_spending_monthly'))};
    const result=retirement(a),baseline=retirement({...a,currentAssets:assets??a.currentAssets,monthlyContribution:n('monthly_saving')??a.monthlyContribution,years:Math.max(0,(n('retirement_age')??retire)-(n('age')??age)),expectedPensionMonthly:n('expected_pension_monthly'),targetSpendingMonthly:n('retirement_spending_monthly'),annualReturnPct:5,annualFeePct:0.5,inflationPct:2,withdrawalRatePct:4});
    snapshot.inputs={age,retirement_age:retire,current_assets:a.currentAssets,monthly_contribution:a.monthlyContribution,pension_monthly:a.expectedPensionMonthly,spending_monthly:a.targetSpendingMonthly,annual_return_pct:a.annualReturnPct,annual_fee_pct:a.annualFeePct,inflation_pct:a.inflationPct,withdrawal_rate_pct:a.withdrawalRatePct};
    snapshot.baseline=baseline;snapshot.result=result;snapshot.delta={projected_real:cents(result.projectedReal-baseline.projectedReal),sustainable_monthly:cents(result.sustainableMonthlyReal-baseline.sustainableMonthlyReal)};
    snapshot.assumptions=['today_money_pension_and_spending','fixed_nominal_month_end_contributions','nominal_return_less_fees_then_inflation','withdrawal_ratio_not_probability','no_tax_or_pension_indexation'];
    if(Object.hasOwn(args,'current_assets'))snapshot.assumptions.push('explicit_total_capital_override_not_additional_account');
    if(a.expectedPensionMonthly===null)snapshot.assumptions.push('pension_unknown_no_readiness');
    else if(a.expectedPensionMonthly===0 && n('expected_pension_monthly')===null)snapshot.assumptions.push('explicit_zero_pension_scenario_not_fact');
  }else{
    const initial=n('cash_liquid')!==null&&n('investments_value')!==null?n('cash_liquid')!+n('investments_value')!:null;
    const target=input(args,'target_amount',n('goal_target_amount'),1,1e10),start=input(args,'start',initial,0,2e9),monthly=input(args,'monthly',n('monthly_saving'),0,1e6),rate=input(args,'annual_return_pct',4,-50,30);
    const asOf=Object.hasOwn(args,'as_of')?args.as_of:snapshot.asOf;
    if(typeof asOf!=='string'||!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(asOf)||!Number.isFinite(Date.parse(asOf)))throw new AppError('invalid_as_of');
    snapshot.asOf=new Date(asOf).toISOString();
    snapshot.inputs={target_amount:target,start,monthly,annual_return_pct:rate,as_of:snapshot.asOf};
    const result=goal(target,start,monthly,rate,new Date(snapshot.asOf)),baseline=goal(target,initial??start,n('monthly_saving')??monthly,4,new Date(snapshot.asOf));
    snapshot.result=result;snapshot.baseline=baseline;snapshot.delta={months:result.months!==null&&baseline.months!==null?result.months-baseline.months:null};
    snapshot.assumptions=['cash_plus_investments_not_total_net_worth','nominal_monthly_compounding_end_contributions','no_tax_fees_or_inflation'];
  }
  snapshot.engineVersion=snapshot.result.engineVersion;
  snapshot.sources=Object.values(state.facts).map(f=>`fact:${f!.key}:revision:${f!.provenance?.revision??0}`);
  await atomic(env,userId,context,snapshot,[db(env).prepare('INSERT INTO scenario_snapshots(id,user_id,revision,epoch,payload,created_at) VALUES (?,?,?,?,?,?)').bind(snapshot.id,userId,snapshot.revision,snapshot.epoch,JSON.stringify(snapshot),snapshot.createdAt)],false);
  return snapshot;
}

/** Replaces ONLY this user's synthetic household after explicit UI confirmation.
 * User-reported households require a new session; never silently overwrite them. */
export async function loadSample(env:Env,userId:string,confirmed:boolean,context:MutationContext):Promise<AppState>{
  const state=await buildState(env,userId);
  if(Object.keys(state.facts).length && !confirmed)throw new AppError('sample_confirmation',409,'Loading the sample replaces this household. Confirm in the app first.');
  if(!state.sampleVersion && Object.values(state.facts).some(f=>f?.source!=='sample') && Object.keys(state.facts).length)throw new AppError('new_session_required',409,'Your own figures are preserved. Open the sample in a new demo session.');
  await env.REALTIME?.stop(userId);
  const deletes=['user_facts','fact_provenance','conversation_turns','user_memories','user_next_steps'].map(t=>db(env).prepare(`DELETE FROM ${t} WHERE user_id=?`).bind(userId));
  const now=new Date().toISOString();
  const facts=Object.values(sampleFacts()).flatMap(f=>[
    db(env).prepare("INSERT INTO user_facts(user_id,key,value_json,source,note,updated_at) VALUES (?,?,?,'sample',?,?)").bind(userId,f!.key,JSON.stringify(f!.value),'Frozen synthetic household',SAMPLE_AS_OF),
    db(env).prepare('INSERT INTO fact_provenance(user_id,key,json) VALUES (?,?,?)').bind(userId,f!.key,JSON.stringify({revision:context.expectedRevision+1,sourceTurnId:context.id,currency:'EUR',evidence:'Versioned synthetic fixture, not externally verified'})),
  ]);
  const profile=db(env).prepare("INSERT INTO user_profiles(user_id,name,net_worth_eur,expectations,preferred_language,onboarding_done,voice_autoplay,sample_loaded,created_at,updated_at) VALUES (?,'',0,'',?,1,0,1,?,?) ON CONFLICT(user_id) DO UPDATE SET expectations='',sample_loaded=1,onboarding_done=1,updated_at=excluded.updated_at").bind(userId,state.profile?.language??'de',now,now);
  await atomic(env,userId,context,{loaded:true},[...deletes,...facts,profile,db(env).prepare("UPDATE household_heads SET epoch=epoch+1,active_turn='' WHERE user_id=?").bind(userId)]);
  return buildState(env,userId);
}

export async function assembleBrief(env:Env,userId:string,lang:Lang,scenarioId?:string):Promise<MeetingBrief>{
  const state=await buildState(env,userId),de=lang==='de';
  const fmt=(value:number)=>new Intl.NumberFormat(de?'de-DE':'en-GB',{maximumFractionDigits:2}).format(value);
  const selected=scenarioId?await readScenario(env,userId,scenarioId):null;
  const keys:FactKey[]=['age','income_net_monthly','expenses_monthly','monthly_saving','cash_liquid','investments_value','property_value','mortgage_balance','retirement_age','expected_pension_monthly'];
  const fields=keys.filter(k=>state.facts[k]).map(k=>{const f=state.facts[k]!,def=FACT_BY_KEY[k];return{label:def.label[lang],value:typeof f.value==='number'?`${fmt(f.value)}${def.type==='money'?' EUR':''}`:f.value,source:`fact:${k}:revision:${f.provenance?.revision??0}`,meaning:f.source==='sample'?(de?'Synthetisches Beispiel':'Synthetic sample'):(de?'Ihre Angabe, nicht extern geprüft':'User-reported, not externally verified')};});
  const scenarioFields:MeetingBrief['scenarioFields']=[];
  if(selected){
    const assumptionKeys=selected.kind==='mortgage'?['principal','rate_pct','months']:selected.kind==='retirement'?['annual_return_pct','annual_fee_pct','inflation_pct','withdrawal_rate_pct','pension_monthly']:['start','annual_return_pct'];
    for(const key of assumptionKeys){const value=selected.inputs[key];scenarioFields.push({label:key,value:typeof value==='number'?`${fmt(value)}${key.endsWith('_pct')?' %':key==='months'?(de?' Monate':' months'):' EUR'}`:value===null?(de?'Unbekannt':'Unknown'):String(value),source:`scenario:${selected.id}:inputs.${key}`,meaning:de?'Explizite Modellannahme':'Explicit model input'});}
    const properties=selected.kind==='mortgage'?['payment','specialRepayment','totalInterest','payoffMonths']:selected.kind==='retirement'?['projectedReal','requiredCapital','sustainableMonthlyReal']:['target','monthly','reachedYearMonth'];
    for(const key of properties){const value=(selected.result as unknown as Record<string,unknown>)[key];scenarioFields.push({label:key,value:typeof value==='number'?fmt(value):value===null?(de?'Nicht berechenbar':'Not calculable'):String(value),source:`scenario:${selected.id}:result.${key}`,meaning:`${selected.engineVersion} · ${de?'Haushaltsversion':'Household revision'} ${selected.revision}`});}
    for(const [key,value]of Object.entries(selected.delta).filter(([key])=>['payment','interest','months','remaining_after_saving','projected_real','sustainable_monthly'].includes(key)))scenarioFields.push({label:key==='remaining_after_saving'?key:`Δ ${key}`,value:value===null?'—':`${fmt(value)}${key==='months'?'':' EUR'}`,source:`scenario:${selected.id}:delta.${key}`,meaning:key==='remaining_after_saving'?(de?'Restbudget nach unveränderter Sparrate':'Remaining budget after unchanged committed saving'):(de?'Änderung gegenüber Ausgangslage':'Change from baseline')});
  }
  return{id:crypto.randomUUID(),revision:state.revision,epoch:state.epoch,createdAt:new Date().toISOString(),language:lang,title:de?'Ihr Überblick für das Beratungsgespräch':'Your adviser meeting brief',objective:factText(state.facts,'goal_primary')??(de?'Ziel noch offen':'Objective not yet provided'),synthetic:Boolean(state.sampleVersion),fields,scenario:selected,scenarioFields,assumptions:selected?.assumptions??[],unknowns:state.picture.openQuestions.slice(0,5).map(q=>q.label[lang]),questions:state.picture.openQuestions.slice(0,3).map(q=>q.question[lang]),nextSteps:state.nextSteps.filter(s=>!s.done).map(s=>s.text),documents:de?['Aktuelle Vermögensübersicht, soweit vorhanden',...(state.facts.mortgage_balance?['Darlehensvertrag / aktueller Tilgungsplan']:[]),...(state.facts.retirement_age?['Aktuelle Renteninformation']:[])]:['Current asset summary, if available',...(state.facts.mortgage_balance?['Mortgage statement / repayment schedule']:[]),...(state.facts.retirement_age?['Latest pension estimate']:[])]};
}
