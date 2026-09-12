import {beforeEach,describe,expect,it} from 'vitest';
import {bankOverview,bankReport,factNumber,mortgage,sampleFacts} from '@fintwin/engine';
import {bankQueryFromText,readBank} from '../src/bank';
import {client,testEnv} from './harness';
const payment=factNumber(sampleFacts(),'mortgage_payment_monthly')!;
describe('Synthetic bank: exact, reproducible and isolated from planning facts',()=>{
  it('reconciles each transaction, opening/closing cash and every monthly total in cents',()=>{
    const report=bankReport(payment),rows=[...report.transactions].reverse();
    expect(report).toEqual(bankReport(payment));expect(new Set(rows.map(r=>r.id)).size).toBe(rows.length);
    let balance=report.account.openingBalanceCents;
    for(const row of rows){expect(Number.isInteger(row.amountCents)).toBe(true);balance+=row.amountCents;expect(row.balanceCents).toBe(balance);}
    expect(balance).toBe(6190000);expect(balance).toBe(report.account.balanceCents);
    expect(report.incomeCents-report.spendingCents-report.transfersCents).toBe(report.netCents);
    expect(report.categories.reduce((sum,c)=>sum+c.amountCents,0)).toBe(report.spendingCents);
    expect(report.merchants.reduce((sum,c)=>sum+c.amountCents,0)).toBe(report.spendingCents);
    expect(report.months.at(-1)?.spendingCents).toBe(Math.round(factNumber(sampleFacts(),'expenses_monthly')!*100));
    expect(report.transfersCents).toBe(56800*6);
  });
  it('sums the exact filtered rows and does not count transfers as spending',()=>{
    const groceries=bankReport(payment,{category:'groceries',from:'2026-08-01',to:'2026-08-31'});
    expect(groceries.spendingCents).toBe(104000);expect(groceries.transactions).toHaveLength(4);expect(groceries.categories).toHaveLength(1);
    expect(bankReport(payment,{category:'transfer'}).spendingCents).toBe(0);
    expect(bankReport(payment,{category:'transfer'}).transfersCents).toBe(340800);
    expect(bankReport(payment,{merchant:'Corner Café'}).transactions.every(r=>r.merchant.includes('Corner Café'))).toBe(true);
    expect(bankReport(payment,{recurring:true}).transactions.every(r=>r.recurring)).toBe(true);
  });
  it('has no invented activity outside the fixed coverage',()=>{
    expect(bankReport(payment,{from:'2026-09-01',to:'2026-09-30'}).transactions).toHaveLength(0);
    expect(bankOverview(payment).from).toBe('2026-03-01');
  });
  it('understands date/category filters in English and German',()=>{
    expect(bankQueryFromText('Show grocery spending from March to August 2026')).toMatchObject({category:'groceries',from:'2026-03-01',to:'2026-08-31'});
    expect(bankQueryFromText('Zeig Lebensmittel im Juni')).toMatchObject({category:'groceries',from:'2026-06-01',to:'2026-06-30'});
    expect(bankQueryFromText('Show spending in 2025')).toMatchObject({from:'2025-01-01',to:'2025-12-31'});
    expect(bankQueryFromText('Show spending in the last three months')).toMatchObject({from:'2026-06-01',to:'2026-08-31'});
    expect(bankQueryFromText('How much did I spend at Demo Corner Café in August?')).toMatchObject({merchant:'Demo Corner Café',from:'2026-08-01'});
  });
  it('mortgage chart points use the same rounded engine as the final totals',()=>{
    const result=mortgage(240000,5,240,300);expect(result.balanceByYear?.[0]).toEqual({month:0,balance:240000});
    expect(result.balanceByYear?.at(-1)).toEqual({month:result.payoffMonths,balance:0});
    expect(result.balanceByYear?.every((p,i,a)=>i===0||p.balance<a[i-1].balance)).toBe(true);
  });
});
describe('Bank API and conversation',()=>{
  let app:ReturnType<typeof client>;
  beforeEach(async()=>{const {env}=testEnv({FINTWIN_DEMO_PASSPHRASE:'synthetic-test-passphrase'});app=client(env);await app.login();});
  it('requires authentication and explicit sample loading',async()=>{
    expect((await app.json('/v1/bank')).status).toBe(409);
    expect((await app.say('Show my spending trends')).message?.text).toContain('No real bank account');
    expect((await app.state()).bank).toBeNull();
  });
  it('emits spending charts, preserves follow-up filters, and stores cards durably',async()=>{
    await app.mutate('/v1/sample',{});
    const state=await app.state();expect(state.bank?.transactionCount).toBeGreaterThan(100);
    const first=await app.say('Show me the trends for my spending');expect(first.message?.cards[0].type).toBe('bank_trends');
    const second=await app.say('What about groceries?');const groceries=second.message?.cards.find(c=>c.type==='bank_trends');
    expect(groceries?.type==='bank_trends'&&groceries.report.query.category).toBe('groceries');
    const third=await app.say('And in August?');const august=third.message?.cards.find(c=>c.type==='bank_trends');
    expect(august?.type==='bank_trends'&&august.report.spendingCents).toBe(104000);
    expect(third.message?.text).toContain('€1,040.00');
    const history=await app.json('/v1/messages?language=en') as {data:{messages:Array<{cards:Array<{type:string}>}>}};
    expect(history.data.messages.at(-1)?.cards.some(c=>c.type==='bank_trends')).toBe(true);
    expect((await app.state()).facts).toEqual(state.facts);
  });
  it('mortgage trends include both historical payments and a projection chart',async()=>{
    await app.mutate('/v1/sample',{});const reply=await app.say('Show my mortgage trends');
    expect(reply.message?.cards.map(c=>c.type)).toEqual(['bank_trends','scenario']);
    const card=reply.message?.cards.find(c=>c.type==='bank_trends');expect(card?.type==='bank_trends'&&card.report.spendingCents).toBe(Math.round(payment*100)*6);
  });
  it('does not rewrite historical transactions after an editable baseline correction',async()=>{
    await app.mutate('/v1/sample',{});const before=await app.json('/v1/bank');
    await app.mutate('/v1/facts',{facts:[{key:'mortgage_payment_monthly',value:2000}]},'PATCH');
    expect(await app.json('/v1/bank')).toEqual(before);
  });
  it('rejects malformed filters and invalid calendar dates',async()=>{
    await app.mutate('/v1/sample',{});
    for(const query of ['from=2026-02-30','from=2026-08-01&to=2026-03-01','category=madeup','recurring=yes'])expect((await app.json(`/v1/bank?${query}`)).status).toBe(422);
    expect(()=>readBank({profile:{sampleLoaded:true}} as never,{from:'bad'})).toThrow();
  });
});
