import { db, type Env } from './db';
import { AppError } from './errors';

const rates = new Map<string, { count: number; until: number }>();
export function rateLimit(key: string, limit = 80) {
  const now = Date.now(), old = rates.get(key);
  const entry = old && old.until > now ? old : { count: 0, until: now + 60000 };
  entry.count++; rates.set(key, entry);
  if (rates.size > 5000) for (const [k,v] of rates) if (v.until <= now) rates.delete(k);
  if (entry.count > limit) throw new AppError('rate_limit', 429, 'Too many requests. Please wait a minute.');
}
export function assertOrigin(request: Request, env: Env) {
  const origin = request.headers.get('origin');
  const own = new URL(request.url).origin;
  if (origin && origin !== own && origin !== env.FINTWIN_ALLOWED_ORIGIN) throw new AppError('wrong_origin', 403, 'This request came from a different site.');
  if (request.headers.get('sec-fetch-site') === 'cross-site' && origin !== env.FINTWIN_ALLOWED_ORIGIN) throw new AppError('wrong_origin', 403);
  // API clients can omit Origin; browser mutations must be JSON or include the
  // explicit same-origin marker. Cross-site forms cannot set this header.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !request.headers.get('content-type')?.startsWith('application/json') && request.headers.get('x-fintwin-request') !== '1') throw new AppError('csrf', 403, 'Please reload before continuing.');
}
async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2,'0')).join(''); }

export function localOpen(request: Request, env: Env): boolean {
  return env.FINTWIN_LOCAL_OPEN === '1' && !env.FINTWIN_ALLOWED_ORIGIN
    && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url).hostname);
}

export async function viewer(request: Request, env: Env): Promise<string | null> {
  // Explicit verified-gateway deployment ONLY. Standalone host strips headers
  // and never enables this setting.
  if (env.FINTWIN_TRUST_PLATFORM === 'verified-gateway') {
    const id = request.headers.get('oai-authenticated-user-id');
    // Keep the original Sites identity key so existing profiles and history
    // remain attached to their owner after the session-auth upgrade.
    if (id) return id;
  }
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)fintwin_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  const row = await db(env).prepare('SELECT user_id FROM demo_sessions WHERE token_hash=? AND expires_at>?').bind(await digest(token), Date.now()).first<{user_id: string}>();
  return row?.user_id ?? null;
}
export async function login(request: Request, env: Env): Promise<Response> {
  assertOrigin(request, env);
  rateLimit('login:global', 20);
  if (!localOpen(request, env)) {
    const passphrase = env.FINTWIN_DEMO_PASSPHRASE;
    if (!passphrase || passphrase.length < 12) throw new AppError('gate_unconfigured', 503, 'The presenter must set FINTWIN_DEMO_PASSPHRASE (at least 12 characters) privately on the server.');
    const body = await request.json() as {passphrase?: unknown};
    const supplied = typeof body.passphrase === 'string' ? body.passphrase : '';
    if (await digest(supplied) !== await digest(passphrase)) throw new AppError('sign_in_failed', 401, 'That demo passphrase did not match.');
  }
  const old = await viewer(request, env);
  const userId = old ?? `demo:${crypto.randomUUID()}`;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
  await db(env).prepare('INSERT INTO demo_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await digest(token), userId, Date.now()+12*3600*1000).run();
  return Response.json({ok:true, data:{authenticated:true}}, { headers: { 'cache-control':'no-store', 'set-cookie':`fintwin_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` } });
}
export async function logout(request:Request,env:Env):Promise<Response>{
  const userId=await viewer(request,env);if(userId)await env.REALTIME?.stop(userId);
  const token=request.headers.get('cookie')?.match(/(?:^|;\s*)fintwin_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(token)await db(env).prepare('DELETE FROM demo_sessions WHERE token_hash=?').bind(await digest(token)).run();
  return Response.json({ok:true,data:{signedOut:true}},{headers:{'cache-control':'no-store','set-cookie':`fintwin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${new URL(request.url).protocol==='https:'?'; Secure':''}`}});
}
