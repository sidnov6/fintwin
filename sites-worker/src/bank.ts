import { BANK_CATEGORIES, bankReport, factNumber, sampleFacts, type BankCategory, type BankQuery, type BankReport, type Lang } from '@fintwin/engine';
import type { AppState, Message } from '@fintwin/contracts';
import { AppError } from './errors';

const categories: Array<[BankCategory, RegExp]> = [
  ['groceries', /grocer|supermarket|lebensmittel|supermarkt/i], ['dining', /dining|restaurant|coffee|café|cafe|essen gehen/i],
  ['mortgage', /mortgage|hypothek|darlehen/i], ['transport', /transport|mobility|mobilität|verkehr/i],
  ['subscriptions', /subscription|abonnement|abos?\b/i], ['travel', /travel|holiday|urlaub|reise/i], ['shopping', /shopping|einkäufe/i],
  ['utilities', /utilities|energy|energie|nebenkosten/i], ['insurance', /insurance|versicherung/i], ['family', /childcare|family|familie|bildung/i],
  ['health', /health|pharmacy|gesundheit/i], ['home', /maintenance|repairs|reparatur/i],
];
export function isBankQuestion(text:string):boolean {
  return /\b(?:transactions?|bank account|bank trends|bank feed|kontoumsätze|transaktionen|umsätze|umsatzverlauf)\b/i.test(text)
    || /\b(?:trend\w*|chart\w*|graph\w*|breakdown|categories|kategorien|diagramm\w*|ausgabenverlauf)\b/i.test(text) && /spend|expenses|mortgage|bank|ausgaben|hypothek|grocer|dining|budget/i.test(text)
    || /^(?:how much|what|where|why|show|compare|wie viel|wofür|wofuer|warum|zeig|vergleiche)/i.test(text) && /spend|spent|spending|ausgaben|ausgegeben|grocer|dining|subscriptions|recurring|wiederkehrend/i.test(text);
}
export function bankQueryFromText(text:string,history:Message[]=[]):BankQuery {
  const followup=/^(?:and|what about|how about|only|just|und|nur|wie sieht|was ist mit)\b/i.test(text.trim());
  const previous=followup?[...history].reverse().flatMap(m=>m.cards).find(c=>c.type==='bank_trends'):undefined;
  const query:BankQuery=previous?.type==='bank_trends'?{...previous.report.query}:{};
  const category=categories.find(([,rx])=>rx.test(text));if(category)query.category=category[0];
  if(/all categories|overall|everything|alle kategorien|insgesamt/i.test(text))delete query.category;
  if(/recurring|regular payments|wiederkehrend|regelmäßig/i.test(text))query.recurring=true;
  const names=[/jan(?:uary|uar)?/i,/feb(?:ruary|ruar)?/i,/(?:mar(?:ch)?|märz|maerz)/i,/apr(?:il)?/i,/(?:may|mai)/i,/jun(?:e|i)?/i,/jul(?:y|i)?/i,/aug(?:ust)?/i,/sep(?:tember)?/i,/(?:oct(?:ober)?|okt(?:ober)?)/i,/nov(?:ember)?/i,/(?:dec(?:ember)?|dez(?:ember)?)/i];
  const mentions=[...text.matchAll(/\b(?:jan\w*|feb\w*|march|mar|märz|maerz|apr\w*|may|mai|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|okt\w*|nov\w*|dec\w*|dez\w*)\b/gi)];
  const year=Number(text.match(/\b(20\d{2})\b/)?.[1]??2026);
  const monthRange=(start:number,end:number)=>{query.from=`${year}-${String(start).padStart(2,'0')}-01`;query.to=`${year}-${String(end).padStart(2,'0')}-${new Date(Date.UTC(year,end,0)).getUTCDate()}`;};
  if(mentions.length){const nums=mentions.map(m=>names.findIndex(rx=>rx.test(m[0]))+1);monthRange(Math.min(...nums),Math.max(...nums));}
  else if(/this month|diesen monat|diesem monat/i.test(text))monthRange(9,9);
  else if(/last month|latest month|letzten monat|letzter monat/i.test(text))monthRange(8,8);
  else {const count=text.match(/(?:last|past|letzten)\s+(\d+|three|six|drei|sechs)\s+(?:months|monate)/i)?.[1];if(count){const n=({three:3,six:6,drei:3,sechs:6} as Record<string,number>)[count.toLowerCase()]??Number(count);monthRange(Math.max(1,9-n),8);}else if(/\b20\d{2}\b/.test(text))monthRange(1,12);}
  const iso=[...text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)];if(iso.length){query.from=iso[0][0];query.to=iso[1]?.[0]??iso[0][0];}
  const merchant=text.match(/\b(?:at|bei|merchant)\s+[“"']?((?:Demo )?[\p{L}& ]+?)(?=[”"'?.,]|\s+(?:in|during|last|im|from|between)\b|$)/iu)?.[1];if(merchant)query.merchant=merchant.trim();
  return query;
}
export function readBank(state:AppState,input:Record<string,unknown>={}):BankReport {
  if(!state.profile?.sampleLoaded)throw new AppError('bank_not_connected',409,'Load the synthetic sample household to explore the demo bank. No real bank is connected.');
  const query:BankQuery={};
  for(const key of ['from','to'] as const)if(input[key]!==undefined){const v=input[key];if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new AppError('invalid_bank_date',422);query[key]=v;}
  if(query.from&&query.to&&query.from>query.to)throw new AppError('invalid_bank_range',422);
  if(input.category!==undefined){if(typeof input.category!=='string'||!Object.hasOwn(BANK_CATEGORIES,input.category))throw new AppError('invalid_bank_category',422);query.category=input.category as BankCategory;}
  if(input.merchant!==undefined){if(typeof input.merchant!=='string'||input.merchant.length>80)throw new AppError('invalid_bank_merchant',422);query.merchant=input.merchant;}
  if(input.recurring!==undefined){if(typeof input.recurring!=='boolean')throw new AppError('invalid_bank_filter',422);query.recurring=input.recurring;}
  // The historical feed never changes when a person edits the planning baseline.
  return bankReport(factNumber(sampleFacts(),'mortgage_payment_monthly')!,query);
}
export function bankNarrative(report:BankReport,lang:Lang):string {
  const de=lang==='de',money=(v:number)=>new Intl.NumberFormat(de?'de-DE':'en-GB',{style:'currency',currency:'EUR'}).format(v/100);
  const from=report.query.from!,to=report.query.to!,window=`${from} – ${to}`;
  if(!report.transactions.length)return de?`Keine passenden Buchungen für ${window}. Das synthetische Konto enthält nur März bis August 2026; außerhalb dieses Zeitraums ist der Verlauf unbekannt, nicht null.`:`No matching transactions for ${window}. The synthetic account covers March–August 2026 only; activity outside that period is unknown, not zero.`;
  const name=report.query.category?BANK_CATEGORIES[report.query.category][de?1:0]:(de?'Ausgaben':'Spending');
  const parts=[de?`${name}: ${money(report.spendingCents)} (${window}), aus ${report.transactions.length} passenden Demo-Buchungen.`:`${name}: ${money(report.spendingCents)} (${window}), from ${report.transactions.length} matching demo transactions.`];
  const months=report.months,first=months[0],last=months.at(-1)!;
  if(months.length>1&&first.spendingCents){const delta=last.spendingCents-first.spendingCents;const percent=Math.abs(delta/first.spendingCents*100).toLocaleString(de?'de-DE':'en-GB',{maximumFractionDigits:1});parts.push(de?`Vom ersten zum letzten Monat ${delta>=0?'+':'−'}${money(Math.abs(delta))} (${percent} %).`:`First to last month: ${delta>=0?'+':'−'}${money(Math.abs(delta))} (${percent}%).`);}
  const top=report.categories[0];if(top&&!report.query.category)parts.push(de?`Größter Posten: ${BANK_CATEGORIES[top.category][1]} mit ${money(top.amountCents)}.`:`Largest category: ${BANK_CATEGORIES[top.category][0]}, ${money(top.amountCents)}.`);
  parts.push(de?'Anlageüberträge zählen nicht als Ausgaben. Diagramm und Buchungen zeigen dieselben Daten.':'Investment transfers are excluded from spending. The chart and ledger use the same data.');
  if(from<report.account.from||to>report.account.to)parts.push(de?'Der angefragte Zeitraum ist nur teilweise abgedeckt.':'The requested period is only partially covered.');
  return parts.join(' ');
}
