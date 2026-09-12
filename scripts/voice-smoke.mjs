#!/usr/bin/env node
/** Explicitly paid, bounded synthetic TTS -> STT check through the local app.
 * Four speech requests maximum. No microphone, browser/session mutation or
 * automatic retries. Audio is synthetic and saved only under ignored data/.
 */
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
if(!process.argv.includes('--allow-paid')){console.error('Not run: explicit --allow-paid is required.');process.exit(2);}
const config={};
for(const line of readFileSync(resolve('.env'),'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)config[m[1]]=m[2].trim();}
const base=config.FINTWIN_CHECK_URL||'http://127.0.0.1:8798';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Local test only.');
mkdirSync('data/generated',{recursive:true});
const output=mkdtempSync(resolve('data/generated/voice-smoke-'));
const reuseArg=process.argv.find(arg=>arg.startsWith('--reuse='))?.slice(8),reuse=reuseArg?resolve(reuseArg):null;
if(reuse&&!reuse.startsWith(resolve('data/generated')+'/'))throw new Error('Reuse is limited to generated test audio.');
const report={at:new Date().toISOString(),kind:'synthetic-speech-roundtrip',microphoneUsed:false,requests:0,results:[]};
const samples={en:'My savings are eighteen thousand euros.',de:'Mein Sparguthaben beträgt achtzehntausend Euro.'};
const safe=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(value)?value:null;
let cookie='';
try{
  const login=await fetch(`${base}/v1/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({passphrase:config.FINTWIN_DEMO_PASSPHRASE}),signal:AbortSignal.timeout(5000)});
  if(!login.ok)throw new Error('demo_gate_failed');cookie=login.headers.get('set-cookie')?.split(';')[0];
  for(const [language,text] of Object.entries(samples)){
    const start=performance.now(),reused=Boolean(reuse&&existsSync(join(reuse,`${language}.mp3`)));
    if(!reused)report.requests++;
    const voice=reused?new Response(readFileSync(join(reuse,`${language}.mp3`)),{headers:{'content-type':'audio/mpeg'}}):await fetch(`${base}/v1/voice/synthesize`,{method:'POST',headers:{cookie,origin:new URL(base).origin,'content-type':'application/json'},body:JSON.stringify({language,text}),signal:AbortSignal.timeout(20000)});
    if(!voice.ok){const problem=await voice.json().catch(()=>null);report.results.push({language,stage:'tts',status:voice.status,code:safe(problem?.code)});break;}
    const bytes=Buffer.from(await voice.arrayBuffer()),path=join(output,`${language}.mp3`);
    writeFileSync(path,bytes,{mode:0o600});
    const result={language,reused,ttsStatus:voice.status,audioBytes:bytes.length,contentType:voice.headers.get('content-type'),ttsMs:Math.round(performance.now()-start),audioPath:path};report.results.push(result);
    console.info(JSON.stringify(result));
    if(bytes.length<1000||!voice.headers.get('content-type')?.startsWith('audio/'))throw new Error('invalid_audio');
    const form=new FormData();form.set('audio',new File([bytes],`${language}.mp3`,{type:'audio/mpeg'}));form.set('language',language);
    const started=performance.now();report.requests++;
    const stt=await fetch(`${base}/v1/voice/transcribe`,{method:'POST',headers:{cookie,origin:new URL(base).origin,'x-fintwin-request':'1'},body:form,signal:AbortSignal.timeout(20000)});
    const body=await stt.json().catch(()=>null);Object.assign(result,{sttStatus:stt.status,sttMs:Math.round(performance.now()-started),transcript:body?.data?.transcript??null,provider:body?.data?.provider??null});
    if(!stt.ok){result.code=safe(body?.code);break;}
    // Number formatting can vary; evaluate exact recognition from the transcript.
    result.containsExpectedAmount=/18[,.\s]?000|eighteen thousand|achtzehntausend/i.test(result.transcript||'');
    console.info(JSON.stringify({language,sttStatus:result.sttStatus,sttMs:result.sttMs,transcript:result.transcript,containsExpectedAmount:result.containsExpectedAmount}));
    if(!result.containsExpectedAmount)break;
  }
}catch(error){report.error=safe(error?.message)||safe(error?.name)||'test_failed';}
finally{
  if(cookie)await fetch(`${base}/v1/session`,{method:'DELETE',headers:{cookie,'x-fintwin-request':'1'},signal:AbortSignal.timeout(5000)}).catch(()=>{});
  report.passed=report.results.length===2&&report.results.every(r=>r.containsExpectedAmount);
  writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.info(JSON.stringify({reportPath:join(output,'report.json'),...report},null,2));
  if(!report.passed)process.exitCode=1;
}
