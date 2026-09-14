/**
 * Persistence layer over the D1-style SQLite binding (`env.DB`).
 * Every read and write is scoped to a user id; nothing is shared between accounts.
 */
import type { Fact, FactKey, Facts, Lang } from "@fintwin/engine";
import { isFactKey, normalizeFactValue } from "@fintwin/engine";
import type { Card, Memory, Message, NextStep, Profile } from "@fintwin/contracts";
import { AppError } from "./errors";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Database { prepare(sql: string): D1PreparedStatement; batch(statements: D1PreparedStatement[]): Promise<unknown> }

export interface Env {
  DB?: D1Database;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  // Chat: Groq by default, or any OpenAI-compatible endpoint via LLM_*.
  GROQ_API_KEY?: string;
  GROQ_CHAT_MODEL?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_REASONING_EFFORT?: string;
  LLM_MAX_TOKENS?: string;
  // Speech in / out.
  GROQ_STT_MODEL?: string;
  GROQ_TTS_MODEL?: string;
  GROQ_TTS_VOICE?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_STT_MODEL?: string;
  ELEVENLABS_TTS_MODEL?: string;
  ELEVENLABS_VOICE_ID?: string;
  FINTWIN_DEMO_PASSPHRASE?: string;
  FINTWIN_LOCAL_OPEN?: string;
  FINTWIN_TRUST_PLATFORM?: string;
  FINTWIN_ALLOWED_ORIGIN?: string;
  FINTWIN_ALLOW_PAID?: string;
  FINTWIN_VOICE_MODE?: string;
  FINTWIN_SESSION_BUDGET_USD?: string;
  FINTWIN_TOTAL_BUDGET_USD?: string;
  FINTWIN_BUDGET_WINDOW?: string;
  FINTWIN_REALTIME_MAX_SECONDS?: string;
  FINTWIN_REALTIME_IDLE_SECONDS?: string;
  FINTWIN_REALTIME_MAX_RESPONSES?: string;
  FINTWIN_REALTIME_RESERVE_USD?: string;
  OPENAI_API_KEY?: string;
  OPENAI_CHAT_MODEL?: string;
  OPENAI_REASONING_EFFORT?: string;
  OPENAI_STT_MODEL?: string;
  OPENAI_TTS_MODEL?: string;
  OPENAI_TTS_VOICE?: string;
  OPENAI_REALTIME_MODEL?: string;
  OPENAI_REALTIME_VOICE?: string;
  LLM_TOKEN_FIELD?: string;
  LLM_ALLOW_TEMPERATURE?: string;
  REALTIME?: { handle(request: Request, userId: string): Promise<Response>; sync(userId: string): Promise<void>; stop(userId: string): Promise<void> };
  TEXT_SMOKE?:()=>{status:string;at:string|null;kind:string;model?:string|null};
}

export function db(env: Env): D1Database {
  if (!env.DB) throw new Error("Persistent storage is unavailable.");
  return env.DB;
}

/** Schema is owned by generated migrations, applied before the host starts. */
export async function ensureSchema(env: Env): Promise<void> { db(env); }

// --- profile ----------------------------------------------------------------

interface ProfileRow { email: string | null; name: string; expectations: string; preferred_language: string; onboarding_done: number; voice_autoplay: number; sample_loaded: number; created_at: string; updated_at: string }

