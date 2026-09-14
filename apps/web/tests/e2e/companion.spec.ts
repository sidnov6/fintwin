import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {resolve} from 'node:path';
const evidence=resolve(__dirname,'../../../..','docs/TEST_EVIDENCE');
test.beforeEach(async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  await page.locator('#demo-pass').fill('synthetic-test-passphrase');
  await page.getByRole('button',{name:/Demo öffnen|Enter demo/}).click();
  await expect(page.locator('.opening')).toBeVisible();
  await page.getByRole('button',{name:'English',exact:true}).click();
  await page.request.patch('/v1/profile',{data:{voiceAutoplay:false}});
});
async function say(page:Page,text:string){const box=page.locator('.composer textarea');await box.fill(text);await box.press('Enter');await expect(page.locator('.thread .msg.user').last()).toContainText(text);await expect(page.locator('.caret,.typing')).toHaveCount(0,{timeout:10000});}
async function tab(page:Page,name:string){const desktop=page.getByRole('tab',{name,exact:true});if(await desktop.isVisible())await desktop.click();else await page.locator('.bottom-tabs').getByRole('button',{name,exact:true}).click();}
async function mockSpokenReply(page:Page){
  await page.route('**/v1/chat',route=>route.fulfill({contentType:'text/event-stream',body:[
    {type:'start',messageId:'spoken-reply',mode:'live'},
    {type:'done',message:{id:'spoken-reply',role:'assistant',text:'Hi Alex, what would you like to explore?',cards:[],createdAt:new Date().toISOString()}},
  ].map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')}));
}

test('Interview demo: charts, contextual drill-down, reload and bank filters',async({page})=>{
  await page.getByRole('button',{name:'Explore a sample household',exact:true}).click();
  await page.getByRole('button',{name:'Show my spending trends',exact:true}).click();
  await expect(page.locator('.thread .bank-report')).toBeVisible();await expect(page.locator('.thread .bank-report .chart-column')).toHaveCount(6);
  await say(page,'What about groceries?');await say(page,'And in August?');
  await expect(page.locator('.thread .bank-report').last()).toContainText('€1,040.00');
  await page.reload();await expect(page.locator('.thread .bank-report').last()).toContainText('€1,040.00');
  await say(page,'Show my mortgage trends');await expect(page.locator('.thread .mortgage-chart svg')).toBeVisible();
  await tab(page,'Bank');await expect(page.locator('.bank-account-band')).toContainText('€61,900.00');
  await page.getByLabel('Period',{exact:true}).selectOption('2026-08');await page.getByLabel('Category',{exact:true}).selectOption('groceries');
  await expect(page.locator('.bank-page .bank-report-total')).toContainText('€1,040.00');await expect(page.locator('.bank-page .transaction')).toHaveCount(4);
  const a11y=await new AxeBuilder({page}).analyze();expect(a11y.violations.filter(v=>['critical','serious'].includes(v.impact??''))).toEqual([]);
  await page.screenshot({path:resolve(evidence,'bank-august-groceries.png'),fullPage:true});
  await page.getByLabel('Period',{exact:true}).selectOption('');await page.getByLabel('Category',{exact:true}).selectOption('');
  await expect(page.locator('.bank-page .transaction')).toHaveCount(8);await page.getByRole('button',{name:'Next transactions',exact:true}).click();
  await expect(page.locator('.ledger-pagination')).toContainText('9–16');await page.screenshot({path:resolve(evidence,'bank-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,'bank-mobile.png'),fullPage:true});
});

test('Quick introduction: three replies capture multiple spoken facts without repeats',async({page})=>{
  await page.getByRole('button',{name:'Start a conversation',exact:true}).click();
  await say(page,'I’m Alex, I am thirty two and I want to retire at forty.');await say(page,'I take home five thousand a month and spend three thousand.');await say(page,'Twenty thousand in cash, forty thousand invested, no debt.');
  const s=await(await page.request.get('/v1/state')).json();expect(s.data.profile).toMatchObject({name:'Alex',onboardingDone:true});
  expect(s.data.facts.income_net_monthly.value).toBe(5000);expect(s.data.facts.expenses_monthly.value).toBe(3000);expect(s.data.facts.investments_value.value).toBe(40000);
  await expect(page.locator('.intake-progress')).toHaveCount(0);await expect(page.locator('.thread .msg').last()).toContainText('Your first picture is ready');
});

test('C01/C06 first introduction, correction, persistence and accessible text flow',async({page})=>{
  await page.getByRole('button',{name:'Start a conversation',exact:true}).click();
  await say(page,'My name is Alex. I am 40 years old, earn 5000 net a month, spend 3500 a month and have 20000 in cash.');
  await expect(page.locator('.thread')).toContainText('Hi Alex');
  await say(page,'No, spending is 2500, not 3500.');
  const state=await(await page.request.get('/v1/state')).json();expect(state.data.facts.expenses_monthly.value).toBe(2500);expect(state.data.facts.income_net_monthly.value).toBe(5000);
  await page.screenshot({path:resolve(evidence,'conversation-en.png'),fullPage:true});
  const a11y=await new AxeBuilder({page}).analyze();expect(a11y.violations.filter(v=>['critical','serious'].includes(v.impact??''))).toEqual([]);
  await page.reload();await expect(page.locator('.thread')).toContainText('spending is 2500');
});
test('N01 facts edited in the picture update shared state',async({page})=>{
  await page.getByRole('button',{name:'Start a conversation',exact:true}).click();await say(page,'Call me Alex');await tab(page,'Picture');
  await page.getByRole('button',{name:'Edit: Cash & savings',exact:true}).click();await page.getByLabel(/How much sits/).fill('18,000.50');await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.toast')).toContainText('Cash & savings');const state=await(await page.request.get('/v1/state')).json();expect(state.data.facts.cash_liquid.value).toBe(18000.5);await tab(page,'Chat');await expect(page.locator('.thread')).toContainText('Cash & savings');
});
test('S01/B01 sample → exact mortgage snapshot → explanation → sourced brief',async({page})=>{
  await page.getByRole('button',{name:'Explore a sample household',exact:true}).click();await expect(page.locator('.sample-bar')).toContainText('Synthetic');await tab(page,'Plan');
  await page.getByLabel('Extra repayment / month',{exact:true}).fill('300');await page.getByRole('button',{name:'Ask FinTwin',exact:true}).click();
  await expect(page.locator('.thread')).toContainText('€300');await expect(page.locator('.thread .scenario-card')).toHaveCount(1);
  const state=await(await page.request.get('/v1/state')).json();expect(state.data.scenarios[0].inputs.special_repayment_monthly).toBe(300);
  await page.getByRole('button',{name:'Prepare meeting',exact:true}).click();await expect(page.getByRole('heading',{name:'Your adviser meeting brief',exact:true})).toBeVisible();await page.getByRole('button',{name:'View sources',exact:true}).click();await expect(page.locator('.meeting-brief')).toContainText(`scenario:${state.data.scenarios[0].id}`);
  await page.screenshot({path:resolve(evidence,'brief-en-review.png'),fullPage:true});await page.emulateMedia({media:'print'});await page.pdf({path:resolve(evidence,'brief-en.pdf'),format:'A4',preferCSSPageSize:true});
});
test('C13/U01 German, narrow layout and zoom',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Deutsch',exact:true}).click();await page.getByRole('button',{name:'Gespräch beginnen',exact:true}).click();await say(page,'Ich heiße Anna. Ich verdiene 5.500,50 Euro netto im Monat und gebe 2.500 Euro aus.');
  const state=await(await page.request.get('/v1/state')).json();expect(state.data.facts.income_net_monthly.value).toBe(5500.5);await expect(page.locator('.thread')).toContainText('Hallo Anna');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,'conversation-de-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>{document.documentElement.style.zoom='2';});await expect(page.locator('.composer textarea')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,'conversation-de-zoom.png'),fullPage:true});
});
test('policy boundary leaves a useful next action',async({page})=>{
  await page.getByRole('button',{name:'Start a conversation',exact:true}).click();await say(page,'Which ETF should I buy?');await expect(page.locator('.thread')).toContainText('cannot pick a specific product');await expect(page.getByRole('button',{name:/What matters when choosing ETFs/})).toBeVisible();
});

test('B03/U02 German A4, keyboard slider, draft language switch and sample recovery',async({page})=>{
  await page.setViewportSize({width:1280,height:800});await page.getByRole('button',{name:'Explore a sample household',exact:true}).click();await tab(page,'Plan');
  await page.getByRole('slider',{name:'Extra repayment / month slider',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByLabel('Extra repayment / month',{exact:true})).toHaveValue('25');
  await page.getByLabel('Annual interest (%)',{exact:true}).fill('3.25');await page.getByRole('button',{name:'Deutsch',exact:true}).click();await expect(page.locator('#scenario-mortgage-rate_pct')).toHaveValue('3,25');
  await tab(page,'Bild');await tab(page,'Planen');await expect(page.locator('#scenario-mortgage-rate_pct')).toHaveValue('3,25');
  await page.screenshot({path:resolve(evidence,'plan-de-1280.png'),fullPage:true});
  await page.getByRole('button',{name:'Szenario speichern',exact:true}).click();await expect(page.locator('.scenario-card:visible')).toBeVisible();await page.getByRole('button',{name:'Beratungsgespräch vorbereiten',exact:true}).click();await expect(page.locator('.meeting-brief')).toContainText('3,25 %');
  const a11y=await new AxeBuilder({page}).analyze();expect(a11y.violations.filter(v=>['critical','serious'].includes(v.impact??''))).toEqual([]);
  await page.screenshot({path:resolve(evidence,'brief-de-review.png'),fullPage:true});await page.emulateMedia({media:'print'});await page.pdf({path:resolve(evidence,'brief-de.pdf'),format:'A4',preferCSSPageSize:true});await page.emulateMedia({media:'screen'});
  page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Beispiel zurücksetzen',exact:true}).click();const state=await(await page.request.get('/v1/state')).json();expect(state.data.scenarios).toHaveLength(0);
});

test('U03 microphone controls and preflight are transparent without paid permissions',async({page})=>{
  await page.getByRole('button',{name:'Start a conversation',exact:true}).click();
  await expect(page.getByRole('button',{name:'Hands-free',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Hands-free',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Speak',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Speak',exact:true})).toBeDisabled();
  await expect(page.getByText('Microphone & options',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Test voice',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Presenter preflight',exact:true}).click();await expect(page.locator('.page')).toContainText('Not run');await page.screenshot({path:resolve(evidence,'preflight-provider-free.png'),fullPage:true});
});

test('A01/U01 settings keyboard focus, Escape and real session sign-out',async({page})=>{
  const settings=page.getByRole('button',{name:'Settings',exact:true});await settings.click();await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(settings).toBeFocused();await settings.click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.locator('#demo-pass')).toBeVisible();expect((await page.request.get('/v1/state')).status()).toBe(401);
});

test('continuous voice is visible by default, text remains full-width, and legacy playback does not compete',async({page})=>{
  await page.request.patch('/v1/profile',{data:{language:'en',voiceAutoplay:false}});
  await page.route('**/v1/state',async route=>{const response=await route.fetch(),body=await response.json();body.data.ai.realtime={...body.data.ai.realtime,mode:'realtime',available:true};await route.fulfill({response,json:body});});
  await page.reload();await page.getByRole('button',{name:'Start a conversation',exact:true}).click();
  await expect(page.getByRole('button',{name:'Start voice conversation',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Test voice',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Speak',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Hands-free',exact:true})).toHaveCount(0);
  await page.getByText('Microphone & options',{exact:true}).click();await expect(page.getByLabel('Push to talk',{exact:true})).not.toBeChecked();
  await page.getByText('Microphone & options',{exact:true}).click();await page.setViewportSize({width:390,height:844});
  const box=await page.locator('.composer textarea').boundingBox(),form=await page.locator('.composer').boundingBox();expect(box!.width/form!.width).toBeGreaterThan(.75);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:resolve(evidence,'voice-first-narrow.png'),fullPage:true});
});

test('spoken reply exposes model terms and never starts the microphone (mock provider)',async({page})=>{
  await page.request.patch('/v1/profile',{data:{language:'en',voiceAutoplay:true}});await mockSpokenReply(page);
  await page.route('**/v1/state',async route=>{const response=await route.fetch(),body=await response.json();body.data.ai.voice=true;body.data.ai.realtime.mode='chained';body.data.ai.speechOut={provider:'groq',voice:'hannah',maxChars:190,multilingual:false};await route.fulfill({response,json:body});});
  let requests=0;await page.route('**/v1/voice/synthesize',async route=>{requests++;await route.fulfill({status:403,json:{ok:false,code:'voice_terms_required',error:'Review the terms.'}});});
  await page.addInitScript(()=>{Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>{throw new Error('A voice output test must not record audio');}});});
  await page.reload();await page.getByRole('button',{name:'Start a conversation',exact:true}).click();
  await say(page,'Call me Alex');
  await expect(page.locator('.voice-playback-error[role="alert"]')).toContainText('Orpheus model terms');await expect(page.getByRole('link',{name:'Open Groq Console'})).toHaveAttribute('href','https://console.groq.com/');expect(requests).toBe(1);
  await expect(page.getByRole('button',{name:'Test voice',exact:true})).toHaveCount(0);await expect(page.locator('.composer textarea')).toBeEnabled();
});

test('OpenAI spoken reply retains actionable missing-credit guidance without voice labels (mock provider)',async({page})=>{
  await page.request.patch('/v1/profile',{data:{language:'en',voiceAutoplay:true}});await mockSpokenReply(page);
  await page.route('**/v1/state',async route=>{const response=await route.fetch(),body=await response.json();body.data.ai.voice=true;body.data.ai.realtime.mode='chained';body.data.ai.speechOut={provider:'openai',voice:'marin',maxChars:800,multilingual:true};await route.fulfill({response,json:body});});
  let requests=0;await page.route('**/v1/voice/synthesize',async route=>{requests++;await route.fulfill({status:402,json:{ok:false,code:'openai_billing_required',error:'API billing needs attention.'}});});
  await page.addInitScript(()=>{Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>{throw new Error('Output testing must not record audio');}});});
  await page.reload();await page.getByRole('button',{name:'Start a conversation',exact:true}).click();
  await say(page,'Call me Alex');
  await expect(page.locator('.voice-playback-error[role="alert"]')).toContainText('Creating an API key does not add credits');
  await expect(page.locator('.composer-wrap')).not.toContainText('Marin');
  await expect(page.getByRole('link',{name:'Open OpenAI API billing'})).toHaveAttribute('href','https://platform.openai.com/settings/organization/billing/overview');
  expect(requests).toBe(1);await expect(page.locator('.composer textarea')).toBeEnabled();
});

test('silent hands-free recording stops without transcription or a reply loop',async({page})=>{
  await page.request.patch('/v1/profile',{data:{language:'en',voiceAutoplay:false}});
  await page.route('**/v1/state',async route=>{const response=await route.fetch(),body=await response.json();body.data.ai.speechIn.provider='openai';body.data.ai.realtime.mode='chained';await route.fulfill({response,json:body});});
  let transcriptions=0;await page.route('**/v1/voice/transcribe',async route=>{transcriptions++;await route.fulfill({json:{ok:true,data:{transcript:''}}});});
  await page.addInitScript(()=>{
    const track={stop(){}};
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>({getTracks:()=>[track]})});
    class Recorder {static isTypeSupported(){return true;}state='inactive';onstop:(()=>void)|null=null;ondataavailable:((e:{data:Blob})=>void)|null=null;start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array(2000)],{type:'audio/webm'})});queueMicrotask(()=>this.onstop?.());}}
    class SilentContext {createAnalyser(){return{fftSize:1024,getByteTimeDomainData(samples:Uint8Array){samples.fill(128);}};}createMediaStreamSource(){return{connect(){}};}async resume(){}async close(){}}
    Object.defineProperty(window,'MediaRecorder',{value:Recorder});Object.defineProperty(window,'AudioContext',{value:SilentContext});
  });
  await page.reload();await page.getByRole('button',{name:'Start a conversation',exact:true}).click();
  await page.getByRole('button',{name:'Hands-free',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stop recording',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Speak',exact:true})).toBeVisible({timeout:9000});
  await expect(page.locator('.voice-banner')).toHaveCount(0);expect(transcriptions).toBe(0);
  await expect(page.locator('.thread .msg.user')).toHaveCount(0);
});
