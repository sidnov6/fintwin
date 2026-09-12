#!/usr/bin/env node
/** Opt-in TEXT smoke only. Never run from verify/build/start. No audio claims. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {primarySmokeFailure} from './smoke-result.mjs';
if(!process.argv.includes('--allow-paid')){console.error('Not run. This command spends provider allowance. Only after owner approval, run: pnpm smoke:live --allow-paid');process.exit(2);}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
try{for(const line of readFileSync(resolve(root,'.env'),'utf8').split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1]in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}}catch{}
const url=process.env.FINTWIN_CHECK_URL||'http://127.0.0.1:8787';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('This test is local-only.');
const report={kind:'text-only',status:'failed',at:new Date().toISOString(),provider:null,model:null,durationMs:null};
const portfolio=process.argv.includes('--portfolio');
let cookie;
try{
  if(!process.env.FINTWIN_DEMO_PASSPHRASE)throw new Error('missing_gate');
  const login=await fetch(`${url}/v1/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({passphrase:process.env.FINTWIN_DEMO_PASSPHRASE}),signal:AbortSignal.timeout(5000)});
  if(!login.ok)throw new Error('gate_failed');cookie=login.headers.get('set-cookie')?.split(';')[0];
  const headers={'content-type':'application/json',cookie};
  const preflight=await(await fetch(`${url}/v1/preflight`,{headers,signal:AbortSignal.timeout(5000)})).json();
  if(!preflight.data?.ai.live)throw new Error('text_not_enabled');
  if(portfolio){
    const state=await(await fetch(`${url}/v1/state`,{headers,signal:AbortSignal.timeout(5000)})).json();
    const sample=await fetch(`${url}/v1/sample`,{method:'POST',headers,body:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:state.data.revision,confirmed:true}),signal:AbortSignal.timeout(5000)});
    if(!sample.ok)throw new Error('sample_failed');
  }
  const started=performance.now();
  const text=portfolio?'Bitte nutzen Sie get_portfolio, um mein Beispieldepot anzuzeigen. Nennen Sie dann die größte Position in höchstens zwei kurzen deutschen Sätzen. Keine Kaufempfehlung, keine Änderungen an meinen Daten.':'My name is Alex. Help me prepare a neutral adviser meeting; ask one short opening question.';
  const response=await fetch(`${url}/v1/chat`,{method:'POST',headers,body:JSON.stringify({text,language:portfolio?'de':'en',requestId:crypto.randomUUID()}),signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error('chat_failed');const raw=await response.text();let message;
  for(const line of raw.split('\n'))if(line.startsWith('data:')){try{const event=JSON.parse(line.slice(5));if(event.type==='done')message=event.message;}catch{}}
  report.provider=message?.meta?.provider??null;report.model=message?.meta?.model??null;
  const failure=primarySmokeFailure(message,preflight.data.ai);if(failure)throw new Error(failure);
  if(portfolio){report.portfolioToolVerified=message.cards?.some(card=>card.type==='portfolio')??false;if(!report.portfolioToolVerified)throw new Error('tool_not_verified');report.language='de';}
  report.status='passed';report.provider=message.meta.provider;report.model=message.meta.model;report.durationMs=Math.round(performance.now()-started);
}catch(error){report.failure=['fallback_not_live','backup_not_primary','empty_reply','missing_gate','gate_failed','text_not_enabled','chat_failed','sample_failed','tool_not_verified'].includes(error.message)?error.message:'test_failed';console.error('Primary live text smoke did not pass. No provider error payload was logged.');process.exitCode=1;}
finally{if(cookie)await fetch(`${url}/v1/session`,{method:'DELETE',headers:{cookie,'x-fintwin-request':'1',origin:new URL(url).origin},signal:AbortSignal.timeout(5000)}).catch(()=>{});}
mkdirSync(resolve(root,'data'),{recursive:true});writeFileSync(resolve(root,'data','last-text-smoke.json'),JSON.stringify(report,null,2)+'\n');console.info(JSON.stringify(report,null,2));
