/** One semantic intake adapter shared by text and voice tool proposals. */
import { FACT_BY_KEY, isFactKey, normalizeFactValue, parseAmount } from '@fintwin/engine';
import type { FactKey, Lang } from '@fintwin/engine';
import type { FactProposal, Message } from '@fintwin/contracts';
import { atomic, db, deleteFacts, getHead, receipt, setFacts, upsertProfile } from './db';
import type { ToolContext } from './tools';
import { AppError } from './errors';
import { dialogueContext, isAffirmative, lastQuestion } from './dialogue';
import { normalizeSpokenNumbers } from './spoken-numbers';

const number = '-?\\d[\\d.,]*(?:\\s*(?:k|tsd|tausend|thousand|mio|millionen?)\\b)?';
const unknown = /\b(?:don't know|do not know|not sure|weiß.*nicht|weiss.*nicht|keine ahnung|unknown)\b/i;
const hypothetical = /\b(?:what if|if i|suppose|imagine|hypothetical|illustration|illustrative|scenario|assuming|was wäre|was waere|wenn ich|angenommen|szenario)\b/i;
const thirdParty = /\b(?:my friend|his salary|her salary|mein freund|meine freundin|kollege)\b/i;
const partner = /\b(?:my partner|my wife|my husband|mein partner|meine partnerin|meine frau|mein mann)\b/i;
const question = /^(?:what|how|when|why|can|could|would|show|tell|compare|was|wie|wann|warum|kann|könn|koenn|zeig|vergleiche)/i;
const instructionOnly = /^(?:please\b|do not (?:create|add|set|change|record)|don't (?:create|add|set|change|record)|bitte\b)/i;
export interface IntakeResult { stored: Array<{key:FactKey;value:number|string}>; removed:FactKey[]; name:string|null; skipped:FactKey[]; clarification?:FactProposal; question?:string; scenarioInputs?: Record<string,number> }

function incomeMeaning(evidence:string, pending?:FactKey) {
  return {
    basis: /\b(?:net|netto|take.home|bring home|after tax(?:es)?)\b/i.test(evidence) ? 'net' : /\b(?:gross|brutto)\b/i.test(evidence) ? 'gross' : pending==='income_net_monthly' ? 'net' : 'unknown',
    period:/\b(?:year|annually|annual|jahr|jährlich|jaehrlich|p.a.)\b/i.test(evidence) ? 'year' : /\b(?:month|monthly|monat|monatlich)\b/i.test(evidence) ? 'month' : pending==='income_net_monthly' ? 'month' : 'unknown',
  } as const;
}
export function parseTurn(text:string,lang:Lang,turnId:string,pending?:FactKey,clarification?:FactProposal): {name:string|null;proposals:FactProposal[]} {
  text=normalizeSpokenNumbers(text);
  const proposals:FactProposal[]=[];
  const explicitName=text.match(/(?:my name is|call me|i'm|i am|ich bin|ich heiße|ich heisse|mein name ist|nennen sie mich)\s+([\p{L}][\p{L}'-]*(?:\s+(?!(?:and|und|with|mit|and|i)\b)[\p{L}][\p{L}'-]*)?)(?=[,.!]|\s+(?:and|und|i\b)|$)/iu)?.[1];
  const name=explicitName && !/^(?:debt.free|single|alone|fine|well|good|okay|ok|sorry|not|unsure|happy|tired|retired)\b/i.test(explicitName) ? explicitName.replace(/\s+(?:i|ich)$/i,'') : null;
  function add(key:FactKey,value:number|string|undefined,evidence:string,operation:FactProposal['operation']='set') {
    const p:FactProposal={key,value,evidence:evidence.slice(0,240),sourceTurnId:turnId,operation,currency:/\b(?:usd|dollars?)\b|\$/i.test(evidence)?'USD':/\b(?:gbp|pounds?)\b|£/i.test(evidence)?'GBP':'EUR',period:'once',scope:/\b(?:household|combined|together|haushalt|zusammen|gemeinsam)\b/i.test(evidence)?'household':'personal'};
    if(key==='income_net_monthly')Object.assign(p,incomeMeaning(evidence,pending),{scope:partner.test(evidence)?'partner':p.scope});
    else if(['expenses_monthly','monthly_saving','expected_pension_monthly','retirement_spending_monthly','mortgage_payment_monthly'].includes(key))p.period=/\b(?:year|jahr|annual|jährlich)\b/i.test(evidence)?'year':'month';
    if(hypothetical.test(evidence))p.operation='hypothetical';
    if(thirdParty.test(evidence))p.scope='third_party';
    proposals.push(p);
  }
  const remove=text.match(/\b(?:forget|remove|delete|vergiss|vergessen|löschen|loeschen)\b.*\b(?:salary|income|gehalt|einkommen)\b/i);
  if(remove)add('income_net_monthly',undefined,remove[0],'remove');
  if(clarification && /\b(?:net|netto|gross|brutto|monthly|monatlich|annually|jährlich|household|haushalt)\b/i.test(text) && !/\d/.test(text)) {
    const evidence=`${clarification.evidence}; ${text}`;
    const p={...clarification,sourceTurnId:turnId,evidence,uncertain:false};
    if(/\b(?:net|netto)\b/i.test(text))p.basis='net';
    if(/\b(?:gross|brutto)\b/i.test(text))p.basis='gross';
    if(/\b(?:monthly|monatlich)\b/i.test(text))p.period='month';
    if(/\b(?:household|haushalt)\b/i.test(text))p.scope='household';
    proposals.push(p);
  }
  // Split at semantic clauses, never at decimal/grouping punctuation.
  const sentences=text.split(/[;!?]|(?<!\d)\.\s+|(?<=\d)\.(?=\s+[A-ZI])/u);
  const clauses=sentences.flatMap(sentence=>{
    const parts=sentence.replace(/((?:current|checking|savings) account|girokonto),\s+(?=I have|ich habe)/gi,'$1 ').split(/\s+(?:and|und|but|aber)\s+|,\s+(?=(?:earn|spend|have|my |I |expenses|income|cash|investments|no debt|verdiene|gebe|ich |\d+\s*(?:k|euros?|€)?\s+(?:in savings|invested|in cash|in investments|net|take.home|spending|expenses|Schulden|netto)))/iu);
    // An omitted subject inherits the sentence's scope. A friend's spending
    // and the second half of a what-if must not become household facts.
    return parts.map((part,index)=>hypothetical.test(sentence)?`Hypothetical: ${part}`:index>0&&thirdParty.test(parts[0])&&!/^(?:I |my |ich |mein )/i.test(part)?`My friend: ${part}`:index>0&&partner.test(parts[0])&&!/^(?:I |my |ich |mein )/i.test(part)?`My partner: ${part}`:part);
  });
  for(const original of clauses){
    if(remove && original.includes(remove[0]))continue;
    let clause=original.trim();
    if(!clause)continue;
    if(instructionOnly.test(clause))continue;
    // Negated alternatives are not the corrected value. A final explicit
    // self-correction supersedes earlier numbers within this clause.
    clause=clause.replace(/,?\s+(?:not|nicht)\s+-?\d[\d.,]*/gi,'');
    const sorry=clause.search(/\b(?:sorry|rather|i mean|entschuldigung|ich meine|korrektur)\b/i);
    if(sorry>=0){const tail=clause.slice(sorry);clause=clause.slice(0,sorry).replace(new RegExp(number,'g'),'')+tail;}
    let nums=[...clause.matchAll(new RegExp(number,'g'))];
    const age=clause.match(/\b(?:i am|i'm|im|ich bin)\s+(\d{2})\b|\b(\d{2})\s*(?:years old|jahre alt)\b|^\s*(\d{2})\s*$/i);
    if(age && (!age[3]||pending==='age'||pending==='retirement_age') && !hypothetical.test(clause) && !/retire|retirement|ruhestand|rente/i.test(clause))add(pending==='retirement_age'&&!/\b(?:i am|i'm|ich bin|right now|currently)\b/i.test(clause)?'retirement_age':'age',Number(age[1]??age[2]??age[3]),clause);
    const retirement=clause.match(/\b(?:retire|retiring|retirement|rente|ruhestand)\b[^\d]{0,24}(\d{2})\b/i);
    if(retirement && !question.test(clause) && !hypothetical.test(clause)){add('retirement_age',Number(retirement[1]),clause);if(/\b(?:want|would like|möchte|will|ziel)\b/i.test(clause))add('goal_primary',original.trim(),clause);}
    // An age and a monthly spending target can share one sentence. The age
    // is not a second candidate euro amount.
    if(age||retirement){const ageValue=retirement?.[1]??age?.[1]??age?.[2];let removed=false;nums=nums.filter(n=>{if(!removed&&n[0]===ageValue){removed=true;return false;}return true;});}
    let key:FactKey|undefined;
    if(/mortgage|hypothek|restschuld/i.test(clause)&&!question.test(clause)){
      const rate=clause.match(/(\d+(?:[.,]\d+)?)\s*%/);
      const term=clause.match(/(\d+)\s*(years?|jahre?|months?|monate?)\s*(?:left|remaining|rest|übrig|laufzeit)|(?:remaining|restlaufzeit)\s*(\d+)\s*(years?|jahre?|months?|monate?)/i);
      if(rate){add('mortgage_rate_pct',Number(rate[1].replace(',','.')),clause);nums=nums.filter(n=>n.index!==rate.index);}
      if(term){const value=Number(term[1]??term[3]),unit=term[2]??term[4];add('mortgage_remaining_months',value*(/year|jahr/i.test(unit)?12:1),clause);let removed=false;nums=nums.filter(n=>{if(!removed&&Number(n[0])===value){removed=true;return false;}return true;});}
    }
    if(/\b(?:pension|renteninformation|erwartete rente)\b/i.test(clause) && !/pension pot|retirement account/i.test(clause))key='expected_pension_monthly';
    else if(/\b(?:spending|expenses|spend|costs|outgoings|ausgaben|gebe .* aus)\b|\b(?:goes|going) out\b/i.test(clause))key=/retir(?:e|ement|ing)|ruhestand|rente/i.test(clause)||pending==='retirement_spending_monthly'?'retirement_spending_monthly':'expenses_monthly';
    else if(/\b(?:income|earn|earns|earned|salary|net|netto|gehalt|einkommen|verdiene|verdient|take.home|bring home|comes in)\b/i.test(clause))key='income_net_monthly';
    else if(/\b(?:save|saving monthly|monthly saving|invest monthly|spare|sparrate)\b/i.test(clause)||/\b(?:invest|investing|put aside|investiere|sparen)\b.*\b(?:month|monthly|monat|monatlich|year|jährlich)\b/i.test(clause))key='monthly_saving';
    else if(/\b(?:cash|savings(?: account)?|current account|checking account|bank|guthaben|tagesgeld|sparkonto|girokonto|erspartes)\b/i.test(clause))key='cash_liquid';
    else if(/\b(?:pension pot|retirement account|altersvorsorge)\b/i.test(clause))key='retirement_assets';
    else if(/\b(?:investments?|invested|portfolio|depot|angelegt)\b/i.test(clause))key='investments_value';
    else if(/\b(?:mortgage|hypothek|restschuld)\b/i.test(clause))key=/\b(?:payment|pay|paying|zahle|rate)\b/i.test(clause)&&/\b(?:monthly|month|monat|monatlich)\b/i.test(clause)?'mortgage_payment_monthly':'mortgage_balance';
    else if(/\b(?:property|house|home|immobilie|haus|wohnung)\b/i.test(clause))key='property_value';
    else if(/\b(?:debt|debt.free|loans?|sonstige schulden|schulden|schuldenfrei)\b/i.test(clause))key='other_debt';
    // Gifts, purchase prices and past valuations are not today's holdings.
    if(key==='investments_value' && /\b(?:gave|gift|grew|grown|used to|years ago|back then|schenkte|damals)\b/i.test(clause) && !/\b(?:current|currently|today|now worth|aktuell|heute)\b/i.test(clause))key=undefined;
    if(key && !question.test(clause) && !unknown.test(clause)){
      const amount=nums.length===1?parseAmount(nums[0][0],lang):null;
      if(amount!==null)add(key,amount,clause,/\b(?:actually|no,|correction|sorry|korrektur|nicht)\b/i.test(original)?'correct':'set');
      else if(!nums.length&&/\b(?:no|none|nothing|don't|do not|debt.free|keine?|nicht|zero|schuldenfrei)\b/i.test(clause))add(key,0,clause);
      else if(nums.length)add(key,undefined,clause,'question');
    }
  }
  if(!hypothetical.test(text) && !thirdParty.test(text)){
    if(!question.test(text.trim()) && !name && !proposals.some(p=>p.key==='goal_primary') && !/\d/.test(text) && /\b(?:retire earlier|build wealth|pay off (?:the|my) house|just an overview|financial independence|früher in rente|vermögen aufbauen|einfach überblick|immobilie abbezahlen)\b/i.test(text))add('goal_primary',text.trim(),text);
    if(pending==='goal_primary' && !proposals.some(p=>p.key==='goal_primary') && !name && !isAffirmative(text) && !question.test(text) && /retir|wealth|house|home|overview|rente|vermögen|immobilie|überblick/i.test(text))add('goal_primary',text.trim(),text);
    const goal=text.match(/^(?:how (?:can i|do i|to)|wie kann ich)\s+(?:retire|in rente gehen).*?(?:at|mit)\s+(\d{2})\b/i);
    if(goal){add('goal_primary',text.trim(),text);add('retirement_age',Number(goal[1]),text);}
    if(pending==='monthly_saving' && /^(?:nothing|none|zero|nichts|gar nichts)\b/i.test(text.trim()))add('monthly_saving',0,text.split(/[,.]/)[0]);
    if((pending==='household'||/planning.*myself|just (?:for )?myself|nur für mich|ich lebe allein/i.test(text)) && /myself|single|alone|allein|nur (?:ich|für mich)/i.test(text))add('household','single',text);
    if((pending==='income_protection'||/income protection|disability cover|berufsunfähigkeits|einkommensabsicherung/i.test(text)) && !unknown.test(text)){
      if(/\b(?:no|nothing|none|don't|do not|keine?|nicht|nein)\b/i.test(text))add('income_protection','no',text);
      else if(/\b(?:yes|have|ja|habe)\b/i.test(text))add('income_protection','yes',text);
    }
  }
  if(!proposals.length && pending && !unknown.test(text) && !question.test(text) && !hypothetical.test(text) && !thirdParty.test(text) && !partner.test(text)){
    const def=FACT_BY_KEY[pending];
    if(def.type==='text' && !name && !isAffirmative(text) && !/^(?:no|nein|skip|later|überspringen|weiter)$/i.test(text.trim()) && /[\p{L}]{3}/u.test(text.replace(/euros?|euro|years? old/gi,'')))add(pending,text.trim(),text);
    else if(def.type!=='text' && def.type!=='choice' && /^(?:about |roughly |ca\.? )?[-€\d]|^(?:none|nothing|no |keine|keinen|nichts)/i.test(text.trim())){
      const value=parseAmount(text,lang);
      if(value!==null)add(pending,value,text);
    }
  }
  // Explicit selected language owns parsing. A borrowed word never changes it.
  // Distinct explicitly named cash accounts are additive; corrections/totals aren't.
  const cash=proposals.filter(p=>p.key==='cash_liquid'&&typeof p.value==='number'&&p.operation==='set');
  if(cash.length===2 && cash.every(p=>p.currency==='EUR'&&p.scope===cash[0].scope) && cash.some(p=>/savings account|sparkonto|tagesgeld/i.test(p.evidence)) && cash.some(p=>/current account|checking account|girokonto/i.test(p.evidence)) && !/\b(?:total|altogether|actually|correction|insgesamt|korrektur)\b/i.test(text)){
    const combined={...cash[0],value:cash.reduce((sum,p)=>sum+Number(p.value),0),evidence:cash.map(p=>p.evidence).join('; ').slice(0,480)};
    return{name,proposals:[...proposals.filter(p=>p.key!=='cash_liquid'),combined]};
  }
  // A final explicit correction wins and appears once in the change card.
  return {name,proposals:proposals.filter((p,i)=>!proposals.slice(i+1).some(next=>next.key===p.key && next.value!==undefined && next.operation!=='hypothetical'))};
}

export function validateProposal(p:FactProposal,turnId:string): {value?:number|string;question?:string;ignored?:boolean} {
  if(!p || !isFactKey(p.key) || p.sourceTurnId!==turnId || typeof p.evidence!=='string' || p.evidence.length>480 || !['set','correct','remove','question','hypothetical'].includes(p.operation)) throw new AppError('invalid_proposal');
  if(p.operation==='hypothetical' || p.scope==='third_party' || hypothetical.test(p.evidence) || thirdParty.test(p.evidence))return{ignored:true};
  if(p.operation==='remove')return{};
  if(p.scope==='partner' || partner.test(p.evidence))return{question:'scope'};
  if(p.uncertain || p.operation==='question' || unknown.test(p.evidence))return{question:'uncertain'};
  if(FACT_BY_KEY[p.key].type==='money' && p.currency!=='EUR')return{question:'currency'};
  if(p.key==='income_net_monthly' && p.basis!=='net')return{question:'basis'};
  if(p.key==='income_net_monthly' && !['month','year'].includes(p.period??''))return{question:'period'};
  const raw=typeof p.value==='number' && p.period==='year' && ['income_net_monthly','expenses_monthly','monthly_saving','expected_pension_monthly','retirement_spending_monthly','mortgage_payment_monthly'].includes(p.key)?p.value/12:p.value;
  const value=normalizeFactValue(p.key,raw);
  return value===null?{question:'invalid'}:{value};
}
export function clarificationText(reason:string,lang:Lang):string {
  const messages:Record<string,[string,string]>={basis:['Ist das Einkommen brutto oder netto? Für Ihr Haushaltsbild brauche ich den Nettobetrag.','Is that gross or net income? I need the after-tax amount for your picture.'],period:['Ist das pro Monat oder pro Jahr?','Is that per month or per year?'],scope:['Ist das bereits im gemeinsamen Nettoeinkommen enthalten oder ein eigener Betrag?','Is that already included in your combined net income, or a separate amount?'],currency:['Für die Euro-Rechnung brauche ich einen Eurobetrag. Welchen möchten Sie verwenden?','For the euro calculation I need a euro amount. Which amount should I use?'],uncertain:['Welchen Wert soll ich festhalten? Sie können die Angabe auch offenlassen.','Which value should I record? You can also leave it unknown.'],invalid:['Diesen Wert kann ich so nicht übernehmen. Welcher Betrag beziehungsweise Zeitraum ist gemeint?','I cannot use that value as stated. What amount or time period did you mean?']};
  return (messages[reason]??messages.uncertain)[lang==='de'?0:1];
}

export async function applyProposals(proposals:FactProposal[],ctx:ToolContext,id:string):Promise<IntakeResult>{
  if(proposals.length>30)throw new AppError('too_many_proposals');
  const result:IntakeResult={stored:[],removed:[],name:null,skipped:[]};
  const inputs=[];
  for(const p of proposals){
    const v=validateProposal(p,ctx.turnId!);
    if(v.ignored)continue;
    if(v.question){result.clarification=p;result.question=clarificationText(v.question,ctx.lang);continue;}
    if(p.operation==='remove'){result.removed.push(p.key);continue;}
    if(v.value!==undefined)inputs.push({key:p.key,value:v.value,provenance:{revision:ctx.state.revision+1,sourceTurnId:ctx.turnId!,currency:p.currency,period:p.period,basis:p.basis,scope:p.scope,originalValue:p.value,evidence:p.evidence.slice(0,240)}});
  }
  const head=await getHead(ctx.env,ctx.userId);
  const mutation={id,expectedRevision:ctx.state.revision,epoch:ctx.state.epoch,turnId:ctx.turnId};
  if(head.active_turn!==ctx.turnId || head.epoch!==ctx.state.epoch)throw new AppError('superseded',409);
  if(inputs.length){const saved=await setFacts(ctx.env,ctx.userId,inputs,'user',mutation,result.removed);result.stored=saved.accepted.map(f=>({key:f.key,value:f.value}));if(result.stored.length)ctx.emitCard({type:'facts',items:result.stored,source:'user'});}
  else if(result.removed.length)await deleteFacts(ctx.env,ctx.userId,result.removed,{...mutation,id:`${id}:remove`});
  return result;
}

export async function intake(text:string,ctx:ToolContext,history:Message[]):Promise<IntakeResult>{
  const cached=await receipt<IntakeResult>(ctx.env,ctx.userId,`intake:${ctx.turnId}`);
  if(cached)return cached;
  const {last,pending}=dialogueContext(history);
  const grouped=last?.meta?.pendingFacts;
  const effectivePending=grouped?.includes('income_net_monthly')?'income_net_monthly':pending;
  const parsed=parseTurn(text,ctx.lang,ctx.turnId!,effectivePending,last?.meta?.clarification);
  // Only map an unlabeled list when it exactly answers an explicitly ordered
  // group; otherwise ask, rather than assigning arbitrary amounts to accounts.
  if(grouped && grouped.length>1 && !parsed.proposals.length){
    const parts=normalizeSpokenNumbers(text).split(/\s*(?:,\s+|;|\/|\band\b|\bund\b)\s*/i);
    if(parts.length===grouped.length && grouped.every(key=>FACT_BY_KEY[key].type==='money')){
      const amounts=parts.map(part=>parseAmount(part,ctx.lang));
      if(amounts.every(value=>value!==null))for(let i=0;i<grouped.length;i++)parsed.proposals.push({key:grouped[i],value:amounts[i]!,operation:'set',currency:/\$|dollars?|USD/i.test(parts[i])?'USD':/£|pounds?|GBP/i.test(parts[i])?'GBP':'EUR',period:grouped[i].endsWith('monthly')?'month':'once',basis:grouped[i]==='income_net_monthly'?'net':undefined,scope:'personal',sourceTurnId:ctx.turnId!,evidence:`${lastQuestion(last?.text??'')} — ${text}`.slice(0,480)});
    }
  }
  const q=lastQuestion(last?.text??'');
  // An ordinary yes can confirm one concrete amount in the immediately preceding
  // question. No older offer, hypothetical baseline mutation, or guessed sum.
  const confirmationAmounts=[...q.matchAll(new RegExp(number,'g'))];
  if(isAffirmative(text.replace(/[, ]+call me\s+.+$/i,'')) && pending && confirmationAmounts.length===1 && /should I (?:use|count|record)|shall I (?:use|record)|soll ich|is (?:that|this)|ist (?:das|dies)/i.test(q) && !hypothetical.test(q)){
    const value=parseAmount(confirmationAmounts[0][0],ctx.lang);
    if(value!==null && FACT_BY_KEY[pending].type==='money')parsed.proposals.push({key:pending,value,operation:'set',currency:/\$|dollars?|USD/i.test(q)?'USD':/£|pounds?|GBP/i.test(q)?'GBP':'EUR',period:'once',...(pending==='income_net_monthly'?incomeMeaning(q):{}),scope:'personal',sourceTurnId:ctx.turnId!,evidence:`${q} — ${text}`.slice(0,480)});
  }
  const result=await applyProposals(parsed.proposals,ctx,`facts:${ctx.turnId}`);
  const scenarioText=isAffirmative(text)?q:text;
  if(/retirement assets|retirement capital|altersvorsorgekapital/i.test(scenarioText)){
    const amounts=[...scenarioText.matchAll(new RegExp(number,'g'))];
    if(amounts.length===1){const value=parseAmount(amounts[0][0],ctx.lang);if(value!==null&&value>=0)result.scenarioInputs={current_assets:value};}
  }
  result.skipped=[...(last?.meta?.skipped??[])];
  if(pending && /^(?:skip|later|später|weiter|überspringen|don't know|i don't know|weiß.*nicht)/i.test(text))result.skipped.push(...(grouped??[pending]));
  let name=parsed.name;
  if(!ctx.state.profile?.name && !ctx.state.profile?.onboardingDone && !name && pending!=='goal_primary' && !parsed.proposals.length && /^[\p{L}][\p{L}'-]{1,24}$/u.test(text.trim()) && !/^(yes|no|nope|yep|sure|thanks|danke|okay|ok|ja|nein|skip|later|hi|hello|hallo|hey|später|weiter|net|gross|netto|brutto|single|alone|retired|unsure)$/i.test(text.trim()))name=text.trim();
  if(name){const current=await getHead(ctx.env,ctx.userId);name=name.charAt(0).toUpperCase()+name.slice(1);await upsertProfile(ctx.env,ctx.userId,{name},{id:`name:${ctx.turnId}`,expectedRevision:current.revision,epoch:ctx.state.epoch,turnId:ctx.turnId});result.name=name;}
  const head=await getHead(ctx.env,ctx.userId);
  await atomic(ctx.env,ctx.userId,{id:`intake:${ctx.turnId}`,expectedRevision:head.revision,epoch:ctx.state.epoch,turnId:ctx.turnId},result,[],false);
  return result;
}
