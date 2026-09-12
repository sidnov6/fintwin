import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { d1, migrate } from '../../scripts/sqlite.mjs';
import type { Env } from '../src/db';
import worker from '../src/index';
import type { AppState, ChatEvent } from '@fintwin/contracts';
export function testEnv(overrides:Partial<Env>={}) { const sqlite=new DatabaseSync(':memory:');migrate(sqlite,resolve(__dirname,'../..'));return {env:{DB:d1(sqlite),...overrides} as Env,sqlite}; }
export function client(env:Env){
  let cookie='';
  const call=(path:string,init:RequestInit={})=>worker.fetch(new Request(`https://fintwin.test${path}`,{...init,headers:{'content-type':'application/json',cookie,...init.headers}}),env);
  const json=async(path:string,init:RequestInit={})=>{const res=await call(path,init);return{status:res.status,...await res.json() as object};};
  const state=async()=>{const r=await json('/v1/state');return (r as {data:AppState}).data;};
  return {call,json,state,async login(){const res=await call('/v1/session',{method:'POST',body:JSON.stringify({passphrase:'synthetic-test-passphrase'})});cookie=res.headers.get('set-cookie')!.split(';')[0];return res;},async mutate(path:string,body:object,method='POST'){const s=await state();return json(path,{method,body:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:s.revision,...body})});},async say(text:string,language='en',extra:object={}){const res=await call('/v1/chat',{method:'POST',body:JSON.stringify({text,language,requestId:crypto.randomUUID(),...extra})});const raw=await res.text();const events=raw.split('\n\n').filter(f=>f.includes('data:')).map(f=>JSON.parse(f.split('\n').find(l=>l.startsWith('data:'))!.slice(5))) as ChatEvent[];return{events,message:events.find(e=>e.type==='done')?.message,raw};}};
}
