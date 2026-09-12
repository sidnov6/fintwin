import {afterEach,describe,expect,it,vi} from 'vitest';
import {client,testEnv} from './harness';

async function setup(){const {env}=testEnv({FINTWIN_DEMO_PASSPHRASE:'synthetic-test-passphrase',FINTWIN_ALLOW_PAID:'1',FINTWIN_VOICE_MODE:'chained',GROQ_API_KEY:'synthetic-key-not-real'});const app=client(env);await app.login();return app;}
afterEach(()=>vi.unstubAllGlobals());
describe('speech provider recovery (mock requests only)',()=>{
  it('returns an actionable terms code without exposing the upstream body',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:{code:'model_terms_required',message:'upstream private prompt and synthetic-key-not-real'}},{status:400})));
    const app=await setup(),result=await app.json('/v1/voice/synthesize',{method:'POST',body:JSON.stringify({language:'en',text:'A synthetic voice test.'})});
    expect(result).toMatchObject({status:403,code:'voice_terms_required'});expect(JSON.stringify(result)).not.toContain('synthetic-key-not-real');expect(JSON.stringify(result)).not.toContain('upstream private');
  });
  it('requests Hannah, bounds the request lifetime, and returns audio',async()=>{
    const upstream=vi.fn(async()=>new Response('synthetic-wave',{headers:{'content-type':'audio/wav'}}));vi.stubGlobal('fetch',upstream);
    const app=await setup(),result=await app.call('/v1/voice/synthesize',{method:'POST',body:JSON.stringify({language:'en',text:'A synthetic voice test.'})});
    expect(result.status).toBe(200);expect(result.headers.get('content-type')).toBe('audio/wav');
    const init=(upstream.mock.calls[0] as unknown as [string,RequestInit])[1];expect(JSON.parse(String(init.body))).toMatchObject({voice:'hannah',model:'canopylabs/orpheus-v1-english'});expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('does not leak arbitrary provider failures',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:{code:'other_error',message:'never show this private prompt'}},{status:400})));
    const app=await setup(),result=await app.json('/v1/voice/synthesize',{method:'POST',body:JSON.stringify({language:'en',text:'Test.'})});expect(result).toMatchObject({status:502,code:'provider_request_invalid'});expect(JSON.stringify(result)).not.toContain('private prompt');
  });
  it('does not send German text to the English-only voice',async()=>{
    const upstream=vi.fn();vi.stubGlobal('fetch',upstream);const app=await setup(),result=await app.call('/v1/voice/synthesize',{method:'POST',body:JSON.stringify({language:'de',text:'Stimme testen.'})});expect(result.status).toBe(422);expect(upstream).not.toHaveBeenCalled();
  });
});
