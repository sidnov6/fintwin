import {afterEach,describe,expect,it,vi} from 'vitest';
import {chatProvider,speechInProvider,speechOutProvider,groqFallback} from '../src/providers';
import {textCost,realtimeCost} from '../src/pricing';
import {transcribe} from '../src/voice';
import {client,testEnv} from './harness';
import {usageSummary} from '../src/budget';
import {responsesRound} from '../src/openai-responses';
import {liveFailureMessage} from '../src/chat';
import {AppError} from '../src/errors';
import {primarySmokeFailure} from '../../scripts/smoke-result.mjs';

const config={FINTWIN_DEMO_PASSPHRASE:'synthetic-test-passphrase',FINTWIN_ALLOW_PAID:'1',FINTWIN_VOICE_MODE:'realtime',OPENAI_API_KEY:'synthetic-openai',GROQ_API_KEY:'synthetic-groq'};
const stream=(text:string,finish=true,usage?:object)=>new Response(`data: ${JSON.stringify({choices:[{delta:{content:text},...(finish?{finish_reason:'stop'}:{})}],usage})}\n\ndata: [DONE]\n\n`);
const responses=(text:string,output:object[]=[],usage?:object,complete=true)=>new Response([
  {type:'response.output_text.delta',delta:text},
  ...(complete?[{type:'response.completed',response:{status:'completed',output:[...output,...(text?[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]:[])],usage}}]:[]),
].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
afterEach(()=>vi.restoreAllMocks());

describe('OpenAI primary and explicit recovery — mocked traffic only',()=>{
  it('selects GPT-5.4, OpenAI transcription and multilingual Marin; preserves Groq',()=>{
    const primary=chatProvider(config)!;
    expect(primary).toMatchObject({id:'api.openai.com',model:'gpt-5.4',tokenField:'max_completion_tokens',reasoningEffort:'none',verbosity:'low',temperature:false});
    expect(groqFallback(config,primary)).toMatchObject({id:'groq',apiKey:'synthetic-groq'});
    expect(speechInProvider(config)).toMatchObject({id:'openai',model:'gpt-4o-mini-transcribe'});
    expect(speechOutProvider(config)).toMatchObject({id:'openai',model:'gpt-4o-mini-tts',voice:'marin',languages:'multilingual'});
    expect(chatProvider({...config,LLM_API_KEY:'custom',LLM_BASE_URL:'https://custom.example/v1'})).toBeNull();
    expect(chatProvider({...config,LLM_API_KEY:'custom',LLM_BASE_URL:'https://api.openai.com/v1',LLM_MODEL:'custom-model'})?.protocol).toBeUndefined();
  });
  it('uses the primary credential, supported parameters, metadata and priced usage',async()=>{
    const {env}=testEnv(config),app=client(env);await app.login();
    const spy=vi.spyOn(globalThis,'fetch').mockResolvedValue(responses('Thanks Alex. What matters most to you?',[],{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:40}}));
    const result=await app.say('My name is Alex. My income is 5000 net monthly.');
    expect(spy).toHaveBeenCalledOnce();const [url,init]=spy.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-openai');
    const payload=JSON.parse(String(init?.body));expect(payload).toMatchObject({model:'gpt-5.4',max_output_tokens:3500,reasoning:{effort:'none'},text:{verbosity:'low'},stream:true,store:false});expect(payload).not.toHaveProperty('temperature');expect(payload).not.toHaveProperty('reasoning_effort');expect(payload).not.toHaveProperty('messages');expect(payload.tools[0]).toMatchObject({type:'function',strict:false});
    expect(result.message?.meta).toMatchObject({origin:'live',provider:'api.openai.com',model:'gpt-5.4'});
    expect((await usageSummary(env,'unused')).totalUsed).toBeCloseTo(.00046);
  });
  it('preserves explicit reasoning and does not guess latency capabilities for other models',()=>{
    expect(chatProvider({...config,OPENAI_REASONING_EFFORT:'low'})?.reasoningEffort).toBe('low');
    expect(chatProvider({...config,OPENAI_REASONING_EFFORT:'invalid'})?.reasoningEffort).toBe('none');
    const other=chatProvider({...config,OPENAI_CHAT_MODEL:'pinned-other-model'});
    expect(other?.reasoningEffort).toBe('low');expect(other?.verbosity).toBeUndefined();
    expect(groqFallback(config,chatProvider(config)!)?.reasoningEffort).toBe('medium');
  });
  it('uses short spoken delivery without dropping tool or affordability requirements',async()=>{
    const {env}=testEnv(config),app=client(env);await app.login();
    const spy=vi.spyOn(globalThis,'fetch').mockResolvedValue(responses('What would you like to explore?'));
    await app.say('Explain how this works.','en',{mode:'voice'});
    const payload=JSON.parse(String(spy.mock.calls[0][1]?.body));
    expect(payload.input[0]).toMatchObject({role:'system',content:expect.stringContaining('short first sentence')});
    expect(payload.input[0].content).toContain('monthly shortfall');
    expect(payload.tools.length).toBeGreaterThan(0);
  });
  it('removes a partial primary reply, labels Groq, and does not repeat intake writes',async()=>{
    const {env}=testEnv(config),app=client(env);await app.login();
    const spy=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(responses('An unfinished primary sentence must disappear completely',[],undefined,false)).mockResolvedValueOnce(stream('Thanks Alex. What would you like to work toward?'));
    const result=await app.say('My name is Alex. My income is 5000 net monthly.');
    expect(spy).toHaveBeenCalledTimes(2);expect(spy.mock.calls[1][0]).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(new Headers(spy.mock.calls[1][1]?.headers).get('authorization')).toBe('Bearer synthetic-groq');
    expect(result.events.some(e=>e.type==='replace')).toBe(true);expect(result.message?.text).not.toContain('unfinished');
    expect(result.message?.meta).toMatchObject({origin:'live',provider:'groq',fallbackFrom:'api.openai.com'});expect((await app.state()).revision).toBe(1);
  });
  it('does not bypass local allowances by trying the backup',async()=>{
    const {env}=testEnv({...config,FINTWIN_SESSION_BUDGET_USD:'0'}),app=client(env);await app.login();const spy=vi.spyOn(globalThis,'fetch');
    const result=await app.say('My name is Alex.');expect(spy).not.toHaveBeenCalled();expect(result.message?.meta?.origin).toBe('fallback');
    expect(result.message?.text).toContain('separate from your OpenAI balance');expect(result.message?.meta?.failureCode).toBe('budget_exhausted');
  });
  it('replays reasoning and tool output through Responses without exposing reasoning to the client',async()=>{
    const {env}=testEnv(config),app=client(env);await app.login();
    const reasoning={type:'reasoning',id:'rs_test',summary:[],encrypted_content:'opaque-private-reasoning'};
    const call={type:'function_call',id:'fc_test',call_id:'call_test',name:'read_household',arguments:'{}'};
    const spy=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(responses('',[reasoning,call])).mockResolvedValueOnce(responses('What would you like to work toward?'));
    const result=await app.say('My name is Alex.');expect(result.message?.meta?.provider).toBe('api.openai.com');
    const next=JSON.parse(String(spy.mock.calls[1][1]?.body));expect(next.input).toEqual(expect.arrayContaining([reasoning,call,expect.objectContaining({type:'function_call_output',call_id:'call_test'})]));
    expect(result.raw).not.toContain('opaque-private-reasoning');expect(result.raw).not.toContain('rs_test');
  });
  it.each(['response.failed','response.incomplete','error'])('rejects %s without executing partial tool calls',async type=>{
    const spy=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(`data: ${JSON.stringify({type,response:{status:'failed',output:[{type:'function_call',name:'propose_facts'}]}})}\n\n`));
    await expect(responsesRound(config,chatProvider(config)!,[],()=>{})).rejects.toMatchObject({code:'provider_response_failed'});expect(spy).toHaveBeenCalledOnce();
  });
  it('handles fragmented UTF-8 and a terminal frame without a trailing newline',async()=>{
    const raw=new TextEncoder().encode(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Grüße, €18.000.'}]}]}})}`);
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new ReadableStream({start(c){for(const byte of raw)c.enqueue(new Uint8Array([byte]));c.close();}})));
    expect((await responsesRound(config,chatProvider(config)!,[],()=>{})).text).toBe('Grüße, €18.000.');
  });
  it.each(['en','de'])('distinguishes invalid requests from billing without echoing upstream content in %s',async language=>{
    const {env}=testEnv({...config,GROQ_API_KEY:undefined}),app=client(env);await app.login();
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({error:{param:'reasoning_effort',message:'secret synthetic-openai'}},{status:400}));
    const result=await app.say('My name is Alex.',language);expect(result.message?.meta?.failureCode).toBe('provider_request_invalid');expect(result.message?.text).toContain(language==='de'?'Integrationsfehler':'integration error');expect(result.raw).not.toContain('synthetic-openai');
    expect(liveFailureMessage(new AppError('openai_billing_required'),language as 'en'|'de')).toContain(language==='de'?'Abrechnungs':'billing');
  });
  it('never counts backup, empty, or offline replies as a primary smoke pass',()=>{
    const primary={live:true,provider:'api.openai.com',model:'gpt-5.4'};
    const message={text:'Hello',meta:{origin:'live',provider:'api.openai.com',model:'gpt-5.4'}};
    expect(primarySmokeFailure(message,primary)).toBeNull();
    expect(primarySmokeFailure({...message,meta:{...message.meta,provider:'groq',fallbackFrom:'api.openai.com'}},primary)).toBe('backup_not_primary');
    expect(primarySmokeFailure({...message,text:''},primary)).toBe('empty_reply');
    expect(primarySmokeFailure({...message,meta:{origin:'fallback'}},primary)).toBe('fallback_not_live');
  });
  it.each(['en','de'])('uses Marin for %s with the primary credential',async language=>{
    const {env}=testEnv(config),app=client(env);await app.login();
    const spy=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('synthetic audio'));
    const response=await app.call('/v1/voice/synthesize',{method:'POST',body:JSON.stringify({language,text:'A synthetic test.'})});expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('audio/mpeg');
    const [url,init]=spy.mock.calls[0];expect(url).toBe('https://api.openai.com/v1/audio/speech');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-openai');expect(JSON.parse(String(init?.body))).toMatchObject({model:'gpt-4o-mini-tts',voice:'marin',response_format:'mp3'});
    expect(JSON.parse(String(init?.body)).instructions).toContain(language==='de'?'German':'English');
  });
  it('transcribes recordings through OpenAI in the selected language',async()=>{
    const spy=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({text:'Mein Name ist Alex.'}));
    const form=new FormData();form.set('audio',new File(['synthetic audio'],'sample.webm',{type:'audio/webm'}));form.set('language','de');
    const response=await transcribe(new Request('https://fintwin.test/voice',{method:'POST',body:form}),config);
    expect(await response.json()).toMatchObject({data:{transcript:'Mein Name ist Alex.',provider:'openai'}});
    expect(spy.mock.calls[0][0]).toBe('https://api.openai.com/v1/audio/transcriptions');expect((spy.mock.calls[0][1]?.body as FormData).get('model')).toBe('gpt-4o-mini-transcribe');
  });
  it.each(['en','de'])('discards a hallucinated transcription prompt in %s',async language=>{
    vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>Response.json({text:`context: ###\n${(init?.body as FormData).get('prompt')}\n###`}));
    const form=new FormData();form.set('audio',new File(['synthetic audio'],'sample.webm',{type:'audio/webm'}));form.set('language',language);
    const response=await transcribe(new Request('https://fintwin.test/voice',{method:'POST',body:form}),config);
    expect(await response.json()).toMatchObject({data:{transcript:'',provider:'openai'}});
  });
  it.each([{code:'insufficient_quota'},{code:'credit_balance_exhausted',type:'insufficient_quota'},{code:'billing_hard_limit_reached'},{type:'insufficient_quota'}])('shows an actionable billing error without retrying quota failures or leaking content: %j',async error=>{
    const {env}=testEnv(config),app=client(env);await app.login();
    const spy=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({error:{...error,message:'private prompt synthetic-openai'}},{status:429}));
    const response=await app.json('/v1/voice/synthesize',{method:'POST',body:JSON.stringify({text:'Test.',language:'en'})});expect(response).toMatchObject({status:402,code:'openai_billing_required'});expect(spy).toHaveBeenCalledOnce();expect(JSON.stringify(response)).not.toContain('synthetic-openai');
  });
});

