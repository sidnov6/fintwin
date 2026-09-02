/**
 * Persistence layer over the D1-style SQLite binding (`env.DB`).
 * Every read and write is scoped to a user id; nothing is shared between accounts.
 */
import type { Fact, FactKey, Facts, Lang } from "@fintwin/engine";
import { isFactKey, normalizeFactValue } from "@fintwin/engine";
import type { Card, Memory, Message, NextStep, Profile } from "@fintwin/contracts";

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
  GROQ_API_KEY?: string;
  GROQ_CHAT_MODEL?: string;
  GROQ_TTS_MODEL?: string;
  GROQ_TTS_VOICE?: string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY, email TEXT, name TEXT NOT NULL, net_worth_eur REAL NOT NULL DEFAULT 0, expectations TEXT NOT NULL DEFAULT '', bank_connected INTEGER NOT NULL DEFAULT 1, preferred_language TEXT NOT NULL DEFAULT 'de', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at)`,
  `CREATE TABLE IF NOT EXISTS conversation_turns (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, source_ids TEXT NOT NULL DEFAULT '[]', mode TEXT NOT NULL DEFAULT 'text', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_turns_user_created ON conversation_turns(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS user_facts (user_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, source TEXT NOT NULL, note TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, key))`,
  `CREATE TABLE IF NOT EXISTS user_memories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS user_next_steps (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_user_next_steps_user ON user_next_steps(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS scenario_runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, inputs_json TEXT NOT NULL, outputs_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
];
// Columns added after the first deployment; applied idempotently.
const COLUMN_UPGRADES: Array<[table: string, column: string, ddl: string]> = [
  ["user_profiles", "onboarding_done", "INTEGER NOT NULL DEFAULT 0"],
  ["user_profiles", "voice_autoplay", "INTEGER NOT NULL DEFAULT 1"],
  ["user_profiles", "sample_loaded", "INTEGER NOT NULL DEFAULT 0"],
  ["conversation_turns", "cards", "TEXT NOT NULL DEFAULT '[]'"],
  ["conversation_turns", "suggestions", "TEXT NOT NULL DEFAULT '[]'"],
  ["conversation_turns", "meta", "TEXT NOT NULL DEFAULT '{}'"],
];

const readiness = new WeakMap<D1Database, Promise<void>>();

export function db(env: Env): D1Database {
  if (!env.DB) throw new Error("Persistent storage is unavailable.");
  return env.DB;
}

export async function ensureSchema(env: Env): Promise<void> {
  const database = db(env);
  let ready = readiness.get(database);
  if (!ready) {
    ready = (async () => {
      await database.batch(SCHEMA.map(sql => database.prepare(sql)));
      for (const [table, column, ddl] of COLUMN_UPGRADES) {
        const columns = await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
        if (!(columns.results || []).some(row => row.name === column)) await database.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`).run();
      }
    })().catch(error => { readiness.delete(database); throw error; });
    readiness.set(database, ready);
  }
  await ready;
}

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

export async function upsertProfile(env: Env, userId: string, patch: Partial<Profile> & { name?: string }): Promise<Profile> {
  await ensureSchema(env);
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
  await db(env).prepare(`INSERT INTO user_profiles (user_id, email, name, net_worth_eur, expectations, bank_connected, preferred_language, onboarding_done, voice_autoplay, sample_loaded, created_at, updated_at) VALUES (?,?,?,0,'',1,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, name = excluded.name, preferred_language = excluded.preferred_language, onboarding_done = excluded.onboarding_done, voice_autoplay = excluded.voice_autoplay, sample_loaded = excluded.sample_loaded, updated_at = excluded.updated_at`)
    .bind(userId, next.email ?? null, next.name, next.language, next.onboardingDone ? 1 : 0, next.voiceAutoplay ? 1 : 0, next.sampleLoaded ? 1 : 0, next.createdAt, next.updatedAt).run();
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
  return facts;
}

export interface FactInput { key: string; value: unknown; note?: string }

/** Validates and stores facts. Returns the accepted facts and the keys that were rejected. */
export async function setFacts(env: Env, userId: string, inputs: FactInput[], source: Fact["source"]): Promise<{ accepted: Fact[]; rejected: string[] }> {
  await ensureSchema(env);
  const accepted: Fact[] = [], rejected: string[] = [], now = new Date().toISOString();
  for (const input of inputs) {
    if (!isFactKey(input.key)) { rejected.push(String(input.key)); continue; }
    const value = normalizeFactValue(input.key, input.value);
    if (value === null) { rejected.push(input.key); continue; }
    accepted.push({ key: input.key, value, source, updatedAt: now, note: input.note?.slice(0, 200) });
  }
  if (accepted.length) await db(env).batch(accepted.map(fact => db(env).prepare("INSERT INTO user_facts (user_id, key, value_json, source, note, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, source = excluded.source, note = excluded.note, updated_at = excluded.updated_at").bind(userId, fact.key, JSON.stringify(fact.value), fact.source, fact.note ?? null, fact.updatedAt)));
  return { accepted, rejected };
}

export async function deleteFacts(env: Env, userId: string, keys: FactKey[]): Promise<void> {
  await ensureSchema(env);
  if (keys.length) await db(env).batch(keys.map(key => db(env).prepare("DELETE FROM user_facts WHERE user_id = ? AND key = ?").bind(userId, key)));
}

// --- conversation -----------------------------------------------------------

interface TurnRow { id: string; role: Message["role"]; content: string; source_ids: string; mode: string; cards: string; suggestions: string; meta: string; created_at: string }

function parseJson<T>(raw: string | null | undefined, fallback: T): T { try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } }

export async function listMessages(env: Env, userId: string, limit = 40): Promise<Message[]> {
  await ensureSchema(env);
  const rows = await db(env).prepare("SELECT id, role, content, source_ids, mode, cards, suggestions, meta, created_at FROM (SELECT rowid AS seq, * FROM conversation_turns WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at ASC, seq ASC").bind(userId, limit).all<TurnRow>();
  return (rows.results || []).map(row => ({ id: row.id, role: row.role, text: row.content, cards: parseJson<Card[]>(row.cards, []), suggestions: parseJson<string[]>(row.suggestions, []), meta: parseJson<Message["meta"]>(row.meta, {}), sourceIds: parseJson<string[]>(row.source_ids, []), mode: row.mode as Message["mode"], createdAt: row.created_at }));
}

export async function saveMessage(env: Env, userId: string, message: Message): Promise<void> {
  await ensureSchema(env);
  await db(env).prepare("INSERT INTO conversation_turns (id, user_id, role, content, source_ids, mode, cards, suggestions, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(message.id, userId, message.role, message.text.slice(0, 12000), JSON.stringify(message.sourceIds ?? []), message.mode ?? "text", JSON.stringify(message.cards ?? []).slice(0, 60000), JSON.stringify(message.suggestions ?? []), JSON.stringify(message.meta ?? {}), message.createdAt).run();
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
export async function addMemory(env: Env, userId: string, text: string): Promise<Memory> {
  await ensureSchema(env);
  const memory: Memory = { id: crypto.randomUUID(), text: text.trim().slice(0, 300), createdAt: new Date().toISOString() };
  await db(env).prepare("INSERT INTO user_memories (id, user_id, text, created_at) VALUES (?,?,?,?)").bind(memory.id, userId, memory.text, memory.createdAt).run();
  return memory;
}

export async function listNextSteps(env: Env, userId: string): Promise<NextStep[]> {
  await ensureSchema(env);
  const rows = await db(env).prepare("SELECT id, text, done, created_at FROM user_next_steps WHERE user_id = ? ORDER BY done ASC, created_at ASC LIMIT 30").bind(userId).all<{ id: string; text: string; done: number; created_at: string }>();
  return (rows.results || []).map(row => ({ id: row.id, text: row.text, done: Boolean(row.done), createdAt: row.created_at }));
}
export async function addNextStep(env: Env, userId: string, text: string): Promise<NextStep> {
  await ensureSchema(env);
  const step: NextStep = { id: crypto.randomUUID(), text: text.trim().slice(0, 200), done: false, createdAt: new Date().toISOString() };
  await db(env).prepare("INSERT INTO user_next_steps (id, user_id, text, done, created_at) VALUES (?,?,?,0,?)").bind(step.id, userId, step.text, step.createdAt).run();
  return step;
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
export async function resetUser(env: Env, userId: string): Promise<void> {
  await ensureSchema(env);
  await db(env).batch(["user_profiles", "conversation_turns", "user_facts", "user_memories", "user_next_steps", "scenario_runs"].map(table => db(env).prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId)));
}

export type { Lang };
