/** Fictional, versioned feed. Integer cents and stable IDs make every total auditable. */
export const BANK_VERSION = 'demo-ledger-2026-08-v1';
export const BANK_MONTHS = ['2026-03','2026-04','2026-05','2026-06','2026-07','2026-08'];
export const BANK_CATEGORIES = {
  mortgage:['Mortgage','Hypothek'], groceries:['Groceries','Lebensmittel'], dining:['Dining & coffee','Restaurants & Café'],
  transport:['Transport','Mobilität'], shopping:['Shopping','Shopping'], utilities:['Utilities','Energie & Wohnen'],
  insurance:['Insurance','Versicherungen'], family:['Family & education','Familie & Bildung'], health:['Health','Gesundheit'],
  subscriptions:['Subscriptions','Abonnements'], travel:['Travel','Reisen'], home:['Home & maintenance','Haushalt & Reparaturen'],
  income:['Income','Einkommen'], transfer:['Investment transfer','Anlageübertrag'],
} as const;
export type BankCategory = keyof typeof BANK_CATEGORIES;
export interface BankTransaction { id:string; date:string; merchant:string; category:BankCategory; amountCents:number; kind:'income'|'expense'|'transfer'; recurring:boolean; balanceCents:number }
export interface BankMonth { month:string; incomeCents:number; spendingCents:number; transfersCents:number; netCents:number }
export interface BankOverview { version:string; synthetic:true; name:string; account:string; currency:'EUR'; from:string; to:string; openingBalanceCents:number; balanceCents:number; transactionCount:number; months:BankMonth[] }
export interface BankQuery { from?:string; to?:string; category?:BankCategory; merchant?:string; recurring?:boolean }
export interface BankReport { account:BankOverview; query:BankQuery; months:BankMonth[]; transactions:BankTransaction[]; categories:Array<{category:BankCategory;amountCents:number;count:number}>; merchants:Array<{merchant:string;amountCents:number;count:number}>; incomeCents:number; spendingCents:number; transfersCents:number; netCents:number }

function ledger(payment:number):BankTransaction[] {
  const rows:Omit<BankTransaction,'balanceCents'>[]=[];
  const add=(month:string,day:number,merchant:string,category:BankCategory,amountCents:number,recurring=false)=>{rows.push({id:`demo-${month}-${rows.length.toString().padStart(3,'0')}`,date:`${month}-${String(day).padStart(2,'0')}`,merchant,category,amountCents,recurring,kind:category==='income'?'income':category==='transfer'?'transfer':'expense'});};
  BANK_MONTHS.forEach((month,i)=>{
    add(month,1,'Demo employer · net salary','income',724000,true);
    const monthly:Array<[BankCategory,string,number,number]>=[
      ['mortgage','Demo Home Loan',Math.round(payment*100),2],['utilities','Demo Energy & Broadband',39000,4],['insurance','Demo Insurance',25500,5],
      ['family','Demo School & Childcare',125500,6],['health','Demo Pharmacy & Care',16000,12],['subscriptions','Demo Streaming & Fitness',7200,8],
      ['home','Demo Home & Repairs',[39000,42000,36000,51000,45000,68500][i],16],['transport','Demo Mobility',[28000,25500,30500,27500,29500,31000][i],18],
      ['shopping','Demo Department Store',[30000,39000,24000,45000,30000,62000][i],20],['travel','Demo Travel',[32000,16000,44000,68000,124000,0][i],22],
    ];
    for(const [category,merchant,amount,day] of monthly)if(amount)add(month,day,merchant,category,-amount,['mortgage','utilities','insurance','family','subscriptions'].includes(category));
    for(const [category,total,merchants] of [
      ['groceries',[78000,81000,86500,92000,96000,104000][i],['Demo Fresh Market','Demo Supermarket']],
      ['dining',[21000,26000,30500,36000,41000,46500][i],['Demo Corner Café','Demo Kitchen']],
    ] as Array<[BankCategory,number,string[]]>) {
      const weights=[0.23,0.28,0.19];let remaining=total;
      for(let week=0;week<4;week++){const amount=week===3?remaining:Math.round(total*weights[week]);remaining-=amount;add(month,7+week*7,merchants[week%2],category,-amount);}
    }
    add(month,25,'Demo investment account','transfer',-56800,true);
  });
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  let balance=6190000-rows.reduce((sum,row)=>sum+row.amountCents,0);
  return rows.map(row=>({...row,balanceCents:balance+=row.amountCents}));
}
function monthsFor(rows:BankTransaction[],months:string[]):BankMonth[]{return months.map(month=>{const selected=rows.filter(row=>row.date.startsWith(month));const sum=(kind:BankTransaction['kind'])=>selected.filter(row=>row.kind===kind).reduce((total,row)=>total+row.amountCents,0);return{month,incomeCents:sum('income'),spendingCents:-sum('expense'),transfersCents:-sum('transfer'),netCents:selected.reduce((total,row)=>total+row.amountCents,0)};});}
export function bankOverview(payment:number):BankOverview {
  const rows=ledger(payment);
  return{version:BANK_VERSION,synthetic:true,name:'FinTwin Demo Bank',account:'DEMO •• 2048',currency:'EUR',from:'2026-03-01',to:'2026-08-31',openingBalanceCents:rows[0].balanceCents-rows[0].amountCents,balanceCents:rows.at(-1)!.balanceCents,transactionCount:rows.length,months:monthsFor(rows,BANK_MONTHS)};
}
export function bankReport(payment:number,query:BankQuery={}):BankReport {
  const account=bankOverview(payment),from=query.from||account.from,to=query.to||account.to;
  const rows=ledger(payment).filter(row=>row.date>=from&&row.date<=to&&(!query.category||row.category===query.category)&&(!query.merchant||row.merchant.toLowerCase().includes(query.merchant.toLowerCase()))&&(query.recurring===undefined||row.recurring===query.recurring));
  const expenses=rows.filter(row=>row.kind==='expense');
  const group=(key:'category'|'merchant')=>[...new Set(expenses.map(row=>row[key]))].map(value=>{const matches=expenses.filter(row=>row[key]===value);return{value,amountCents:-matches.reduce((sum,row)=>sum+row.amountCents,0),count:matches.length};}).sort((a,b)=>b.amountCents-a.amountCents);
  const months=monthsFor(rows,BANK_MONTHS.filter(month=>`${month}-31`>=from&&`${month}-01`<=to));
  return{account,query:{...query,from,to},months,transactions:[...rows].reverse(),categories:group('category').map(row=>({category:row.value as BankCategory,amountCents:row.amountCents,count:row.count})),merchants:group('merchant').map(row=>({merchant:row.value,amountCents:row.amountCents,count:row.count})),incomeCents:months.reduce((sum,m)=>sum+m.incomeCents,0),spendingCents:months.reduce((sum,m)=>sum+m.spendingCents,0),transfersCents:months.reduce((sum,m)=>sum+m.transfersCents,0),netCents:rows.reduce((sum,row)=>sum+row.amountCents,0)};
}
