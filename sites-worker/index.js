const HOUSEHOLD_CONTEXT = {
  household: "Michael und Anna Becker, synthetischer Demo-Haushalt",
  as_of: "2026-08-30T10:00:00+02:00",
  financial_snapshot: {
    net_household_income_monthly_eur: 7240,
    external_outflows_august_eur: 6672,
    free_cashflow_august_eur: 568,
    net_worth_eur: 487320,
    emergency_runway_months: 7.8,
    source_ids: ["agg_cashflow_202608", "transfer_matches_202608", "agg_net_worth_202608"],
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
      "Annas Einkommensschutz ist nicht bestätigt",
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

const BLOCKED = ["empfehlen", "bestes produkt", "kaufen", "handeln", "steuerlich verbindlich", "kredit genehmigen"];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function sourceIds() {
  return [...new Set(Object.values(HOUSEHOLD_CONTEXT).flatMap(value => value && typeof value === "object" && Array.isArray(value.source_ids) ? value.source_ids : []))];
}

async function groq(path, env, init) {
  if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY fehlt");
  const headers = new Headers(init.headers || {});
  headers.set("authorization", `Bearer ${env.GROQ_API_KEY}`);
  const response = await fetch(`https://api.groq.com/openai/v1${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`Groq API ${response.status}`);
  return response;
}

async function answerQuestion(question, env, language = "de") {
  if (BLOCKED.some(term => question.toLocaleLowerCase("de").includes(term))) {
    return {
      display_response: "Dabei kann FinTwin keine konkrete Produktempfehlung, Rangfolge oder Transaktion geben. Ich kann stattdessen neutrale Kriterien und Fragen für eine qualifizierte Fachperson strukturieren.",
      claims: [], policy_result: "blocked", mode: "policy_guard", warnings: ["Regulierte Empfehlung begrenzt."],
    };
  }
  const system = language === "en"
    ? "You are the English-language FinTwin assistant. Use only the household-data tool result. Answer factually in no more than 120 words. Do not make product, transaction, tax, legal or credit decisions. Label scenarios as model calculations."
    : "Du bist der deutschsprachige FinTwin-Assistent. Nutze ausschließlich das Ergebnis des Haushaltsdaten-Werkzeugs. Antworte sachlich in höchstens 120 Wörtern und mit deutschem Zahlenformat. Keine Produkt-, Transaktions-, Steuer-, Rechts- oder Kreditentscheidung. Szenarien sind Modellrechnungen.";
  const tool = {
    type: "function",
    function: {
      name: "get_verified_household_context",
      description: "Liefert geprüfte synthetische Haushaltsdaten und Quellen-IDs.",
      parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"], additionalProperties: false },
    },
  };
  const messages = [{ role: "system", content: system }, { role: "user", content: question }];
  const firstResponse = await groq("/chat/completions", env, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b", messages, tools: [tool], tool_choice: "required", temperature: 0.2 }),
  });
  const first = await firstResponse.json();
  const assistant = first.choices?.[0]?.message;
  if (!assistant?.tool_calls?.length) throw new Error("Werkzeugaufruf fehlt");
  messages.push(assistant);
  for (const call of assistant.tool_calls) {
    messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(HOUSEHOLD_CONTEXT) });
  }
  const finalResponse = await groq("/chat/completions", env, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b", messages, temperature: 0.2 }),
  });
  const final = await finalResponse.json();
  const text = final.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Leere Modellantwort");
  return {
    display_response: text,
    claims: [{ text, source_ids: sourceIds(), confidence: "model_with_verified_context" }],
    policy_result: "allowed", mode: "groq_live", warnings: ["KI-generierte Einordnung; wichtige Entscheidungen menschlich prüfen."],
    tool_calls: [{ name: "get_verified_household_context", trace_id: first.id }],
  };
}

async function transcribe(request, env) {
  const incoming = await request.formData();
  const audio = incoming.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return json({ ok: false, error: "Keine Aufnahme empfangen." }, 400);
  if (audio.size > 15 * 1024 * 1024) return json({ ok: false, error: "Aufnahme ist zu groß." }, 413);
  const form = new FormData();
  form.set("file", audio, audio.name || "frage.webm");
  form.set("model", "whisper-large-v3-turbo");
  form.set("language", incoming.get("language") === "en" ? "en" : "de");
  form.set("response_format", "json");
  form.set("temperature", "0");
  const response = await groq("/audio/transcriptions", env, { method: "POST", body: form });
  const result = await response.json();
  return json({ ok: true, data: { transcript: result.text?.trim() || "" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ status: "ok", ai_available: Boolean(env.GROQ_API_KEY), ai_provider: env.GROQ_API_KEY ? "groq" : "demo", ai_model: env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b" });
      if (request.method === "POST" && url.pathname.endsWith("/copilot/turns")) {
        const body = await request.json();
        const data = await answerQuestion(String(body.question || ""), env, body.language === "en" ? "en" : "de");
        return json({ ok: true, data, source_ids: data.claims.flatMap(claim => claim.source_ids || []) });
      }
      if (request.method === "POST" && url.pathname.endsWith("/voice/transcribe")) return await transcribe(request, env);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Dienst nicht erreichbar" }, 502);
    }
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    if (url.pathname.includes(".")) return response;
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  },
};
