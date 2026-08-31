const SHARED_DEMO_CONTEXT = {
  household: "Shared synthetic demo household feed",
  as_of: "2026-08-30T10:00:00+02:00",
  data_boundary: "The transaction feed is fictional and identical for every FinTwin demo account. The declared name, net worth and expectations belong to the signed-in user.",
  financial_snapshot: {
    net_household_income_monthly_eur: 7240,
    external_outflows_august_eur: 6672,
    free_cashflow_august_eur: 568,
    emergency_runway_months: 7.8,
    transaction_count: 7666,
    history_months: 60,
    source_ids: ["agg_cashflow_202608", "transfer_matches_202608", "shared_demo_ledger"],
  },
  recurring_costs: {
    items: [
      { name: "Immobilienrate", monthly_eur: 1420 },
      { name: "Krankenversicherung", monthly_eur: 612 },
      { name: "Bildungsunterstützung", monthly_eur: 520 },
    ],
    year_over_year_change_monthly_eur: 134,
    source_ids: ["agg_recurring_yoy_202608"],
  },
  review_topics: {
    items: [
      "Zinsbindung endet am 31.10.2027",
      "Wiederkehrende Kosten sind um 134 Euro pro Monat gestiegen",
      "Einkommensschutz ist im Demo-Datensatz nicht bestätigt",
      "Bestätigter Netto-Rentenwert fehlt",
    ],
    source_ids: ["finding_mortgage_refix", "finding_recurring_cost_drift", "finding_protection_data_incomplete", "fact_goal_retirement"],
  },
  mortgage_sensitivity: {
    principal_eur: 240000,
    remaining_months: 240,
    monthly_payment_eur: { "4_percent": 1454.35, "5_percent": 1583.89, "6_percent": 1719.43 },
    source_ids: ["scenario_mortgage_4", "scenario_mortgage_5", "scenario_mortgage_6", "fact_mortgage_balance"],
  },
  retirement_baseline: {
    target_age: 63,
    projected_real_assets_eur: 299810.07,
    required_capital_eur: 325714,
    readiness_ratio: 0.92,
    source_ids: ["scenario_retirement_age63", "fact_retirement_assets", "fact_goal_retirement"],
  },
};

const CREATE_PROFILES_SQL = `CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT NOT NULL,
  net_worth_eur REAL NOT NULL,
  expectations TEXT NOT NULL,
  bank_connected INTEGER NOT NULL DEFAULT 1,
  preferred_language TEXT NOT NULL DEFAULT 'de',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;
const CREATE_UPDATED_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at)";
const BLOCKED = ["empfehlen", "bestes produkt", "kaufen", "handeln", "steuerlich verbindlich", "kredit genehmigen", "recommend a product", "best investment", "buy for me", "execute a trade"];
let databaseReady;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function viewerFromRequest(request) {
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email") || "";
  let fullName = "";
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  if (encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { fullName = decodeURIComponent(encodedName); } catch { fullName = ""; }
  }
  return userId ? { userId, email, fullName } : null;
}

async function ensureDatabase(env) {
  if (!env.DB) throw new Error("Persistent account storage is unavailable.");
  if (!databaseReady) databaseReady = env.DB.batch([
    env.DB.prepare(CREATE_PROFILES_SQL),
    env.DB.prepare(CREATE_UPDATED_INDEX_SQL),
  ]).then(() => env.DB.prepare("PRAGMA optimize").run());
  await databaseReady;
}

function profileFromRow(row) {
  if (!row) return null;
  return {
    name: row.name,
    email: row.email || undefined,
    netWorth: Number(row.net_worth_eur),
    expectations: row.expectations,
    bankConnected: Boolean(row.bank_connected),
    language: row.preferred_language === "en" ? "en" : "de",
  };
}

async function readProfile(env, userId) {
  await ensureDatabase(env);
  const row = await env.DB.prepare("SELECT email, name, net_worth_eur, expectations, bank_connected, preferred_language FROM user_profiles WHERE user_id = ?").bind(userId).first();
  return profileFromRow(row);
}

function validatedFullProfile(body, viewer) {
  const name = String(body.name || "").trim().slice(0, 80);
  const netWorth = Number(body.netWorth);
  const expectations = String(body.expectations || "").trim().slice(0, 500);
  if (name.length < 2) throw new Error("Please enter your name.");
  if (!Number.isFinite(netWorth) || Math.abs(netWorth) > 1_000_000_000_000) throw new Error("Please enter a valid net worth.");
  if (expectations.length < 5) throw new Error("Please describe what you expect from FinTwin.");
  if (body.bankConnected !== true) throw new Error("Connect the shared demo bank to continue.");
  return { name, email: viewer.email, netWorth, expectations, bankConnected: true, language: body.language === "en" ? "en" : "de" };
}

async function saveFullProfile(env, viewer, profile) {
  await ensureDatabase(env);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO user_profiles (user_id, email, name, net_worth_eur, expectations, bank_connected, preferred_language, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, name = excluded.name, net_worth_eur = excluded.net_worth_eur, expectations = excluded.expectations, bank_connected = excluded.bank_connected, preferred_language = excluded.preferred_language, updated_at = excluded.updated_at`)
    .bind(viewer.userId, profile.email || null, profile.name, profile.netWorth, profile.expectations, 1, profile.language, now, now).run();
  return profile;
}

