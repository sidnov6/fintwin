import {afterEach,expect,it,vi} from 'vitest';
import {chat} from './api';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();});
const json = (data: unknown, status = 200) => Response.json(status === 200 ? {ok:true,data} : {ok:false,error:'Sign in'}, {status});
it('preserves an existing session without another login', async () => {
  const fetcher = vi.fn().mockResolvedValue(json({revision:0,epoch:0}));
  vi.stubGlobal('fetch', fetcher);
  expect(await (await import('./api')).api.openState()).toEqual({revision:0,epoch:0});
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('opens the local demo automatically after the server opts in', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(json(null,401))
    .mockResolvedValueOnce(json({passphraseRequired:false}))
    .mockResolvedValueOnce(json({authenticated:true}))
    .mockResolvedValueOnce(json({revision:0,epoch:0}));
  vi.stubGlobal('fetch', fetcher);
  expect(await (await import('./api')).api.openState()).toEqual({revision:0,epoch:0});
  expect(fetcher.mock.calls.map(([url]) => String(url).replace(/^https?:\/\/[^/]+/, ''))).toEqual(['/v1/state','/v1/session','/v1/session','/v1/state']);
  expect(fetcher.mock.calls[2][1]).toMatchObject({method:'POST',body:'{}',credentials:'include'});
});
it.each([true, undefined])('does not bypass a protected or unknown session mode (%s)', async required => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(null,401)).mockResolvedValueOnce(json({passphraseRequired:required}));
  vi.stubGlobal('fetch', fetcher);
  await expect((await import('./api')).api.openState()).rejects.toMatchObject({status:401});
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not loop when the browser rejects a local cookie', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(null,401)).mockResolvedValueOnce(json({passphraseRequired:false}))
    .mockResolvedValueOnce(json({authenticated:true})).mockResolvedValueOnce(json(null,401));
  vi.stubGlobal('fetch', fetcher);
  await expect((await import('./api')).api.openState()).rejects.toMatchObject({status:401});
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('production ignores the development API URL and stays on the demo origin',async()=>{vi.resetModules();vi.stubEnv('NODE_ENV','production');vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:8787');expect((await import('./api')).API).toBe('');});
it('cleans up busy state and reports an incomplete SSE response',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: {"type":"delta","text":"partial"}\n\n')));const onError=vi.fn(),onFinally=vi.fn();chat('Hello','en','text',{onDelta:vi.fn(),onCard:vi.fn(),onState:vi.fn(),onDone:vi.fn(),onError,onFinally});await vi.waitFor(()=>expect(onFinally).toHaveBeenCalledOnce());expect(onError).toHaveBeenCalledOnce();});
it('replaces a failed partial response with the final fallback and terminates once',async()=>{const frames=[{type:'delta',text:'unfinished'},{type:'replace',text:'Clear fallback'},{type:'done',message:{id:'final',text:'Clear fallback'}}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join('');vi.stubGlobal('fetch',vi.fn(async()=>new Response(frames)));const onReplace=vi.fn(),onFinally=vi.fn(),onDone=vi.fn(),onError=vi.fn();chat('Hello','en','text',{onDelta:vi.fn(),onCard:vi.fn(),onState:vi.fn(),onDone,onError,onReplace,onFinally});await vi.waitFor(()=>expect(onFinally).toHaveBeenCalledOnce());expect(onReplace).toHaveBeenCalledWith('Clear fallback');expect(onDone).toHaveBeenCalledOnce();expect(onError).not.toHaveBeenCalled();});
