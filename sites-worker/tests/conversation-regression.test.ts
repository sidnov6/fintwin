import {beforeEach,describe,expect,it} from 'vitest';
import {testEnv} from './harness';
import {applicationBridge as bridge} from '../src/realtime-bridge';
import {buildState} from '../src/state';
import {parseTurn} from '../src/intake';
import {askedFact} from '../src/dialogue';
import {TOOL_DEFS} from '../src/tools';
import {upsertProfile} from '../src/db';

let env:ReturnType<typeof testEnv>['env'];
const user='synthetic-conversation-regression';
beforeEach(async()=>{env=testEnv().env;await upsertProfile(env,user,{language:'en'});});
async function turn(text:string,reply?:string) {
  const ctx=await bridge.begin(env,user,crypto.randomUUID(),text,new AbortController().signal,()=>{});
  if(reply)await bridge.finish(ctx,reply,'mock-not-paid');
  return ctx;
}
const value=async(key:string)=>(await buildState(env,user)).facts[key as 'age']?.value;

describe('Sid transcript regressions — shared voice/text intake, no provider',()=>{
  it('accepts after taxes in the monthly-income context without another gross/net question',async()=>{
    await turn('Call me Sid.','What is your net monthly household income after taxes?');
    const ctx=await turn('I earn €5,000 after taxes.');
    expect(ctx.intake?.question).toBeUndefined();expect(await value('income_net_monthly')).toBe(5000);
  });
  it('keeps current age and target retirement age separate, including bare answers',async()=>{
    await turn('Ich bin 22 Jahre alt.','What age would you roughly like to retire?');
    await turn('50 years old.');expect(await value('age')).toBe(22);expect(await value('retirement_age')).toBe(50);
  });
  it('captures retirement age and retirement spending in the same sentence',async()=>{
    const ctx=await turn("I want to retire at 50 with €3,500 monthly spending in today's euros.");
    expect(ctx.intake?.question).toBeUndefined();expect(await value('retirement_age')).toBe(50);expect(await value('retirement_spending_monthly')).toBe(3500);
  });
  it('uses only the question, not earlier observations, to resolve spending',()=>{
    expect(askedFact('Your income is €5,000. Roughly how much do you spend per month, including housing?')).toBe('expenses_monthly');
    expect(askedFact('How much would you want to spend per month in retirement, in today’s euros?')).toBe('retirement_spending_monthly');
  });
  it('does not turn a bare amount into a goal',()=>{
    expect(parseTurn('€5,000.','en','test','goal_primary').proposals).toEqual([]);
  });
  it('adds the two distinct liquid accounts once',async()=>{
    await turn('I have one savings account that my mom gave me that has €25,000. Apart from that, in my current account, I have around €10,000. And yeah, I think that is all. The rest are my portfolio and savings.');
    expect(await value('cash_liquid')).toBe(35000);
  });
  it('accepts ordinary confirmation of one precise immediately preceding cash proposal',async()=>{
    await turn('My cash is €25,000.','Should I use €35,000 as your total easy-access cash?');
    await turn('Yeah, you can do that.');expect(await value('cash_liquid')).toBe(35000);
  });
  it('does not apply an old offer after an unrelated question',async()=>{
    await turn('Cash is €25,000.','Should I use €35,000 as liquid cash?');
    await turn('Wait, let us talk about retirement.','Would you like to discuss retirement?');
    await turn('Yeah, you can.');expect(await value('cash_liquid')).toBe(25000);
  });
  it('preserves German grouping punctuation in questions and confirmations',async()=>{
    await upsertProfile(env,user,{language:'de'});
    await turn('Ich habe 25.000 Euro auf dem Sparkonto und 10.000 Euro auf dem Girokonto.','Soll ich 35.000 € als Ihr verfügbares Guthaben festhalten?');
    await turn('Ja, das passt.');expect(await value('cash_liquid')).toBe(35000);
  });
  it('ignores historic gifts, takes the current portfolio and records no monthly investing',async()=>{
    await turn('Call me Sid.','What do you deliberately save or invest each month?');
    const ctx=await turn("Nothing, man. My dad gave me €70,000, which I invested in my portfolio, and I've grown that only to €200,000 by now. It's been five years. But apart from that, the rest of the money just lies in my bank, and my current portfolio is €100,000, and I have €35,000 in my savings and current account.");
    expect(await value('monthly_saving')).toBe(0);expect(await value('investments_value')).toBe(100000);expect(await value('cash_liquid')).toBe(35000);
    expect(ctx.intake?.stored.filter(f=>f.key==='investments_value')).toEqual([{key:'investments_value',value:100000}]);
  });
  it('does not confuse monthly contributions with the portfolio balance',async()=>{
    await turn('My portfolio is €100,000. I invest €200 every month.');
    expect(await value('investments_value')).toBe(100000);expect(await value('monthly_saving')).toBe(200);
  });
  it('records debt-free, single household, no property and no cover without magic phrases',async()=>{
    await turn("No, I don't have any debt as yet. I'm debt-free.",'Are you planning just for yourself, or as part of a household with a partner/family?');
    await turn("Just for myself, don't plan to get married anytime soon.",'Do you own any property?');
    await turn("No, I don't own any property as of now.",'Do you have any cover if you could not work, like disability or income protection?');
    await turn('No, nothing of that sort.');
    expect(await value('other_debt')).toBe(0);expect(await value('household')).toBe('single');expect(await value('property_value')).toBe(0);expect(await value('income_protection')).toBe('no');
  });
  it('does not rename the person when they say they are debt-free',async()=>{
    await turn('Call me Sid.');await turn("I'm debt-free.");
    expect((await buildState(env,user)).profile?.name).toBe('Sid');
  });
  it('an approved total is a scenario override, never an added retirement account',async()=>{
    await turn('I am 22 years old. My portfolio is €100,000 and my cash is €35,000. I want to retire at 50.','Should I use €135,000 as your current retirement assets for this illustration?');
    const ctx=await turn('yeah u can');
    expect(ctx.intake?.scenarioInputs).toEqual({current_assets:135000});
    const result=await bridge.tool(ctx,'create_scenario',{kind:'retirement',inputs:{pension_monthly:0,monthly_contribution:0,spending_monthly:3500}},'scenario-test');
    expect(result.error).toBeUndefined();expect(result.inputs).toMatchObject({age:22,retirement_age:50,current_assets:135000,pension_monthly:0});
    expect(await value('retirement_assets')).toBeUndefined();expect(await value('expected_pension_monthly')).toBeUndefined();
    expect(await value('investments_value')).toBe(100000);
  });
  it('explicit total phrasing also does not create an extra account',async()=>{
    const ctx=await turn('My current retirement assets are €135,000.');
    expect(ctx.intake?.scenarioInputs).toEqual({current_assets:135000});expect(await value('retirement_assets')).toBeUndefined();
  });
  it('an instruction not to create an account does not assert that an account balance is zero',async()=>{
    await turn('Do not create an extra retirement account.');
    expect(await value('retirement_assets')).toBeUndefined();
  });
  it('binds tool proposals to the server turn without requiring the model to echo its ID',async()=>{
    const ctx=await turn('There are two children in my household.');
    const proposal={operation:'set',key:'dependents',value:2,currency:'EUR',period:'once',basis:'unknown',scope:'household',evidence:'There are two children in my household.'};
    const result=await bridge.tool(ctx,'propose_facts',{proposals:[proposal]},'facts-test');
    expect(result.error).toBeUndefined();expect(await value('dependents')).toBe(2);
  });
  it('still rejects fabricated evidence and superseded tools',async()=>{
    const ctx=await turn('There are two children in my household.');
    expect((await bridge.tool(ctx,'propose_facts',{proposals:[{key:'cash_liquid',value:99999,evidence:'I have 99999 euros'}]},'bad-evidence')).error).toBeTruthy();
    await turn('New turn');expect((await bridge.tool(ctx,'propose_facts',{proposals:[]},'stale')).error).toBeTruthy();
  });
  it('exposes the total-capital override in the model tool schema',()=>{
    const schema=TOOL_DEFS.find(t=>t.function.name==='create_scenario')!.function.parameters as unknown as {properties:{inputs:{properties:Record<string,unknown>}}};
    expect(schema.properties.inputs.properties).toHaveProperty('current_assets');
  });
});