async function patchProfile(env, viewer, body) {
  const current = await readProfile(env, viewer.userId);
  if (!current) return null;
  const next = { ...current };
  if (body.name !== undefined) { const name = String(body.name).trim().slice(0, 80); if (name.length < 2) throw new Error("Please enter your name."); next.name = name; }
  if (body.netWorth !== undefined) { const value = Number(body.netWorth); if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) throw new Error("Please enter a valid net worth."); next.netWorth = value; }
  if (body.expectations !== undefined) { const value = String(body.expectations).trim().slice(0, 500); if (value.length < 5) throw new Error("Please describe what you expect from FinTwin."); next.expectations = value; }
  if (body.language !== undefined) next.language = body.language === "en" ? "en" : "de";
  next.email = viewer.email || current.email;
  return saveFullProfile(env, viewer, next);
}

function monthsToGoal(start, contribution, annualReturn, target, growStartingBalance) {
  if (start >= target) return 0;
  const monthlyRate = annualReturn / 12;
  let months = 0; let invested = growStartingBalance ? start : 0; const fixed = growStartingBalance ? 0 : start;
  while (fixed + invested < target && months < 2400) { invested = invested * (1 + monthlyRate) + contribution; months += 1; }
  return months;
}

function goalDate(months) {
  const date = new Date("2026-08-30T12:00:00Z"); date.setUTCMonth(date.getUTCMonth() + months);
  return { months, approximate_year: date.getUTCFullYear(), approximate_date: date.toISOString().slice(0, 7) };
}

function householdContext(profile) {
  const netWorth = Number(profile?.netWorth ?? 487320);
  const contribution = SHARED_DEMO_CONTEXT.financial_snapshot.free_cashflow_august_eur;
  return {
    signed_in_profile: { name: profile?.name || "FinTwin user", declared_net_worth_eur: netWorth, expectations: profile?.expectations || "Understand the household's finances", source_ids: ["account_profile", "account_net_worth"] },
    ...SHARED_DEMO_CONTEXT,
    million_euro_goal: {
      target_eur: 1_000_000, monthly_contribution_eur: contribution, assumed_annual_return: 0.04,
      if_current_net_worth_also_compounds: goalDate(monthsToGoal(netWorth, contribution, 0.04, 1_000_000, true)),
      if_only_new_contributions_compound: goalDate(monthsToGoal(netWorth, contribution, 0.04, 1_000_000, false)),
      explanation: "These are two different assumptions. Do not present a single date without making the assumption clear.",
      source_ids: ["account_net_worth", "agg_cashflow_202608", "goal_projection_4pct"],
    },
  };
}

function sourceIds(context) {
  return [...new Set(Object.values(context).flatMap(value => value && typeof value === "object" && Array.isArray(value.source_ids) ? value.source_ids : []))];
}

async function groq(path, env, init) {
  if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is unavailable.");
  const headers = new Headers(init.headers || {}); headers.set("authorization", `Bearer ${env.GROQ_API_KEY}`);
  const response = await fetch(`https://api.groq.com/openai/v1${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`Groq API ${response.status}`);
  return response;
}

function humanize(text) {
  return text.replace(/\*\*/g, "").replace(/`/g, "").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-•]\s+/gm, "").replace(/^(Model calculations|Modellrechnungen|Modellrechnung)\s*[-:]\s*/i, "").replace(/\n{3,}/g, "\n\n").trim();
}

