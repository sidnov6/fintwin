import { db, type Env } from './db';
import { AppError } from './errors';

function limit(value: string | undefined, fallback: number) { const n = Number(value ?? fallback); return Number.isFinite(n) && n >= 0 ? n : 0; }
export function budgetLimits(env: Env) { return { session: limit(env.FINTWIN_SESSION_BUDGET_USD,25), total: limit(env.FINTWIN_TOTAL_BUDGET_USD,40), window: env.FINTWIN_BUDGET_WINDOW || 'interview-2026-09' }; }
export async function usageSummary(env: Env, userId: string) {
  const caps = budgetLimits(env);
  const row = await db(env).prepare('SELECT COALESCE(SUM(COALESCE(charged_usd,reserved_usd)),0) AS total, COALESCE(SUM(CASE WHEN user_id=? THEN COALESCE(charged_usd,reserved_usd) ELSE 0 END),0) AS session FROM usage_events WHERE window=?').bind(userId,caps.window).first<{total:number;session:number}>();
  return { currency:'USD', window:caps.window, sessionUsed:row?.session??0, totalUsed:row?.total??0, sessionLimit:caps.session,totalLimit:caps.total, remaining:Math.max(0,Math.min(caps.session-(row?.session??0),caps.total-(row?.total??0))), basis:'Conservative reservations and estimates; not a provider invoice. Unreported calls retain their reservation.' };
}
/** Atomic INSERT ... SELECT + CHECK reserves against session AND aggregate
 * usage before work. Crashed calls retain allowance; resets never touch it. */
export async function reserve(env: Env,userId:string,kind:string,provider:string,usd:number):Promise<string> {
  if (env.FINTWIN_ALLOW_PAID !== '1') throw new AppError('paid_disabled',503,'Live providers are disabled. Continue in text or ask the presenter to enable them.');
  if (!Number.isFinite(usd) || usd <= 0) throw new AppError('invalid_reservation');
  const caps=budgetLimits(env), id=crypto.randomUUID();
  try {
    await db(env).prepare(`INSERT INTO usage_events(id,user_id,window,kind,provider,reserved_usd,authorized,created_at)
      SELECT ?,?,?,?,?,?,CASE WHEN COALESCE(SUM(COALESCE(charged_usd,reserved_usd)),0)+? <= ? AND COALESCE(SUM(CASE WHEN user_id=? THEN COALESCE(charged_usd,reserved_usd) ELSE 0 END),0)+? <= ? THEN 1 ELSE 0 END,? FROM usage_events WHERE window=?`)
      .bind(id,userId,caps.window,kind,provider,usd,usd,caps.total,userId,usd,caps.session,new Date().toISOString(),caps.window).run();
    return id;
  } catch { throw new AppError('budget_exhausted',429,'The demo usage allowance is exhausted. Text, calculators and meeting briefs still work offline.'); }
}
export async function settle(env: Env,id:string,tokens:Record<string,number> | null, actualUsd?:number) {
  const safeTokens=tokens?Object.fromEntries(Object.entries(tokens).filter(([key,value])=>/^[a-z_]+$/.test(key)&&typeof value==='number'&&Number.isFinite(value)&&value>=0)):null;
  if(actualUsd!==undefined&&(!Number.isFinite(actualUsd)||actualUsd<0))throw new AppError('invalid_cost');
  // Only known pricing may release a reservation. No usage is NOT zero cost.
  await db(env).prepare('UPDATE usage_events SET charged_usd=?,basis=?,tokens_json=? WHERE id=?').bind(actualUsd ?? null,actualUsd === undefined ? (safeTokens ? 'provider_tokens_cost_unpriced' : 'unreported_reserved') : 'provider_tokens_estimated_cost', safeTokens ? JSON.stringify(safeTokens) : null,id).run();
}