function profileFromRow(row: ProfileRow | null): Profile | null {
  if (!row) return null;
  return { name: row.name, email: row.email || undefined, language: row.preferred_language === "en" ? "en" : "de", onboardingDone: Boolean(row.onboarding_done), voiceAutoplay: Boolean(row.voice_autoplay), sampleLoaded: Boolean(row.sample_loaded), createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function getProfile(env: Env, userId: string): Promise<Profile | null> {
  await ensureSchema(env);
  const row = await db(env).prepare("SELECT email, name, expectations, preferred_language, onboarding_done, voice_autoplay, sample_loaded, created_at, updated_at FROM user_profiles WHERE user_id = ?").bind(userId).first<ProfileRow>();
  const profile = profileFromRow(row);
  // One-time migration from the previous onboarding: expectations become the primary goal.
  if (profile && row?.expectations && !(await getFacts(env, userId)).goal_primary) {
    await setFacts(env, userId, [{ key: "goal_primary", value: row.expectations }], "user");
    await db(env).prepare("UPDATE user_profiles SET expectations = '' WHERE user_id = ?").bind(userId).run();
  }
  return profile;
}

export async function upsertProfile(env: Env, userId: string, patch: Partial<Profile> & { name?: string }, context?:MutationContext): Promise<Profile> {
  await ensureSchema(env);
  const head=await getHead(env,userId);
  const current = await getProfile(env, userId);
  const now = new Date().toISOString();
  const next: Profile = {
    name: (patch.name ?? current?.name ?? "").trim().slice(0, 80),
    email: patch.email ?? current?.email,
    language: patch.language ?? current?.language ?? "de",
    onboardingDone: patch.onboardingDone ?? current?.onboardingDone ?? false,
    voiceAutoplay: patch.voiceAutoplay ?? current?.voiceAutoplay ?? true,
    sampleLoaded: patch.sampleLoaded ?? current?.sampleLoaded ?? false,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  const statement=db(env).prepare(`INSERT INTO user_profiles (user_id, email, name, net_worth_eur, expectations, bank_connected, preferred_language, onboarding_done, voice_autoplay, sample_loaded, created_at, updated_at) VALUES (?,?,?,0,'',1,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, name = excluded.name, preferred_language = excluded.preferred_language, onboarding_done = excluded.onboarding_done, voice_autoplay = excluded.voice_autoplay, sample_loaded = excluded.sample_loaded, updated_at = excluded.updated_at`)
    .bind(userId, next.email ?? null, next.name, next.language, next.onboardingDone ? 1 : 0, next.voiceAutoplay ? 1 : 0, next.sampleLoaded ? 1 : 0, next.createdAt, next.updatedAt);
  await atomic(env,userId,context??{id:crypto.randomUUID(),expectedRevision:head.revision,epoch:head.epoch},next,[statement],false);
  return next;
}

// --- facts ------------------------------------------------------------------

export async function getFacts(env: Env, userId: string): Promise<Facts> {
  await ensureSchema(env);
  const rows = await db(env).prepare("SELECT key, value_json, source, note, updated_at FROM user_facts WHERE user_id = ?").bind(userId).all<{ key: string; value_json: string; source: Fact["source"]; note: string | null; updated_at: string }>();
  const facts: Facts = {};
  for (const row of rows.results || []) {
    if (!isFactKey(row.key)) continue;
    try { facts[row.key] = { key: row.key, value: JSON.parse(row.value_json), source: row.source, updatedAt: row.updated_at, note: row.note ?? undefined }; } catch { /* skip corrupt row */ }
  }
  const provenance = await db(env).prepare("SELECT key, json FROM fact_provenance WHERE user_id=?").bind(userId).all<{ key: FactKey; json: string }>();
  for (const row of provenance.results ?? []) if (facts[row.key]) facts[row.key]!.provenance = parseJson(row.json, undefined);
  return facts;
}

export interface FactInput { key: string; value: unknown; note?: string; provenance?: Fact["provenance"] }
export interface Head { revision: number; epoch: number; active_turn: string }
export interface MutationContext { id: string; expectedRevision: number; epoch: number; turnId?: string }
export async function getHead(env: Env, userId: string): Promise<Head> {
  await db(env).prepare("INSERT OR IGNORE INTO household_heads(user_id) VALUES (?)").bind(userId).run();
  return (await db(env).prepare("SELECT revision, epoch, active_turn FROM household_heads WHERE user_id=?").bind(userId).first<Head>())!;
}
export async function beginTurn(env: Env, userId: string, id: string, signal?:AbortSignal,expectedEpoch?:number): Promise<Head> {
  if(signal?.aborted)throw new AppError('superseded',409);
  const head=await getHead(env, userId);
  if(signal?.aborted||(expectedEpoch!==undefined&&head.epoch!==expectedEpoch))throw new AppError('superseded',409);
  await atomic(env,userId,{id:`begin:${id}`,expectedRevision:head.revision,epoch:head.epoch},{began:id},[db(env).prepare("UPDATE household_heads SET active_turn=? WHERE user_id=?").bind(id, userId)],false);
  return getHead(env, userId);
}
export async function receipt<T>(env: Env, userId: string, id: string): Promise<T | null> {
  const row = await db(env).prepare("SELECT result_json FROM mutation_receipts WHERE user_id=? AND id=?").bind(userId, id).first<{result_json: string}>();
  return row ? JSON.parse(row.result_json) as T : null;
}
/** The CHECK constraint is the compare-and-swap guard. D1 batch and the Node
 * adapter roll the whole operation back if a revision/turn is superseded. */
export async function atomic<T>(env: Env, userId: string, ctx: MutationContext, result: T, statements: D1PreparedStatement[], advance = true): Promise<T> {
  const previous = await receipt<T>(env, userId, ctx.id);
  if (previous) return previous;
  const database = db(env);
  try {
    await database.batch([
      database.prepare("INSERT INTO mutation_receipts(user_id,id,valid,result_json,created_at) VALUES (?,?,(SELECT CASE WHEN revision=? AND epoch=? AND (?='' OR active_turn=?) THEN 1 ELSE 0 END FROM household_heads WHERE user_id=?),?,?)")
        .bind(userId, ctx.id, ctx.expectedRevision, ctx.epoch, ctx.turnId ?? "", ctx.turnId ?? "", userId, JSON.stringify(result), new Date().toISOString()),
      ...statements,
      ...(advance ? [database.prepare("UPDATE household_heads SET revision=revision+1 WHERE user_id=?").bind(userId)] : []),
    ]);
    return result;
  } catch {
    const repeated = await receipt<T>(env, userId, ctx.id);
    if (repeated) return repeated;
    throw new AppError("state_changed", 409, "Your picture changed. Refresh it before applying this change.");
  }
}

/** Validates and stores facts. Returns the accepted facts and the keys that were rejected. */
export async function setFacts(env: Env, userId: string, inputs: FactInput[], source: Fact["source"], context?: MutationContext,remove:FactKey[]=[]): Promise<{ accepted: Fact[]; rejected: string[] }> {
  await ensureSchema(env);
  const head = await getHead(env, userId);
  const ctx = context ?? { id: crypto.randomUUID(), expectedRevision: head.revision, epoch: head.epoch };
  const previous = await receipt<{accepted: Fact[]; rejected: string[]}>(env, userId, ctx.id);
  if (previous) return previous;
  const accepted: Fact[] = [], rejected: string[] = [], now = new Date().toISOString();
  for (const input of inputs) {
    if (!isFactKey(input.key)) { rejected.push(String(input.key)); continue; }
    const value = normalizeFactValue(input.key, input.value);
    if (value === null) { rejected.push(input.key); continue; }
    accepted.push({ key: input.key, value, source, updatedAt: now, note: input.note?.slice(0, 200), provenance: { ...input.provenance, revision: ctx.expectedRevision + 1, sourceTurnId: ctx.turnId ?? ctx.id } });
  }
  if (accepted.length || remove.length) return atomic(env, userId, ctx, { accepted, rejected }, [...accepted.flatMap(fact => [
    db(env).prepare("INSERT INTO user_facts (user_id, key, value_json, source, note, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, source = excluded.source, note = excluded.note, updated_at = excluded.updated_at").bind(userId, fact.key, JSON.stringify(fact.value), fact.source, fact.note ?? null, fact.updatedAt),
    db(env).prepare("INSERT INTO fact_provenance(user_id,key,json) VALUES (?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET json=excluded.json").bind(userId, fact.key, JSON.stringify(fact.provenance)),
  ]),...remove.flatMap(key=>[db(env).prepare('DELETE FROM user_facts WHERE user_id=? AND key=?').bind(userId,key),db(env).prepare('DELETE FROM fact_provenance WHERE user_id=? AND key=?').bind(userId,key)])]);
  return { accepted, rejected };
}

export async function deleteFacts(env: Env, userId: string, keys: FactKey[], context?: MutationContext): Promise<void> {
  await ensureSchema(env);
  const head = await getHead(env, userId);
  if (keys.length) await atomic(env, userId, context ?? { id: crypto.randomUUID(), expectedRevision: head.revision, epoch: head.epoch }, { removed: keys }, keys.flatMap(key => [db(env).prepare("DELETE FROM user_facts WHERE user_id = ? AND key = ?").bind(userId, key), db(env).prepare("DELETE FROM fact_provenance WHERE user_id=? AND key=?").bind(userId,key)]));
}

// --- conversation -----------------------------------------------------------

interface TurnRow { id: string; role: Message["role"]; content: string; source_ids: string; mode: string; cards: string; suggestions: string; meta: string; created_at: string }

function parseJson<T>(raw: string | null | undefined, fallback: T): T { try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } }

export async function listMessages(env: Env, userId: string, limit = 40): Promise<Message[]> {
  await ensureSchema(env);
  const rows = await db(env).prepare("SELECT id, role, content, source_ids, mode, cards, suggestions, meta, created_at FROM (SELECT rowid AS seq, * FROM conversation_turns WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at ASC, seq ASC").bind(userId, limit).all<TurnRow>();
  return (rows.results || []).map(row => ({ id: row.id, role: row.role, text: row.content, cards: parseJson<Card[]>(row.cards, []), suggestions: parseJson<string[]>(row.suggestions, []), meta: parseJson<Message["meta"]>(row.meta, {}), sourceIds: parseJson<string[]>(row.source_ids, []), mode: row.mode as Message["mode"], createdAt: row.created_at }));
}

export async function saveMessage(env: Env, userId: string, message: Message, context?:MutationContext): Promise<void> {
  await ensureSchema(env);
  const statement=db(env).prepare("INSERT OR IGNORE INTO conversation_turns (id, user_id, role, content, source_ids, mode, cards, suggestions, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(message.id, userId, message.role, message.text.slice(0, 12000), JSON.stringify(message.sourceIds ?? []), message.mode ?? "text", JSON.stringify(message.cards ?? []), JSON.stringify(message.suggestions ?? []), JSON.stringify(message.meta ?? {}), message.createdAt);
  const head=await getHead(env,userId);
  await atomic(env,userId,context??{id:`message:${message.id}`,expectedRevision:head.revision,epoch:head.epoch},{saved:message.id},[statement],false);
}

export async function deleteMessage(env: Env, userId: string, id: string): Promise<void> {
  await ensureSchema(env);
  await db(env).prepare("DELETE FROM conversation_turns WHERE user_id = ? AND id = ?").bind(userId, id).run();
}

// --- memories & next steps ----------------------------------------------------

export async function listMemories(env: Env, userId: string): Promise<Memory[]> {
  await ensureSchema(env);
  const rows = await db(env).prepare("SELECT id, text, created_at FROM user_memories WHERE user_id = ? ORDER BY created_at ASC LIMIT 60").bind(userId).all<{ id: string; text: string; created_at: string }>();
  return (rows.results || []).map(row => ({ id: row.id, text: row.text, createdAt: row.created_at }));
}
export async function addMemory(env: Env, userId: string, text: string, context?:MutationContext): Promise<Memory> {
  await ensureSchema(env);
  const memory: Memory = { id: crypto.randomUUID(), text: text.trim().slice(0, 300), createdAt: new Date().toISOString() };
  const head=await getHead(env,userId),previous=(await listMemories(env,userId)).find(m=>m.text.toLocaleLowerCase()===memory.text.toLocaleLowerCase());
  if(previous)return previous;
  return atomic(env,userId,context??{id:crypto.randomUUID(),expectedRevision:head.revision,epoch:head.epoch},memory,[db(env).prepare("INSERT INTO user_memories (id, user_id, text, created_at) VALUES (?,?,?,?)").bind(memory.id, userId, memory.text, memory.createdAt)]);
}

export async function listNextSteps(env: Env, userId: string): Promise<NextStep[]> {
  await ensureSchema(env);
  const rows = await db(env).prepare("SELECT id, text, done, created_at FROM user_next_steps WHERE user_id = ? ORDER BY done ASC, created_at ASC LIMIT 30").bind(userId).all<{ id: string; text: string; done: number; created_at: string }>();
  return (rows.results || []).map(row => ({ id: row.id, text: row.text, done: Boolean(row.done), createdAt: row.created_at }));
}
export async function addNextStep(env: Env, userId: string, text: string, context?:MutationContext): Promise<NextStep> {
  await ensureSchema(env);
  const step: NextStep = { id: crypto.randomUUID(), text: text.trim().slice(0, 200), done: false, createdAt: new Date().toISOString() };
  const head=await getHead(env,userId),previous=(await listNextSteps(env,userId)).find(s=>s.text.toLocaleLowerCase()===step.text.toLocaleLowerCase());
  if(previous)return previous;
  return atomic(env,userId,context??{id:crypto.randomUUID(),expectedRevision:head.revision,epoch:head.epoch},step,[db(env).prepare("INSERT INTO user_next_steps (id, user_id, text, done, created_at) VALUES (?,?,?,0,?)").bind(step.id, userId, step.text, step.createdAt)]);
}
export async function setNextStepDone(env: Env, userId: string, id: string, done: boolean): Promise<void> {
  await ensureSchema(env);
  await db(env).prepare("UPDATE user_next_steps SET done = ? WHERE user_id = ? AND id = ?").bind(done ? 1 : 0, userId, id).run();
}
export async function deleteNextStep(env: Env, userId: string, id: string): Promise<void> {
  await ensureSchema(env);
  await db(env).prepare("DELETE FROM user_next_steps WHERE user_id = ? AND id = ?").bind(userId, id).run();
}

export async function saveScenarioRun(env: Env, userId: string, kind: string, inputs: unknown, outputs: unknown): Promise<string> {
  await ensureSchema(env);
  const id = crypto.randomUUID();
  await db(env).prepare("INSERT INTO scenario_runs (id, user_id, kind, inputs_json, outputs_json, created_at) VALUES (?,?,?,?,?,?)").bind(id, userId, kind, JSON.stringify(inputs), JSON.stringify(outputs).slice(0, 20000), new Date().toISOString()).run();
  return id;
}

/** Removes everything the user has stored. Explicit user action only. */
export async function resetUser(env: Env, userId: string, context?:MutationContext): Promise<void> {
  await ensureSchema(env);
  const head=await getHead(env,userId);
  await atomic(env,userId,context??{id:crypto.randomUUID(),expectedRevision:head.revision,epoch:head.epoch},{reset:true},[
    ...["user_profiles", "conversation_turns", "user_facts", "fact_provenance", "user_memories", "user_next_steps"].map(table => db(env).prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId)),
    db(env).prepare("UPDATE household_heads SET epoch=epoch+1,active_turn='' WHERE user_id=?").bind(userId),
  ]);
}

export type { Lang };
