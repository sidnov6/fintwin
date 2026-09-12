import {beforeEach,describe,expect,it} from 'vitest';
import {parseTurn} from '../src/intake';
import {normalizeSpokenNumbers} from '../src/spoken-numbers';
import {client,testEnv} from './harness';
const values=(text:string,pending?:Parameters<typeof parseTurn>[3])=>Object.fromEntries(parseTurn(text,'en','test-turn',pending).proposals.filter(p=>p.value!==undefined).map(p=>[p.key,p.value]));
describe('Natural language captures',()=>{
  it('understands spoken amounts, curly apostrophes, and conversational synonyms',()=>{
    expect(values('I’m thirty two. I bring home five thousand a month and spend three thousand a month.')).toMatchObject({age:32,income_net_monthly:5000,expenses_monthly:3000});
    expect(values('I have twenty grand in cash and forty thousand invested.')).toMatchObject({cash_liquid:20000,investments_value:40000});
    expect(normalizeSpokenNumbers('seven thousand two hundred and forty')).toBe('7240');
    expect(normalizeSpokenNumbers('five thousand and three thousand')).toBe('5000 and 3000');
    expect(normalizeSpokenNumbers('thirty two and forty')).toBe('32 and 40');
    expect(normalizeSpokenNumbers('five thousand and three hundred')).toBe('5300');
  });
  it('captures labeled lists and corrects without forgetting other fields',()=>{
    expect(values('I earn 5k net a month, spend 3k a month, have 20k in cash, 40k invested, no debt.')).toMatchObject({income_net_monthly:5000,expenses_monthly:3000,cash_liquid:20000,investments_value:40000,other_debt:0});
    expect(values('Actually my spending is 2800, not 3000.')).toMatchObject({expenses_monthly:2800});
  });
  it('does not mistake mortgage rate and remaining term for a second principal amount',()=>{
    expect(values('My mortgage is 240k at 2.15% with 20 years left.')).toMatchObject({mortgage_balance:240000,mortgage_rate_pct:2.15,mortgage_remaining_months:240});
  });
  it('does not save chart queries, currency guesses or hypothetical facts',()=>{
    expect(values('Show my spending trends for August 2026')).toEqual({});
    expect(parseTurn('What if I earn five thousand net monthly?','en','test').proposals.every(p=>p.operation==='hypothetical')).toBe(true);
    expect(parseTurn('I earn five thousand dollars net monthly','en','test').proposals[0].currency).toBe('USD');
  });
});
describe('Three-reply introduction and durable context',()=>{
  let app:ReturnType<typeof client>;
  beforeEach(async()=>{const {env}=testEnv({FINTWIN_DEMO_PASSPHRASE:'synthetic-test-passphrase'});app=client(env);await app.login();await app.json('/v1/messages?language=en');});
  it('finishes in three natural replies; a correction changes only its field',async()=>{
    const first=await app.say('I’m Sid, I am thirty two and I want to retire at forty.');
    expect(first.message?.meta?.pendingFacts).toEqual(['income_net_monthly','expenses_monthly']);
    const second=await app.say('I take home five thousand a month and spend three thousand.');
    expect(second.message?.meta?.pendingFacts).toEqual(['cash_liquid','investments_value','other_debt']);
    const third=await app.say('Twenty thousand in cash, forty thousand invested, no debt.');
    expect(third.message?.meta?.onboarding).toBe(false);
    const s=await app.state();expect(s.profile).toMatchObject({name:'Sid',onboardingDone:true});
    expect(s.facts.income_net_monthly?.value).toBe(5000);expect(s.facts.retirement_age?.value).toBe(40);
    expect(s.facts.goal_primary?.value).toContain('retire');expect(s.facts.age?.value).toBe(32);
    await app.say('Actually spending is 2800, not 3000.');const updated=await app.state();
    expect(updated.facts.expenses_monthly?.value).toBe(2800);expect(updated.facts.income_net_monthly?.value).toBe(5000);expect(updated.profile?.name).toBe('Sid');
  });
  it('accepts an ordered unlabeled pair only in response to that group',async()=>{
    await app.say('I am 32 and want to retire at 40.');
    await app.say('five thousand and three thousand');
    const s=await app.state();expect(s.facts.income_net_monthly?.value).toBe(5000);expect(s.facts.expenses_monthly?.value).toBe(3000);
    await app.say('20000, 40000, 0');expect((await app.state()).profile?.onboardingDone).toBe(true);
  });
  it('keeps the asked goal rather than restarting for a name',async()=>{
    await app.say('How to retire at 40?');await app.say('sid');const s=await app.state();
    expect(s.profile?.name).toBe('Sid');expect(s.facts.retirement_age?.value).toBe(40);expect(s.facts.goal_primary?.value).toContain('retire');
  });
  it('skips grouped questions without inserting zero facts',async()=>{
    await app.say('skip');await app.say('skip');await app.say('skip');
    const s=await app.state();expect(s.profile?.onboardingDone).toBe(true);expect(s.facts).toEqual({});
  });
  it('keeps a voluntarily given name when the demo is loaded',async()=>{
    await app.say('Call me Sid');await app.mutate('/v1/sample',{});
    expect((await app.state()).profile).toMatchObject({name:'Sid',sampleLoaded:true});
    const answer=await app.say('Show my spending trends');expect(answer.message?.text).not.toMatch(/your name|call you/i);
  });
});
