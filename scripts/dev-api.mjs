#!/usr/bin/env node
/** Single-origin static app + protected API. No browser identity is trusted. */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleWorker } from './bundle-worker.mjs';
import { d1, migrate } from './sqlite.mjs';
import { localOpenEnabled } from './local-access.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  for (const line of readFileSync(join(root,'.env'),'utf8').split('\n')) {
    const match=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]]=match[2].replace(/^["']|["']$/g,'');
  }
} catch { /* optional private configuration */ }
const port=Number(process.env.PORT || 8787);
const localOpen=localOpenEnabled(process.env);
const dbPath=process.env.FINTWIN_DB || join(root,'data','local.sqlite');
if(dbPath!==':memory:') mkdirSync(dirname(dbPath),{recursive:true});
const database=new DatabaseSync(dbPath);
database.exec('PRAGMA journal_mode=WAL');
migrate(database,root,dbPath);
const outDir=join(root,'apps','web','out');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.txt':'text/plain','.woff2':'font/woff2','.woff':'font/woff'};
const assets={async fetch(request){
  let file=resolve(outDir,`.${decodeURIComponent(new URL(request.url).pathname)}`);
  if(file!==outDir && !file.startsWith(outDir+sep)) return new Response('Forbidden',{status:403});
  if(existsSync(file) && statSync(file).isDirectory()) file=join(file,'index.html');
  if(!existsSync(file) && existsSync(`${file}.html`)) file=`${file}.html`;
  if(!existsSync(file)) return new Response('Not found',{status:404});
  return new Response(readFileSync(file),{headers:{'content-type':mime[extname(file)]||'application/octet-stream'}});
}};
const settings=[
  'FINTWIN_DEMO_PASSPHRASE','FINTWIN_ALLOWED_ORIGIN','FINTWIN_ALLOW_PAID','FINTWIN_VOICE_MODE',
  'FINTWIN_SESSION_BUDGET_USD','FINTWIN_TOTAL_BUDGET_USD','FINTWIN_BUDGET_WINDOW',
  'FINTWIN_REALTIME_MAX_SECONDS','FINTWIN_REALTIME_IDLE_SECONDS','FINTWIN_REALTIME_MAX_RESPONSES','FINTWIN_REALTIME_RESERVE_USD',
  'GROQ_API_KEY','GROQ_CHAT_MODEL','GROQ_STT_MODEL','GROQ_TTS_MODEL','GROQ_TTS_VOICE',
  'LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','LLM_REASONING_EFFORT','LLM_MAX_TOKENS','LLM_TOKEN_FIELD','LLM_ALLOW_TEMPERATURE',
  'ELEVENLABS_API_KEY','ELEVENLABS_STT_MODEL','ELEVENLABS_TTS_MODEL','ELEVENLABS_VOICE_ID',
  'OPENAI_API_KEY','OPENAI_REALTIME_MODEL','OPENAI_REALTIME_VOICE','OPENAI_CHAT_MODEL','OPENAI_STT_MODEL','OPENAI_TTS_MODEL','OPENAI_TTS_VOICE',
];
const env={DB:d1(database),ASSETS:assets};
// Forward only after validating the actual host configuration, never a header.
if(localOpen) env.FINTWIN_LOCAL_OPEN='1';
env.TEXT_SMOKE=()=>{try{const report=JSON.parse(readFileSync(join(root,'data','last-text-smoke.json'),'utf8'));if(!['passed','failed'].includes(report.status)||!Number.isFinite(Date.parse(report.at)))throw new Error();return{status:report.status,at:report.at,kind:'text-only',model:typeof report.model==='string'?report.model.slice(0,100):null};}catch{return{status:'not_run',at:null,kind:'text-only'};}};
for(const key of settings) if(process.env[key]) env[key]=process.env[key];
if(process.env.FINTWIN_NO_PROVIDERS){
  for(const key of settings.filter(k=>k.endsWith('_API_KEY'))) delete env[key];
  env.FINTWIN_ALLOW_PAID='0'; env.FINTWIN_VOICE_MODE='text';
  // An isolated provider-free test must not borrow a live host's smoke result.
  env.TEXT_SMOKE=()=>({status:'not_run',at:null,kind:'text-only'});
}
const bundle=await bundleWorker(join(root,'sites-worker','dist','index.mjs'));
const module=await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);
const worker=module.default;
if(existsSync(join(root,'scripts','realtime.mjs'))){
  const { createRealtimeHost }=await import('./realtime.mjs');
  env.REALTIME=createRealtimeHost(env,module.applicationBridge);
}
const server=createServer(async(req,res)=>{
  const abort=new AbortController();
  req.once('aborted',()=>abort.abort());
  res.once('close',()=>{if(!res.writableEnded) abort.abort();});
  try{
    const allowedHosts=new Set([`localhost:${port}`,`127.0.0.1:${port}`,`[::1]:${port}`]);
    if(process.env.FINTWIN_PUBLIC_ORIGIN)allowedHosts.add(new URL(process.env.FINTWIN_PUBLIC_ORIGIN).host);
    if(!allowedHosts.has(req.headers.host)){res.writeHead(403);res.end('Unknown host');return;}
    const max=req.url?.startsWith('/v1/voice/transcribe')?2_000_000:64_000;
    if(Number(req.headers['content-length']||0)>max){res.writeHead(413);res.end('Request too large');return;}
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>max){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
    const headers=new Headers();
    for(const [key,value] of Object.entries(req.headers)) if(typeof value==='string' && !key.startsWith('oai-authenticated-') && !key.startsWith('x-fintwin-device')) headers.set(key,value);
    const base=process.env.FINTWIN_PUBLIC_ORIGIN || `http://${req.headers.host || `localhost:${port}`}`;
    const request=new Request(new URL(req.url,base),{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),signal:abort.signal});
    const response=await worker.fetch(request,env);
    res.writeHead(response.status,{...Object.fromEntries(response.headers),'x-content-type-options':'nosniff','referrer-policy':'same-origin','permissions-policy':'microphone=(self)'});
    if(response.body){const reader=response.body.getReader();abort.signal.addEventListener('abort',()=>void reader.cancel(),{once:true});
      while(!abort.signal.aborted){const {value,done}=await reader.read();if(done)break;if(!res.write(value))await new Promise(r=>{res.once('drain',r);res.once('close',r);});}
    }
    res.end();
  }catch{if(!res.headersSent)res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'Connection interrupted. Please retry.'}));}
});
server.requestTimeout=30_000;server.headersTimeout=15_000;
server.listen(port,process.env.FINTWIN_HOST || '127.0.0.1',()=>console.info(`FinTwin: http://localhost:${port} · ${localOpen?'local demo (no passphrase)':'protected demo'} · ${env.FINTWIN_ALLOW_PAID==='1'?'provider use explicitly enabled':'provider-free'} · ${existsSync(outDir)?'static app served':'build the frontend for single-origin use'}`));
async function shutdown(){await env.REALTIME?.stopAll?.();server.close(()=>{database.close();process.exit(0);});}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
