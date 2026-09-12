#!/usr/bin/env node
/** Opt-in live, isolated Chromium test. Synthetic microphone only, two turns,
 * no retries. Never invoked by build/start/verify. Closes the owned call. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv.includes('--allow-paid')){console.error('Not run: explicit --allow-paid required.');process.exit(2);}
const fixture=process.argv.find(arg=>arg.startsWith('--audio='))?.slice(8);
if(!fixture)throw new Error('Supply a previously generated synthetic speech fixture with --audio=.');
const fixturePath=resolve(root,fixture);
const pushToTalk=process.argv.includes('--push-to-talk');
if(!fixturePath.startsWith(resolve(root,'data/generated')+'/'))throw new Error('Only generated test audio is accepted.');
const audio=readFileSync(fixturePath).toString('base64');
for(const line of readFileSync(resolve(root,'.env'),'utf8').split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1]in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const base=process.env.FINTWIN_CHECK_URL||'http://127.0.0.1:8798';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw new Error('Local test only.');
const require=createRequire(resolve(root,'apps/web/package.json'));
const {chromium}=require('@playwright/test');
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext();const page=await context.newPage();
const headers={'content-type':'application/json','x-fintwin-request':'1',origin:new URL(base).origin};
const report={kind:pushToTalk?'synthetic-microphone-ptt':'synthetic-microphone-hands-free',status:'failed',at:new Date().toISOString(),model:null,voice:null,transcript:null,reply:null,audioBytes:0,audioEnergy:0,durationMs:0,turns:[]};
let sessionId;const started=performance.now();
const watchdog=setTimeout(()=>void browser.close(),90000);
try{
  report.stage='login';
  const login=await context.request.post(`${base}/v1/session`,{headers,data:{passphrase:process.env.FINTWIN_DEMO_PASSPHRASE}});if(!login.ok())throw new Error('gate_failed');
  await context.request.patch(`${base}/v1/profile`,{headers,data:{language:'en',voiceAutoplay:false}});
  await page.addInitScript(({audio})=>{
    const peers=[];window.__smokePeers=peers;window.__audioFirstAt=null;window.__voiceEvents=[];
    const Native=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends Native{constructor(...args){super(...args);peers.push(this);this.addEventListener('track',event=>{
      const ac=new AudioContext(),analyser=ac.createAnalyser();analyser.fftSize=256;
      ac.createMediaStreamSource(event.streams[0]).connect(analyser);void ac.resume();
      const samples=new Float32Array(analyser.fftSize);const timer=setInterval(()=>{analyser.getFloatTimeDomainData(samples);if(samples.some(v=>Math.abs(v)>0.005)&&window.__audioFirstAt===null)window.__audioFirstAt=performance.now();},20);
      event.track.addEventListener('ended',()=>{clearInterval(timer);void ac.close();});
    });}createDataChannel(...args){const channel=super.createDataChannel(...args);channel.addEventListener('message',e=>{try{const event=JSON.parse(e.data);if(/speech_|transcription\.(completed|failed)|response\.(created|done)$|output_audio_buffer|^error$/.test(event.type))window.__voiceEvents.push({type:event.type,at:Math.round(performance.now()),status:event.response?.status,code:event.error?.code});}catch{}});return channel;}};
    // No real microphone permission/capture. Exercise the app's real PTT,
    // transport, provider transcription, intake, reply, and audio playback.
    navigator.mediaDevices.getUserMedia=async()=>{
      const ac=new AudioContext(),destination=ac.createMediaStreamDestination();
      // Keep real-time silent frames flowing after a fixture ends, just as a
      // physical microphone does. VAD cannot end speech if RTP stops entirely.
      const oscillator=ac.createOscillator(),silence=ac.createGain();silence.gain.value=0;oscillator.connect(silence).connect(destination);oscillator.start();
      const bytes=Uint8Array.from(atob(audio),char=>char.charCodeAt(0));
      const buffer=await ac.decodeAudioData(bytes.buffer);
      window.__playSynthetic=async()=>{await ac.resume();const source=ac.createBufferSource();source.buffer=buffer;source.connect(destination);await new Promise(done=>{source.onended=done;source.start();});};
      return destination.stream;
    };
  },{audio});
  await page.goto(base);await page.getByRole('button',{name:'Start a conversation',exact:true}).click();
  if(pushToTalk){await page.getByText('Microphone & options',{exact:true}).click();await page.getByLabel('Push to talk',{exact:true}).check();}
  const connecting=page.waitForResponse(r=>r.url().endsWith('/v1/realtime/start'));
  report.stage='connect';
  await page.getByRole('button',{name:'Start voice conversation',exact:true}).click();
  const connection=await(await connecting).json();if(!connection.ok)throw new Error('connection_failed');
  sessionId=connection.data.sessionId;report.model=connection.data.model;report.voice=connection.data.voice;
  report.stage='ready_before_capture';
  await page.locator('.voice-actions [role=status]').filter({hasText:'Ready to listen'}).waitFor({timeout:10000});
  if(!pushToTalk && await page.getByRole('button',{name:'Hold to talk',exact:true}).count())throw new Error('ptt_visible_in_handsfree');
  for(let index=0;index<(pushToTalk?1:2);index++){
    const count=await page.locator('.thread .msg:not(.user):not(.system) time').count();
    await page.evaluate(()=>{window.__audioFirstAt=null;window.__captionAt=null;const before=document.querySelectorAll('.thread .msg:not(.user):not(.system) time').length;const observer=new MutationObserver(()=>{if(document.querySelectorAll('.thread .msg:not(.user):not(.system) time').length>before){window.__captionAt=performance.now();observer.disconnect();}});observer.observe(document.querySelector('.thread'),{childList:true,subtree:true});});
    report.stage=`capture_${index+1}`;
    if(pushToTalk){await page.getByRole('button',{name:'Hold to talk',exact:true}).focus();const pressed=page.waitForResponse(r=>r.url().endsWith('/v1/realtime/control')&&r.request().postDataJSON()?.command==='ptt_start');await page.keyboard.down('Space');await pressed;}
    const speechEnd=await page.evaluate(async()=>{await window.__playSynthetic();return performance.now();});
    if(pushToTalk){await page.waitForTimeout(300);await page.keyboard.up('Space');}
    report.stage=`reply_${index+1}`;
    await page.waitForFunction(count=>document.querySelectorAll('.thread .msg:not(.user):not(.system) time').length>count||!!document.querySelector('.voice-controls [role=alert]'),count,{timeout:30000});
    if(await page.locator('.voice-controls [role=alert]').count())throw new Error('voice_failed');
    const timing=await page.evaluate(()=>({audio:window.__audioFirstAt,caption:window.__captionAt}));
    if(timing.audio===null||timing.caption===null||timing.caption<=timing.audio)throw new Error('audio_first_failed');
    report.turns.push({speechEndToAudioMs:Math.round(timing.audio-speechEnd),speechEndToCaptionMs:Math.round(timing.caption-speechEnd),audioBeforeCaption:true});
    await page.locator('.voice-actions [role=status]').filter({hasText:'Ready to listen'}).waitFor({timeout:10000});
  }
  report.stage='verify';
  const state=(await(await context.request.get(`${base}/v1/state`)).json()).data;
  if(state.facts.cash_liquid?.value!==18000)throw new Error('transcription_or_intake_mismatch');
  const messages=(await(await context.request.get(`${base}/v1/messages?language=en`)).json()).data.messages;
  report.transcript=messages.filter(m=>m.role==='user').at(-1)?.text;
  const reply=messages.filter(m=>m.role==='assistant').at(-1);report.reply=reply?.text;
  if(reply?.meta?.provider!=='openai-realtime'||!reply?.text)throw new Error('not_live_voice');
  const stats=await page.evaluate(async()=>{let bytes=0,energy=0;for(const pc of window.__smokePeers)for(const stat of (await pc.getStats()).values())if(stat.type==='inbound-rtp'&&(stat.kind==='audio'||stat.mediaType==='audio')){bytes+=stat.bytesReceived||0;energy+=stat.totalAudioEnergy||0;}return{bytes,energy};});
  report.audioBytes=stats.bytes;report.audioEnergy=stats.energy;
  if(stats.bytes<=0||stats.energy<=0)throw new Error('no_received_audio');
  report.status='passed';
}catch(error){report.failure=['gate_failed','connection_failed','voice_failed','transcription_or_intake_mismatch','not_live_voice','no_received_audio'].includes(error.message)?error.message:'test_timeout_or_ui_failure';report.voiceUI=await page.locator('.voice-controls').innerText({timeout:1000}).catch(()=>'unavailable');process.exitCode=1;}
finally{
  report.events=await page.evaluate(()=>window.__voiceEvents).catch(()=>[]);
  const messages=await context.request.get(`${base}/v1/messages?language=en`,{timeout:3000}).then(r=>r.json()).then(b=>b.data?.messages).catch(()=>null);
  if(messages){report.transcript=messages.filter(m=>m.role==='user').at(-1)?.text??null;report.reply=messages.filter(m=>m.role==='assistant').at(-1)?.text??null;}
  if(sessionId)await context.request.post(`${base}/v1/realtime/control`,{headers,data:{sessionId,command:'end'},timeout:5000}).catch(()=>{});
  await context.request.delete(`${base}/v1/session`,{headers,timeout:5000}).catch(()=>{});
  clearTimeout(watchdog);await browser.close();report.durationMs=Math.round(performance.now()-started);
  mkdirSync(resolve(root,'data'),{recursive:true});writeFileSync(resolve(root,'data/last-realtime-smoke.json'),JSON.stringify(report,null,2)+'\n');console.info(JSON.stringify(report,null,2));
}
