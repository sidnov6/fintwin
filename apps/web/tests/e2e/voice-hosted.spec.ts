import {test,expect,type Page} from '@playwright/test';
import type {AppState} from '@fintwin/contracts';
function configureVoice(state:AppState){Object.assign(state.ai,{voice:true,speechIn:{provider:'openai',model:'gpt-4o-mini-transcribe'},speechOut:{provider:'openai',voice:'marin',maxChars:800,multilingual:true},realtime:{...state.ai.realtime,available:false,mode:'chained'}});}

// Real browser recording lifecycle with synthetic capture and mocked providers.
// No physical microphone, private key or paid model is used by these tests.
async function openVoice(page:Page){
  await page.goto('/');await page.locator('#demo-pass').fill('synthetic-test-passphrase');await page.getByRole('button',{name:/Demo öffnen|Enter demo/}).click();
  await page.getByRole('button',{name:'English',exact:true}).click();await page.request.patch('/v1/profile',{data:{language:'en',voiceAutoplay:false}});
  await page.route('**/v1/state',async route=>{const response=await route.fetch(),body=await response.json();configureVoice(body.data);await route.fulfill({response,json:body});});
  await page.route('**/v1/chat',async route=>{const response=await route.fetch();const body=(await response.text()).split('\n').map(line=>{if(!line.startsWith('data:'))return line;const event=JSON.parse(line.slice(5));if(event.type==='state')configureVoice(event.state);return `data: ${JSON.stringify(event)}`;}).join('\n');await route.fulfill({response,body});});
  await page.addInitScript(()=>{
    localStorage.setItem('fintwin-microphone','laptop');
    const w=window as unknown as {captures:number;stopped:number;captureConstraints:MediaStreamConstraints[]};w.captures=0;w.stopped=0;w.captureConstraints=[];
    Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>[{kind:'audioinput',deviceId:'laptop',label:'Laptop microphone'}]});
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async(c:MediaStreamConstraints)=>{w.captures++;w.captureConstraints.push(c);return{getTracks:()=>[{stop(){w.stopped++;}}]};}});
    class Recorder {static isTypeSupported(type:string){return type.startsWith('audio/webm');}mimeType='audio/webm;codecs=opus';state='inactive';onstop:(()=>void)|null=null;ondataavailable:((e:{data:Blob})=>void)|null=null;start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array(2000)],{type:this.mimeType})});queueMicrotask(()=>this.onstop?.());}}
    class Context {started=Date.now();createAnalyser(){const start=this.started;return{fftSize:1024,getByteTimeDomainData(samples:Uint8Array){samples.fill(Date.now()-start<350?140:128);}};}createMediaStreamSource(){return{connect(){}};}async resume(){}async close(){}}
    Object.defineProperty(window,'MediaRecorder',{value:Recorder});Object.defineProperty(window,'AudioContext',{value:Context});
  });
  await page.reload();await page.getByRole('button',{name:'Start a conversation',exact:true}).click();
}
function silentWav(){
  const bytes=Buffer.alloc(1644),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  bytes.write('RIFF');view.setUint32(4,1636,true);bytes.write('WAVEfmt ',8);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,8000,true);view.setUint16(32,1,true);view.setUint16(34,8,true);bytes.write('data',36);view.setUint32(40,1600,true);bytes.fill(128,44);return bytes;
}
test('compact hands-free records saved input, transcribes, saves facts and speaks with read-aloud preference off',async({page})=>{
  await openVoice(page);let transcriptions=0,voices=0,release:(()=>void)|undefined;
  await page.route('**/v1/voice/transcribe',async route=>{transcriptions++;expect(route.request().headers()['x-fintwin-request']).toBe('1');await new Promise<void>(r=>{release=r;});await route.fulfill({json:{ok:true,data:{transcript:'I am 32 and take home 5000 euros net per month.',provider:'openai'}}});});
  await page.route('**/v1/voice/synthesize',async route=>{voices++;await route.fulfill({contentType:'audio/wav',body:silentWav()});});
  await page.getByRole('button',{name:'Hands-free',exact:true}).click();
  await expect(page.locator('.compact-voice-status')).toContainText('Listening');
  await expect.poll(()=>transcriptions).toBe(1);await expect(page.locator('.compact-voice-status')).toContainText('Transcribing');await expect(page.getByRole('button',{name:'Speak',exact:true})).toBeDisabled();release!();
  await expect(page.locator('.thread .msg.user')).toContainText('take home 5000');
  await expect.poll(()=>voices).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {captures:number}).captures)).toBeGreaterThan(1);
  await page.getByRole('button',{name:'End conversation',exact:true}).click();
  const counts=await page.evaluate(()=>{const w=window as unknown as {captures:number;stopped:number;captureConstraints:MediaStreamConstraints[]};return{captures:w.captures,stopped:w.stopped,constraints:w.captureConstraints[0]};});
  expect(counts.stopped).toBeGreaterThanOrEqual(counts.captures);expect(counts.constraints.audio).toMatchObject({deviceId:{exact:'laptop'}});
  const s=await(await page.request.get('/v1/state')).json();expect(s.data.facts.income_net_monthly.value).toBe(5000);expect(transcriptions).toBe(1);
});
test('provider rejection is visible next to voice controls and is not called a microphone permission failure',async({page})=>{
  await openVoice(page);await page.route('**/v1/voice/transcribe',route=>route.fulfill({status:502,json:{ok:false,code:'provider_auth_failed',error:'private upstream text must not be reflected'}}));
  await page.getByRole('button',{name:'Hands-free',exact:true}).click();
  const alert=page.locator('.composer-wrap').getByRole('alert');await expect(alert).toContainText('private server key');await expect(alert).not.toContainText('private upstream text');
  await expect(page.getByRole('button',{name:'Hands-free',exact:true})).toBeEnabled();await expect(page.locator('.thread .msg.user')).toHaveCount(0);
});
test('ending voice during transcription discards the late result and never creates a message',async({page})=>{
  await openVoice(page);let release:(()=>void)|undefined,requested=false;
  await page.route('**/v1/voice/transcribe',async route=>{requested=true;await new Promise<void>(r=>{release=r;});await route.fulfill({json:{ok:true,data:{transcript:'My cash is 9999 euros.'}}}).catch(()=>{});});
  await page.getByRole('button',{name:'Hands-free',exact:true}).click();await expect.poll(()=>requested).toBe(true);
  await page.getByRole('button',{name:'End conversation',exact:true}).click();release!();
  await expect(page.getByRole('button',{name:'Hands-free',exact:true})).toBeEnabled();await expect(page.locator('.thread .msg.user')).toHaveCount(0);
  const s=await(await page.request.get('/v1/state')).json();expect(s.data.facts.cash_liquid).toBeUndefined();
});

