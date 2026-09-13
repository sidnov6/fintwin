#!/usr/bin/env node
/** Opt-in hosted TTS -> STT check. At most two paid requests, synthetic audio
 * only, no room microphone, chat turn, fact mutation, key or audio file output. */
if(!process.argv.includes('--allow-paid')){console.error('Not run: --allow-paid is required.');process.exit(2);}
const base=process.argv.find(arg=>arg.startsWith('--url='))?.slice(6);
if(!base||new URL(base).protocol!=='https:'||!new URL(base).hostname.endsWith('.chatgpt.site'))throw new Error('A selected HTTPS Sites URL is required.');
const token=process.env.FINTWIN_SITE_DIAGNOSTIC_TOKEN;
if(!token)throw new Error('Missing private Sites diagnostic credential.');
const headers={'OAI-Sites-Authorization':`Bearer ${token}`,'x-fintwin-request':'1',origin:new URL(base).origin};
const report={at:new Date().toISOString(),kind:'hosted-synthetic-voice-roundtrip',microphoneUsed:false,requests:0,passed:false};
const safeCode=value=>typeof value==='string'&&/^[a-z_]{1,80}$/.test(value)?value:'request_failed';
try{
  const check=await fetch(`${base}/v1/preflight`,{headers,signal:AbortSignal.timeout(10000)}),preflight=await check.json();
  if(!check.ok)throw new Error('site_access_failed');
  const ai=preflight.data?.ai;
  Object.assign(report,{inputProvider:ai?.speechIn?.provider,inputModel:ai?.speechIn?.model,outputProvider:ai?.speechOut?.provider,voice:ai?.speechOut?.voice});
  if(ai?.speechIn?.provider!=='openai'||ai?.speechOut?.provider!=='openai'||!ai.voice)throw new Error('openai_voice_not_configured');
  if(preflight.data.usage.remaining<.2)throw new Error('budget_exhausted');
  report.requests++;const ttsStart=performance.now();
  const spoken=await fetch(`${base}/v1/voice/synthesize`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({language:'en',text:'My savings are eighteen thousand euros.'}),signal:AbortSignal.timeout(25000)});
  report.ttsStatus=spoken.status;report.ttsMs=Math.round(performance.now()-ttsStart);
  if(!spoken.ok){const body=await spoken.json().catch(()=>({}));throw new Error(safeCode(body.code));}
  const bytes=await spoken.arrayBuffer();report.audioBytes=bytes.byteLength;
  if(bytes.byteLength<1000||!spoken.headers.get('content-type')?.startsWith('audio/'))throw new Error('invalid_audio');
  const form=new FormData();form.set('audio',new File([bytes],'synthetic-check.mp3',{type:'audio/mpeg'}));form.set('language','en');
  report.requests++;const sttStart=performance.now();
  const transcript=await fetch(`${base}/v1/voice/transcribe`,{method:'POST',headers,body:form,signal:AbortSignal.timeout(25000)}),result=await transcript.json().catch(()=>({}));
  report.sttStatus=transcript.status;report.sttMs=Math.round(performance.now()-sttStart);
  if(!transcript.ok)throw new Error(safeCode(result.code));
  report.transcript=result.data?.transcript??'';
  report.passed=/18[,.\s]?000|eighteen thousand/i.test(report.transcript)&&result.data?.provider==='openai';
  if(!report.passed)report.failure='amount_not_recognized';
}catch(error){report.failure=safeCode(error?.message);}
console.info(JSON.stringify(report));if(!report.passed)process.exitCode=1;
