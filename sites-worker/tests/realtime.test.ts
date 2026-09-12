import {afterEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {createRealtimeHost,sessionConfiguration,realtimeProblem} from '../../scripts/realtime.mjs';
import {realtimeCost} from '../src/pricing';
class Socket extends EventEmitter {static instances:Socket[]=[];readyState=1;sent:any[]=[];url:string;constructor(url:string){super();this.url=url;Socket.instances.push(this);queueMicrotask(()=>this.emit('open'));}send(data:string){this.sent.push(JSON.parse(data));}close(){this.readyState=3;this.emit('close');}event(event:object){this.emit('message',Buffer.from(JSON.stringify(event)));}}
const hosts:any[]=[];afterEach(async()=>{await Promise.all(hosts.splice(0).map(h=>h.stopAll()));Socket.instances=[];vi.restoreAllMocks();});
function setup(paid=true){const env={OPENAI_API_KEY:'not-a-real-key',FINTWIN_ALLOW_PAID:paid?'1':'0',FINTWIN_VOICE_MODE:'realtime'};const bridge={tools:[],instructions:()=> 'Shared application policy',state:vi.fn(async()=>({revision:1,profile:{language:'de'}})),reserve:vi.fn(async()=>crypto.randomUUID()),settle:vi.fn(async()=>{}),begin:vi.fn(async(_e:any,_u:string,_id:string,_text:string,signal:AbortSignal)=>({state:{revision:1},signal})),tool:vi.fn(async()=>({ok:true})),finish:vi.fn(async()=>({id:'reply',text:'Saved reply'}))};const fetcher=vi.fn(async(url:string)=>url.endsWith('/hangup')?new Response(null,{status:200}):new Response('v=0 mock answer',{status:201,headers:{location:'https://api.openai.com/v1/realtime/calls/rtc_owned'}}));const host=createRealtimeHost(env,bridge,{Socket,fetcher});hosts.push(host);const request=(path:string,body?:object,user='user-a')=>host.handle(new Request(`https://fintwin.test/v1/realtime/${path}`,body?{method:'POST',body:JSON.stringify(body)}:{}),user);return{env,bridge,fetcher,host,request,async start(){const response=await request('start',{sdp:'v=0 mock',pushToTalk:false});return(await response.json()).data;}};}
describe('mocked server sideband — no paid provider traffic',()=>{
  it('detects successive speech turns and barge-in without any push-to-talk command',async()=>{
    const {start,bridge}=setup();await start();const socket=Socket.instances[0];
    socket.event({type:'input_audio_buffer.speech_started',item_id:'first'});
    socket.event({type:'input_audio_buffer.speech_stopped',item_id:'first'});
    socket.event({type:'conversation.item.input_audio_transcription.completed',item_id:'first',transcript:'I have 18000 in savings.'});
    await vi.waitFor(()=>expect(socket.sent.filter(e=>e.type==='response.create')).toHaveLength(1));
    socket.event({type:'response.created',response:{id:'first-response'}});
    socket.event({type:'output_audio_buffer.started',response_id:'first-response'});
    socket.event({type:'input_audio_buffer.speech_started',item_id:'second'});
    expect(socket.sent).toContainEqual({type:'response.cancel',response_id:'first-response'});
    expect(socket.sent).toContainEqual({type:'output_audio_buffer.clear'});
    socket.event({type:'conversation.item.input_audio_transcription.completed',item_id:'second',transcript:'Actually 20000.'});
    await vi.waitFor(()=>expect(socket.sent.filter(e=>e.type==='response.create')).toHaveLength(2));
    expect(bridge.begin).toHaveBeenCalledTimes(2);
    expect(socket.sent.some(e=>e.type==='input_audio_buffer.commit')).toBe(false);
  });
  it('honors the interview duration, idle allowance and more than 30 responses',async()=>{
    const {env,start,request}=setup();Object.assign(env,{FINTWIN_REALTIME_MAX_SECONDS:'3300',FINTWIN_REALTIME_IDLE_SECONDS:'300',FINTWIN_REALTIME_MAX_RESPONSES:'240'});
    const timer=vi.spyOn(globalThis,'setTimeout'),before=Date.now(),s=await start();
    expect(Date.parse(s.expiresAt)-before).toBeGreaterThanOrEqual(3_299_000);expect(timer.mock.calls.some(call=>call[1]===3_300_000)).toBe(true);expect(timer.mock.calls.some(call=>call[1]===300_000)).toBe(true);
    for(let n=0;n<31;n++)expect((await request('control',{sessionId:s.sessionId,command:'text',text:'A synthetic rehearsal turn.'})).status).toBe(200);
    expect(Socket.instances[0].sent.filter(e=>e.type==='response.create')).toHaveLength(31);
  });
  it('clamps an oversized configured session below the provider hour limit',async()=>{
    const {env,start}=setup();Object.assign(env,{FINTWIN_REALTIME_MAX_SECONDS:'999999'});const before=Date.now(),s=await start();expect(Date.parse(s.expiresAt)-before).toBeLessThan(3_301_000);
  });
  it('settles reported response cost rather than retaining a dollar per response',async()=>{
    const {bridge,start,request}=setup();Object.assign(bridge,{realtimeCost});const s=await start();await request('control',{sessionId:s.sessionId,command:'text',text:'Synthetic turn'});
    Socket.instances[0].event({type:'response.created',response:{id:'priced'}});
    Socket.instances[0].event({type:'response.done',response:{id:'priced',status:'completed',output:[],usage:{input_tokens:100,output_tokens:20,input_token_details:{text_tokens:100,audio_tokens:0},output_token_details:{text_tokens:0,audio_tokens:20}}}});
    await vi.waitFor(()=>expect(bridge.settle).toHaveBeenCalled());expect((bridge.settle.mock.calls[0] as unknown[])[3]).toBeCloseTo(.00168);
  });
  it('retains reservations when response usage is missing',async()=>{
    const {bridge,start,request}=setup();Object.assign(bridge,{realtimeCost});const s=await start();await request('control',{sessionId:s.sessionId,command:'text',text:'Synthetic turn'});
    Socket.instances[0].event({type:'response.created',response:{id:'unpriced'}});Socket.instances[0].event({type:'response.done',response:{id:'unpriced',status:'completed',output:[]}});
    await vi.waitFor(()=>expect(bridge.settle).toHaveBeenCalled());expect((bridge.settle.mock.calls[0] as unknown[]).slice(2)).toEqual([null,undefined]);
  });
  it.each([{code:'insufficient_quota'},{code:'credit_balance_exhausted',type:'insufficient_quota'},{code:'billing_hard_limit_reached'},{type:'insufficient_quota'}])('reports unavailable credits safely without opening a socket: %j',async error=>{
    const {request,fetcher}=setup();fetcher.mockResolvedValueOnce(Response.json({error:{...error,message:'private synthetic credential'}},{status:429}));
    const response=await request('start',{sdp:'v=0 mock'});expect(response.status).toBe(402);const text=await response.text();expect(text).toContain('creating a key does not add credits');expect(text).not.toContain('private synthetic');expect(Socket.instances).toHaveLength(0);
  });
  it('has bounded server-owned model configuration and manual response creation',()=>{const {env,bridge}=setup();const cfg=sessionConfiguration(env,bridge,{profile:{language:'en'}});expect(cfg.audio.input.turn_detection.create_response).toBe(false);expect(cfg.max_output_tokens).toBe(512);expect(cfg.truncation.token_limits.post_instructions).toBe(8000);expect(cfg.audio.output.voice).toBe('marin');});
  it('does not make any provider request merely because a key exists',async()=>{const {request,fetcher}=setup(false);expect((await request('start',{sdp:'v=0 mock'})).status).toBe(503);expect(fetcher).not.toHaveBeenCalled();});
  it('binds sideband to a server-returned owned call, isolates users and hangs up both transports',async()=>{const {start,request,fetcher}=setup();const session=await start();expect(Socket.instances[0].url).toContain('call_id=rtc_owned');expect((await request('control',{sessionId:session.sessionId,command:'end'},'user-b')).status).toBe(410);expect((await request('control',{sessionId:'forged',command:'end'})).status).toBe(409);await request('control',{sessionId:session.sessionId,command:'end'});expect(fetcher.mock.calls.some(([url])=>url.endsWith('/rtc_owned/hangup'))).toBe(true);});
  it('rejects browser-supplied model and call configuration',async()=>{const {request,fetcher}=setup();expect((await request('start',{sdp:'v=0 mock',model:'unbounded'})).status).toBe(422);expect(fetcher).not.toHaveBeenCalled();});
  it('reserves before response creation and routes text through the same application',async()=>{const {start,request,bridge}=setup();const s=await start();await request('control',{sessionId:s.sessionId,command:'text',text:'My savings are 18000.'});expect(bridge.begin).toHaveBeenCalled();expect(bridge.reserve).toHaveBeenCalledTimes(2);expect(Socket.instances[0].sent.some(e=>e.type==='response.create')).toBe(true);});
  it('a late transcription/application result cannot revive an interrupted turn',async()=>{const {start,request,bridge}=setup();const s=await start();let resolve:(v:any)=>void=()=>{};bridge.begin.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=request('control',{sessionId:s.sessionId,command:'text',text:'Old turn'});await vi.waitFor(()=>expect(bridge.begin).toHaveBeenCalledOnce());await request('control',{sessionId:s.sessionId,command:'interrupt'});resolve({state:{revision:1}});await pending;expect(Socket.instances[0].sent.some(e=>e.type==='response.create')).toBe(false);});
  it('unauthorized provider generation ends the session',async()=>{const {start,fetcher}=setup();await start();Socket.instances[0].event({type:'response.created',response:{id:'unreserved'}});await vi.waitFor(()=>expect(fetcher.mock.calls.some(([url])=>url.endsWith('/hangup'))).toBe(true));});
  it('idle push-to-talk clears and commits input without cancelling nonexistent output',async()=>{const {start,request}=setup();const s=await start();await request('control',{sessionId:s.sessionId,command:'ptt_start'});await request('control',{sessionId:s.sessionId,command:'ptt_end'});expect(Socket.instances[0].sent.map(e=>e.type)).toEqual(['input_audio_buffer.clear','input_audio_buffer.commit']);});
  it('uses a provider-valid item ID for typed voice turns (live rejection regression)',async()=>{const {start,request}=setup();const s=await start();await request('control',{sessionId:s.sessionId,command:'text',text:'Synthetic test.'});const events=Socket.instances[0].sent;expect(events.find(e=>e.type==='conversation.item.create').item.id.length).toBeLessThanOrEqual(32);expect(events.some(e=>e.type==='response.cancel')).toBe(false);});
  it('cancels only active generation and playback when interrupted',async()=>{const {start,request}=setup();const s=await start();await request('control',{sessionId:s.sessionId,command:'text',text:'Synthetic test.'});const socket=Socket.instances[0];socket.event({type:'response.created',response:{id:'active'}});socket.event({type:'output_audio_buffer.started',response_id:'active'});await request('control',{sessionId:s.sessionId,command:'interrupt'});expect(socket.sent).toContainEqual({type:'response.cancel',response_id:'active'});expect(socket.sent).toContainEqual({type:'output_audio_buffer.clear'});});
  it.each(['failed','incomplete'])('surfaces a %s response and closes the call instead of getting stuck thinking',async status=>{const {start,request,fetcher}=setup();const s=await start();await request('control',{sessionId:s.sessionId,command:'text',text:'Synthetic test.'});const socket=Socket.instances[0];socket.event({type:'response.created',response:{id:'failed'}});socket.event({type:'response.done',response:{id:'failed',status,status_details:{error:{type:'invalid_request_error',message:'private content'}}}});await vi.waitFor(()=>expect(fetcher.mock.calls.some(([url])=>url.endsWith('/hangup'))).toBe(true));});
  it('distinguishes quota from request failures without leaking provider content',()=>{expect(realtimeProblem({type:'invalid_request_error',message:'private synthetic key'})).toMatchObject({code:'realtime_request_invalid'});expect(JSON.stringify(realtimeProblem({type:'invalid_request_error',message:'private synthetic key'}))).not.toContain('private synthetic');expect(realtimeProblem({code:'insufficient_quota'})).toMatchObject({code:'openai_billing_required'});});
});
