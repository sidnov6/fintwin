#!/usr/bin/env node
/** Four bounded synthetic text turns. Opt-in only; no microphone or real data. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv.includes('--allow-paid'))throw new Error('Explicit --allow-paid required.');
for(const line of readFileSync(resolve(root,'.env'),'utf8').split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1]in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const base=process.env.FINTWIN_CHECK_URL||'http://127.0.0.1:8798';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw new Error('Local test only.');
let cookie;const report={status:'failed',at:new Date().toISOString(),turns:[]};
const headers=()=>({'content-type':'application/json','x-fintwin-request':'1',origin:new URL(base).origin,...(cookie?{cookie}:{})});
const call=async(path,method='GET',data)=>{const response=await fetch(`${base}${path}`,{method,headers:headers(),...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(55000)});if(!response.ok)throw new Error('local_request_failed');return response;};
try{
  const login=await call('/v1/session','POST',{passphrase:process.env.FINTWIN_DEMO_PASSPHRASE});cookie=login.headers.get('set-cookie')?.split(';')[0];
  await call('/v1/profile','PATCH',{language:'en',voiceAutoplay:false});
  const turns=[
    "Call me Alex. I am 22 years old. Please ask me about my monthly take-home income first.",
    "I earn €5,000 after taxes. I spend €3,000 per month. I have €25,000 in a savings account and €10,000 in my current account. My portfolio is €100,000. I invest €0 every month.",
    "I want to retire at 50 with €3,500 monthly spending in today's euros. I don't know my pension. Please ask whether you may use the full €135,000 as the TOTAL assets for a retirement illustration, assuming zero pension. Do not create an extra retirement account.",
    'Yeah, you can do that.',
  ];
  for(const text of turns){
    const started=performance.now(),raw=await(await call('/v1/chat','POST',{text,language:'en',requestId:crypto.randomUUID()})).text();
    let message;for(const line of raw.split('\n'))if(line.startsWith('data:')){const event=JSON.parse(line.slice(5));if(event.type==='done')message=event.message;}
    report.turns.push({input:text,reply:message?.text,provider:message?.meta?.provider,origin:message?.meta?.origin,durationMs:Math.round(performance.now()-started)});
    if(message?.meta?.origin!=='live'||message?.meta?.provider!=='api.openai.com'||message?.meta?.fallbackFrom)throw new Error('primary_not_live');
    if(/exact (?:turn|phrase|line)|please say:|couldn.t save|gross or net|most useful next fact|observation:/i.test(message.text))throw new Error('conversation_regression');
  }
  const state=(await(await call('/v1/state')).json()).data;
  for(const [key,expected]of Object.entries({age:22,retirement_age:50,income_net_monthly:5000,expenses_monthly:3000,cash_liquid:35000,investments_value:100000,monthly_saving:0}))if(state.facts[key]?.value!==expected)throw new Error(`incorrect_${key}`);
  if(state.facts.retirement_assets||state.facts.expected_pension_monthly){report.unexpectedBaseline={retirement_assets:state.facts.retirement_assets,expected_pension_monthly:state.facts.expected_pension_monthly};throw new Error('scenario_mutated_baseline');}
  const scenario=state.scenarios.find(s=>s.kind==='retirement');
  if(scenario?.inputs.current_assets!==135000||scenario.inputs.pension_monthly!==0)throw new Error('wrong_or_missing_scenario');
  report.scenarioInputs=scenario.inputs;report.status='passed';
}catch(error){report.failure=/^(incorrect_|local_request_failed|primary_not_live|conversation_regression|scenario_mutated_baseline|wrong_or_missing_scenario)/.test(error.message)?error.message:'test_failed';process.exitCode=1;}
finally{if(cookie)await call('/v1/session','DELETE').catch(()=>{});}
writeFileSync(resolve(root,'data/last-conversation-smoke.json'),JSON.stringify(report,null,2)+'\n');console.info(JSON.stringify(report,null,2));