test('hosted voice uses only two compact controls and leaves room for chat on desktop and mobile',async({page},testInfo)=>{
  await openVoice(page);
  for(const viewport of [{width:1280,height:800},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button',{name:'Hands-free',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Speak',exact:true})).toBeVisible();
    await expect(page.locator('.voice-controls,.voice-preview,.voice-banner')).toHaveCount(0);
    await expect(page.getByRole('button',{name:/Test voice|Read reply|Read replies/})).toHaveCount(0);
    await expect(page.locator('.composer-wrap')).not.toContainText(/Marin|AI voice|Let’s talk/);
    expect((await page.locator('.composer-wrap').boundingBox())!.height).toBeLessThan(200);
    expect((await page.locator('.thread').boundingBox())!.height).toBeGreaterThan(200);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`compact-voice-${viewport.width}.png`),fullPage:true});
  }
});

test('microphone button sends one recording without enabling hands-free',async({page})=>{
  await openVoice(page);let transcriptions=0;
  await page.route('**/v1/voice/transcribe',async route=>{transcriptions++;await route.fulfill({json:{ok:true,data:{transcript:'Call me Alex.',provider:'openai'}}});});
  await page.getByRole('button',{name:'Speak',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stop recording',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.thread .msg.user')).toContainText('Call me Alex.');
  await expect(page.getByRole('button',{name:'Speak',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Hands-free',exact:true})).toHaveAttribute('aria-pressed','false');
  expect(transcriptions).toBe(1);
  expect(await page.evaluate(()=>(window as unknown as {captures:number}).captures)).toBe(1);
});
