/** v3 intentionally rejects the old unsigned device-id fallback. Cookie refusal
 * is an actionable login error, never a reason to trust browser identity. */
import {beforeEach,describe,expect,it} from 'vitest';
import {client,testEnv} from './harness';
let env:ReturnType<typeof testEnv>['env'];
beforeEach(()=>{env=testEnv({FINTWIN_DEMO_PASSPHRASE:'synthetic-test-passphrase'}).env;});
describe('server-established identity',()=>{
  it('preserves the original hosted user key only behind the verified Sites gateway',async()=>{
    const hosted=testEnv({FINTWIN_TRUST_PLATFORM:'verified-gateway'});
    hosted.sqlite.prepare("INSERT INTO user_profiles(user_id,name,net_worth_eur,expectations,preferred_language,created_at,updated_at) VALUES ('legacy-owner','Alex',0,'','en','2026-01-01','2026-01-01')").run();
    const response=await client(hosted.env).json('/v1/state',{headers:{'oai-authenticated-user-id':'legacy-owner'}}) as {data:{profile:{name:string}}};
    expect(response.data.profile.name).toBe('Alex');
  });
  it('remembers the person across turns with an opaque session',async()=>{const a=client(env);await a.login();await a.say('Call me Sid');await a.say('I want to retire early.');expect((await a.state()).profile?.name).toBe('Sid');});
  it('keeps two signed-in browsers apart',async()=>{const a=client(env),b=client(env);await a.login();await b.login();await a.say('Call me Sid');expect((await b.state()).profile).toBeNull();});
  it('rejects absent or forged identity',async()=>{const a=client(env);expect((await a.call('/v1/state')).status).toBe(401);expect((await a.call('/v1/state',{headers:{'x-fintwin-device':crypto.randomUUID(),'oai-authenticated-user-id':'forged'}})).status).toBe(401);});
  it('does not let forged platform headers override an authenticated session',async()=>{const a=client(env);await a.login();await a.say('Call me Anna');const response=await a.json('/v1/state',{headers:{'oai-authenticated-user-id':'someone-else'}}) as {data:{profile:{name:string}}};expect(response.data.profile.name).toBe('Anna');});
});