describe('versioned conservative pricing estimates',()=>{
  it('prices text input, cached input and output separately',()=>expect(textCost('gpt-5.4',{prompt_tokens:100000,completion_tokens:1000,prompt_tokens_details:{cached_tokens:20000}})).toBeCloseTo(.22));
  it.each([null,{}, {prompt_tokens:-1,completion_tokens:1},{prompt_tokens:300000,completion_tokens:1},{prompt_tokens:2,completion_tokens:1,prompt_tokens_details:{cached_tokens:3}}])('retains the reservation on invalid or unpriced text usage',usage=>expect(textCost('gpt-5.4',usage)).toBeUndefined());
  it('does not guess prices for custom model names',()=>expect(textCost('custom',{prompt_tokens:10,completion_tokens:10})).toBeUndefined());
  const usage={input_tokens:1600,output_tokens:1400,input_token_details:{text_tokens:1000,audio_tokens:600,cached_tokens:500,cached_tokens_details:{text_tokens:300,audio_tokens:200}},output_token_details:{text_tokens:200,audio_tokens:1200}};
  it('prices Realtime cached modalities, audio and text at their distinct rates',()=>expect(realtimeCost('gpt-realtime-2.1',usage)).toBeCloseTo(.0974));
  it('includes hidden non-audio output at the text rate',()=>expect(realtimeCost('gpt-realtime-2.1',{...usage,output_tokens:1500})).toBeCloseTo(.0998));
  it.each([null,{}, {input_tokens:1,output_tokens:1}, {...usage,input_tokens:1}, {...usage,output_tokens:1}])('retains unknown or malformed Realtime reservations',input=>expect(realtimeCost('gpt-realtime-2.1',input)).toBeUndefined());
});
