import type { AppState, FactKey, Lang, Message } from '@fintwin/contracts';
export const INTAKE_GROUPS:FactKey[][]=[['age','goal_primary'],['income_net_monthly','expenses_monthly'],['cash_liquid','investments_value','other_debt']];
const labels:Partial<Record<FactKey,[string,string]>>={age:['your age','Ihr Alter'],goal_primary:['your main goal','Ihr wichtigstes Ziel'],income_net_monthly:['monthly take-home income (after tax, in euros)','Ihr monatliches Nettoeinkommen in Euro'],expenses_monthly:['monthly spending, including housing','Ihre Monatsausgaben inklusive Wohnen'],cash_liquid:['cash savings','Ihr verfügbares Guthaben'],investments_value:['investments','Ihre Anlagen'],other_debt:['non-mortgage debt','Ihre Schulden ohne Hypothek']};
export function onboardingPrompt(state:AppState,lang:Lang,skipped:Iterable<FactKey>=[]):{text:string;meta:NonNullable<Message['meta']>}|null {
  if(state.profile?.onboardingDone)return null;
  const skip=new Set(skipped);
  const keys=INTAKE_GROUPS.map(group=>group.filter(key=>!state.facts[key]&&!skip.has(key))).find(group=>group.length);
  if(!keys)return null;
  const parts=keys.map(key=>labels[key]![lang==='de'?1:0]);
  const list=parts.length<2?parts[0]:parts.slice(0,-1).join(', ')+(lang==='de'?' und ':' and ')+parts.at(-1);
  const de=lang==='de';
  let text=de?`Wie hoch sind die Beträge für ${list}? Grob in Euro reicht; überspringen ist auch okay.`:`Roughly how much do you have in ${list}? Euros are fine; you can skip anything.`;
  if(keys.includes('age')&&keys.includes('goal_primary'))text=de?'Wie alt sind Sie, und was ist Ihr wichtigstes finanzielles Ziel?':'How old are you, and what is your main financial goal?';
  else if(keys[0]==='age')text=de?'Wie alt sind Sie?':'How old are you?';
  else if(keys[0]==='goal_primary')text=de?'Was möchten Sie mit Ihrem Geld erreichen?':'What would you like your money to help you achieve?';
  else if(keys.includes('income_net_monthly')&&keys.includes('expenses_monthly'))text=de?'Was kommt monatlich netto rein und was geben Sie aus, inklusive Wohnen? In Euro; grobe Angaben reichen.':'What do you take home after tax each month, and roughly what do you spend, including housing? In euros; estimates are fine.';
  else if(keys[0]==='income_net_monthly')text=de?'Wie hoch ist Ihr monatliches Nettoeinkommen in Euro?':'What is your monthly take-home income after tax, in euros?';
  else if(keys[0]==='expenses_monthly')text=de?'Und wie viel geben Sie im Monat aus, inklusive Wohnen?':'And roughly what is your monthly spending, including housing?';
  return{text,meta:{pendingFact:keys[0],pendingFacts:keys,onboarding:true}};
}