async function answerQuestion(question, env, language = "de", profile) {
  if (BLOCKED.some(term => question.toLocaleLowerCase("de").includes(term))) {
    return {
      display_response: language === "en" ? "I can’t choose or buy a financial product for you. What I can do is help you compare the trade-offs in plain language and prepare the questions you should ask a qualified adviser." : "Ich kann kein Finanzprodukt für Sie auswählen oder kaufen. Ich kann Ihnen aber die Unterschiede verständlich erklären und die Fragen vorbereiten, die Sie einer qualifizierten Fachperson stellen sollten.",
      claims: [], policy_result: "blocked", mode: "policy_guard", warnings: [language === "en" ? "Regulated recommendation restricted." : "Regulierte Empfehlung begrenzt."],
    };
  }
  const context = householdContext(profile);
  const system = language === "en"
    ? `You are FinTwin, a warm and thoughtful English-speaking financial coach. Talk like a capable human in a private conversation, not like a report or spreadsheet. Start with the direct answer. Use two or three short natural paragraphs and no heading, bullets, markdown, raw formulas or "model calculations" label. Address the user by first name only when it feels natural. Use only the verified tool result, distinguish the user's declared profile from the shared fictional bank feed, and explain material assumptions in plain language. Check arithmetic carefully. Keep it under 150 words. Never make product, transaction, tax, legal or credit decisions.`
    : `Du bist FinTwin, ein warmer und aufmerksamer deutschsprachiger Finanzcoach. Sprich wie ein kompetenter Mensch in einem vertraulichen Gespräch, nicht wie ein Bericht oder eine Tabelle. Beginne direkt mit der Antwort. Nutze zwei oder drei kurze natürliche Absätze, ohne Überschrift, Aufzählung, Markdown, rohe Formeln oder das Etikett „Modellrechnung“. Sprich die Person nur dann beim Vornamen an, wenn es natürlich wirkt. Nutze ausschließlich das geprüfte Werkzeugergebnis, trenne das angegebene Nutzerprofil klar vom gemeinsamen fiktiven Bank-Datensatz und erkläre wichtige Annahmen in Alltagssprache. Prüfe jede Rechnung sorgfältig. Höchstens 150 Wörter. Keine Produkt-, Transaktions-, Steuer-, Rechts- oder Kreditentscheidung.`;
  const tool = { type: "function", function: { name: "get_verified_financial_context", description: "Returns the signed-in profile, shared synthetic bank feed, scenarios and traceable source IDs.", parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"], additionalProperties: false } } };
  const messages = [{ role: "system", content: system }, { role: "user", content: question }];
  const firstResponse = await groq("/chat/completions", env, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b", messages, tools: [tool], tool_choice: "required", temperature: 0.35, max_tokens: 420 }) });
  const first = await firstResponse.json(); const assistant = first.choices?.[0]?.message;
  if (!assistant?.tool_calls?.length) throw new Error("The model did not request verified context.");
  messages.push(assistant);
  for (const call of assistant.tool_calls) messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(context) });
  const finalResponse = await groq("/chat/completions", env, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b", messages, temperature: 0.45, max_tokens: 420 }) });
  const final = await finalResponse.json(); const text = humanize(final.choices?.[0]?.message?.content?.trim() || "");
  if (!text) throw new Error("The model returned an empty answer.");
  return { display_response: text, claims: [{ text, source_ids: sourceIds(context), confidence: "model_with_verified_context" }], policy_result: "allowed", mode: "groq_live", warnings: [language === "en" ? "AI-generated interpretation; have important decisions reviewed by a human." : "KI-generierte Einordnung; wichtige Entscheidungen menschlich prüfen."], tool_calls: [{ name: "get_verified_financial_context", trace_id: first.id }] };
}

async function transcribe(request, env) {
  const incoming = await request.formData(); const audio = incoming.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return json({ ok: false, error: "No recording received." }, 400);
  if (audio.size > 15 * 1024 * 1024) return json({ ok: false, error: "The recording is too large." }, 413);
  const form = new FormData(); form.set("file", audio, audio.name || "question.webm"); form.set("model", "whisper-large-v3-turbo"); form.set("language", incoming.get("language") === "en" ? "en" : "de"); form.set("response_format", "json"); form.set("temperature", "0");
  const response = await groq("/audio/transcriptions", env, { method: "POST", body: form }); const result = await response.json();
  return json({ ok: true, data: { transcript: result.text?.trim() || "" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ status: "ok", ai_available: Boolean(env.GROQ_API_KEY), ai_provider: env.GROQ_API_KEY ? "groq" : "demo", ai_model: env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b", account_storage: Boolean(env.DB) });
      if (url.pathname === "/v1/account") {
        const viewer = viewerFromRequest(request);
        if (!viewer) return json({ ok: false, error: "Sign in is required." }, 401);
        if (request.method === "GET") return json({ ok: true, data: { profile: await readProfile(env, viewer.userId), viewer: { email: viewer.email, suggestedName: viewer.fullName } } });
        if (request.method === "POST") { const body = await request.json(); const profile = await saveFullProfile(env, viewer, validatedFullProfile(body, viewer)); return json({ ok: true, data: { profile } }, 201); }
        if (request.method === "PATCH") { const body = await request.json(); const profile = await patchProfile(env, viewer, body); return profile ? json({ ok: true, data: { profile } }) : json({ ok: false, error: "Complete onboarding first." }, 404); }
      }
      if (request.method === "POST" && url.pathname.endsWith("/copilot/turns")) {
        const body = await request.json(); const viewer = viewerFromRequest(request); let profile = null;
        if (viewer && env.DB) profile = await readProfile(env, viewer.userId);
        if (!profile && body.profile) profile = { name: String(body.profile.name || "FinTwin user").slice(0, 80), netWorth: Number(body.profile.netWorth) || 487320, expectations: String(body.profile.expectations || "Understand my finances").slice(0, 500) };
        const data = await answerQuestion(String(body.question || ""), env, body.language === "en" ? "en" : "de", profile);
        return json({ ok: true, data, source_ids: data.claims.flatMap(claim => claim.source_ids || []) });
      }
      if (request.method === "POST" && url.pathname.endsWith("/voice/transcribe")) return await transcribe(request, env);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Service unavailable" }, 502);
    }
    const response = await env.ASSETS.fetch(request); if (response.status !== 404) return response;
    if (url.pathname.includes(".")) return response;
    url.pathname = "/index.html"; return env.ASSETS.fetch(new Request(url, request));
  },
};
