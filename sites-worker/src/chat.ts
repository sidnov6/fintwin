/**
 * POST /v1/chat — one conversational turn, streamed as server-sent events.
 *
 * Live path: Groq chat completions with streaming and tool calls, up to four
 * tool rounds. Offline path (no key, or the model failed): the deterministic
 * companion. Both emit the same events, so the UI does not care which ran.
 */
import { FACT_BY_KEY, isFactKey } from "@fintwin/engine";
import type { FactKey, Lang } from "@fintwin/engine";
import type { AppState, Card, ChatEvent, Message } from "@fintwin/contracts";
import { listMessages, saveMessage, type Env } from "./db";
import { buildState } from "./state";
import { companionTurn, firstRead, insightSuggestions, prestore } from "./companion";
import { apiFetch } from "./groq";
import { chatProvider } from "./providers";
import { runToolAndRefresh, TOOL_DEFS, type ToolContext } from "./tools";

const POLICY = /\b(best(es|e)? (produkt|etf|fonds|aktie|investment|fund|stock)|buy for me|kauf(e|en)? für mich|execute (a )?trade|trade ausführen|guaranteed return|garantierte rendite|steuerlich verbindlich|kredit genehmigen)\b/i;

interface SseWriter { send(event: ChatEvent): void; close(): void }

function sse(): { writer: SseWriter; response: Response } {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { closed = true; } });
  const writer: SseWriter = {
    send(event) { if (closed || !controller) return; try { controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)); } catch { closed = true; } },
    close() { if (closed || !controller) return; closed = true; try { controller.close(); } catch { /* already closed */ } },
  };
  return { writer, response: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" } }) };
}

function compactState(state: AppState, lang: Lang): string {
  const facts = Object.values(state.facts).filter(Boolean).map(fact => `${fact!.key}=${JSON.stringify(fact!.value)} (${fact!.source})`);
  const metrics = state.picture.metrics.filter(metric => metric.value !== null).map(metric => `${metric.key}=${Math.round((metric.value ?? 0) * 10) / 10}${metric.unit === "percent" ? "%" : metric.unit === "months" ? "mo" : ""}`);
  const insights = state.picture.insights.map(insight => `- ${insight.title[lang]}: ${insight.body[lang]}`);
  const open = state.picture.openQuestions.slice(0, 6).map(question => `${question.key} (${question.why[lang]})`);
  const lines = [
    `PROFILE: name=${state.profile?.name || "(unknown, ask)"}; onboardingDone=${state.profile?.onboardingDone ?? false}; sampleLoaded=${state.profile?.sampleLoaded ?? false}; language=${lang}`,
    `FACTS (${facts.length}): ${facts.join("; ") || "none yet"}`,
    `DERIVED: ${metrics.join("; ") || "nothing derivable yet"}`,
    state.picture.mortgage ? `MORTGAGE SENSITIVITY: ${state.picture.mortgage.sensitivity.map(item => `${item.annualRatePct}%→${item.payment}/mo`).join(", ")}${state.picture.mortgage.monthsUntilRefix !== null ? `; refix in ${state.picture.mortgage.monthsUntilRefix} months` : ""}` : "",
    state.picture.retirement ? `RETIREMENT MODEL: real=${Math.round(state.picture.retirement.projectedReal)}, required=${state.picture.retirement.requiredCapital ?? "unknown (spending target missing)"}, ratio=${state.picture.retirement.readinessRatio ?? "n/a"}` : "",
    state.portfolio ? `PORTFOLIO: value=${Math.round(state.portfolio.summary.marketValueEur)}, top3=${Math.round(state.portfolio.summary.topThreeWeightPct)}%, sectors=${state.portfolio.sectors.map(item => `${item.name} ${Math.round(item.weightPct)}%`).join(", ")}` : "PORTFOLIO: none connected",
    insights.length ? `INSIGHTS:\n${insights.join("\n")}` : "INSIGHTS: none yet",
    `OPEN QUESTIONS (most useful first): ${open.join("; ") || "none"}`,
    `ASSUMPTIONS: ${state.picture.assumptions.map(item => item[lang]).join(" ") || "none"}`,
    state.memories.length ? `MEMORIES: ${state.memories.map(memory => memory.text).join(" | ")}` : "",
    state.nextSteps.length ? `NEXT STEPS: ${state.nextSteps.map(step => `${step.done ? "[x]" : "[ ]"} ${step.text}`).join("; ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function systemPrompt(state: AppState, lang: Lang, now: Date, turn: { introduced: boolean; stored: string; skipped: FactKey[] }): string {
  const factKeys = Object.keys(FACT_BY_KEY).join(", ");
  const persona = lang === "de"
    ? `Du bist FinTwin, ein warmer, aufmerksamer Finanzbegleiter im fortlaufenden Gespräch mit einer Person. Du klingst wie ein kluger Mensch, nie wie ein Bericht. Sie-Form. Antworte auf Deutsch.`
    : `You are FinTwin, a warm, perceptive financial companion in an ongoing conversation with one person. You sound like a thoughtful human, never like a report. Answer in English.`;
  return `${persona}
Today: ${now.toISOString().slice(0, 10)}.

HOW YOU TALK
- Lead with what the person actually needs. Plain prose in short paragraphs. No markdown, headings, bullet lists, tables or emojis.
- Match length to the question. A number they asked for takes two sentences. A decision they are weighing deserves the trade-off, what would change your view, and what you would want to know next. Do not pad, and do not truncate something that matters.
- Think about second-order effects before you answer: what this number implies for their other goals, which assumption the result is most sensitive to, and what they have not thought to ask. Say the uncomfortable thing plainly if it is true.
- Ask at most one question per reply. Reflect briefly on what a new number means before moving on.
- Every personal number comes from FACTS, DERIVED or a tool result. If something is unknown, say so and ask; never invent or estimate silently. Label model results as model calculations, not forecasts.
- Prefer running a scenario over describing one. If the answer depends on a number you can compute, compute it, then interpret it. Interpretation is the part they cannot get elsewhere.
- Never do arithmetic yourself. Interest saved, growth over time, totals and differences all come from a tool; if you need one, call the tool with the right arguments (for example special_repayment_monthly when they ask about overpaying) instead of estimating. Quote tool numbers exactly as returned. If no tool can produce a figure, say what is missing rather than approximating.
- When the person states or corrects a number, call set_facts immediately with every fact in the message (EUR, monthly for monthly keys; keys: ${factKeys}; "retire at 60" means retirement_age=60). When they ask "what if", call the matching scenario tool with overrides and explain the result in words; a what-if is not a new fact unless they say it is. Use remember for preferences and worries that are not numbers. Use add_next_step when you agree on a concrete action.
- First conversation (onboardingDone=false): ${turn.introduced ? "You have already introduced yourself and asked for a name; never introduce yourself again." : "Introduce yourself in one short sentence and ask for a name."} Walk through the open questions one at a time in a light, human way, acknowledging each answer with one short reflection. Let them skip. Offer load_sample_data if they would rather explore first. Call finish_onboarding once the basics (income, spending, cash, investments, age, main goal) are covered or they want to move on, then give a short honest first read of their picture.
- Never ask the person to confirm a number they just gave. Facts the server already stored from this message are listed under STORED THIS TURN: treat them as done, reflect briefly, move on. If a name is stored, use it and do not ask for it again.
- Later conversations: continue directly from the person's message. Never reintroduce yourself, restate your role, or greet them again on every turn. Their name is already ${state.profile?.name || "unknown"}; if it is known, never ask for it. Never ask for a fact already present in FACTS. Remember what they told you.

WHAT YOU NEVER DO
- Recommend, rank or pick specific products, securities, insurers or lenders; execute or simulate trades; promise returns; give binding tax, legal or credit conclusions; judge anyone as "underinsured". Instead explain the criteria that matter and suggest a qualified human adviser for those decisions.
- Claim any bank, broker or insurer is connected. Sample data is synthetic and must be called sample data.

END OF REPLY
After your prose, add two final lines exactly like:
SUGGESTIONS: first quick reply | second | third
ASK: <fact key you just asked for, or none>
Two or three suggestions (in ${lang === "de" ? "German" : "English"}, under 8 words each). ASK must be one of the fact keys or none. Nothing after these lines.

STORED THIS TURN: ${turn.stored || "nothing"}
SKIPPED BY THE PERSON: ${turn.skipped.join(", ") || "nothing"}

CURRENT PICTURE
${compactState(state, lang)}`;
}

interface ToolCallAccumulator { id: string; name: string; arguments: string }

/** Streams one model round; returns text and any tool calls. */
async function streamRound(env: Env, messages: unknown[], onDelta: (text: string) => void): Promise<{ text: string; toolCalls: ToolCallAccumulator[]; finish: string }> {
  const provider = chatProvider(env);
  if (!provider) throw new Error("No chat provider is configured.");
  const payload: Record<string, unknown> = { model: provider.model, messages, tools: TOOL_DEFS, tool_choice: "auto", temperature: 0.5, max_tokens: provider.maxTokens, stream: true };
  // Reasoning tokens count against max_tokens, so the budget above is sized for them.
  // reasoning_format must be parsed or hidden alongside tool calling, never raw.
  if (provider.reasoningEffort) { payload.reasoning_effort = provider.reasoningEffort; payload.reasoning_format = "hidden"; }
  const response = await apiFetch(`${provider.baseUrl}/chat/completions`, provider.apiKey, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No stream from model.");
  const decoder = new TextDecoder();
  let buffer = "", text = "", finish = "";
  const toolCalls = new Map<number, ToolCallAccumulator>();
  let visibleSoFar = "";
  const emitVisible = (chunk: string) => {
    // Hold back the trailing SUGGESTIONS line so it never reaches the screen.
    visibleSoFar += chunk;
    const marker = visibleSoFar.search(/\n?\s*SUGGESTIONS?\s*:/i);
    if (marker >= 0) { const before = visibleSoFar.slice(0, marker); if (before) onDelta(before); visibleSoFar = visibleSoFar.slice(marker); return; }
    const safe = visibleSoFar.length > 14 ? visibleSoFar.slice(0, -14) : "";
    if (safe) { onDelta(safe); visibleSoFar = visibleSoFar.slice(safe.length); }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let payload: { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }> };
      try { payload = JSON.parse(data); } catch { continue; }
      const choice = payload.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) { text += choice.delta.content; emitVisible(choice.delta.content); }
      for (const call of choice.delta?.tool_calls ?? []) {
        const current = toolCalls.get(call.index) ?? { id: call.id ?? `call_${call.index}`, name: "", arguments: "" };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.name += call.function.name;
        if (call.function?.arguments) current.arguments += call.function.arguments;
        toolCalls.set(call.index, current);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  if (visibleSoFar && !/SUGGESTIONS?\s*:/i.test(visibleSoFar)) onDelta(visibleSoFar);
  return { text, toolCalls: [...toolCalls.values()], finish };
}

function splitSuggestions(text: string): { text: string; suggestions: string[]; ask: FactKey | null } {
  const askMatch = text.match(/\n?\s*ASK\s*:\s*([a-z_]+)\s*$/i);
  const ask = askMatch && isFactKey(askMatch[1].toLowerCase()) ? askMatch[1].toLowerCase() as FactKey : null;
  const body = askMatch ? text.slice(0, askMatch.index) : text;
  const match = body.match(/\n?\s*SUGGESTIONS?\s*:\s*(.+?)\s*$/i);
  if (!match) return { text: body.trim(), suggestions: [], ask };
  return { text: body.slice(0, match.index).trim(), suggestions: match[1].split("|").map(item => item.trim()).filter(Boolean).slice(0, 3), ask };
}

function humanize(text: string): string {
  return text.replace(/\*\*/g, "").replace(/`/g, "").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-•]\s+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

async function liveTurn(text: string, ctx: ToolContext, history: Message[], writer: SseWriter): Promise<{ text: string; suggestions: string[]; meta: Message["meta"] }> {
  const pre = await prestore(text, ctx, history);
  const storedNote = [pre.name ? `name=${pre.name}` : "", ...pre.stored.map(item => `${item.key}=${JSON.stringify(item.value)}`)].filter(Boolean).join(", ");
  const turn = { introduced: history.some(message => message.role === "assistant"), stored: storedNote, skipped: pre.skipped };
  const messages: unknown[] = [{ role: "system", content: systemPrompt(ctx.state, ctx.lang, ctx.now, turn) }];
  for (const message of history.slice(-20)) if (message.role !== "system" && message.text) messages.push({ role: message.role, content: message.text.slice(0, 4000) });
  messages.push({ role: "user", content: text });
  let visible = "", finalText = "";
  for (let round = 0; round < 4; round++) {
    const result = await streamRound(ctx.env, messages, delta => { visible += delta; writer.send({ type: "delta", text: delta }); });
    finalText += (finalText && result.text ? "\n\n" : "") + result.text;
    if (!result.toolCalls.length) break;
    messages.push({ role: "assistant", content: result.text || null, tool_calls: result.toolCalls.map(call => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } })) });
    for (const call of result.toolCalls) {
      let args: unknown = {};
      try { args = JSON.parse(call.arguments || "{}"); } catch { args = {}; }
      const output = await runToolAndRefresh(call.name, args, ctx);
      messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: JSON.stringify(output) });
    }
    // Refresh the picture the model sees after tool writes.
    (messages[0] as { content: string }).content = systemPrompt(ctx.state, ctx.lang, ctx.now, turn);
  }
  const split = splitSuggestions(humanize(finalText));
  if (!split.text) throw new Error("The model returned an empty answer.");
  // If the streamed text differs from the final text (markdown stripped), the UI replaces it on `done`.
  return { text: split.text, suggestions: split.suggestions.length ? split.suggestions : insightSuggestions(ctx.state.picture, ctx.lang, 2), meta: { pendingFact: split.ask ?? undefined, skipped: pre.skipped, onboarding: !ctx.state.profile?.onboardingDone } };
}

export async function handleChat(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { text?: string; language?: string; mode?: string };
  const text = String(body.text ?? "").trim().slice(0, 4000);
  const lang: Lang = body.language === "en" ? "en" : "de";
  if (!text) return Response.json({ ok: false, error: "Please say something first." }, { status: 400 });
  const now = new Date();
  const [history, initialState] = await Promise.all([listMessages(env, userId, 30), buildState(env, userId)]);
  const userMessage: Message = { id: crypto.randomUUID(), role: "user", text, cards: [], mode: body.mode === "voice" ? "voice" : undefined, createdAt: now.toISOString() };
  await saveMessage(env, userId, userMessage);

  const { writer, response } = sse();
  const messageId = crypto.randomUUID();
  const cards: Card[] = [];
  const ctx: ToolContext = { env, userId, lang, now, state: initialState, emitCard: card => { cards.push(card); writer.send({ type: "card", card }); }, emitState: state => writer.send({ type: "state", state }) };

  const run = async () => {
    let mode: Message["mode"] = env.GROQ_API_KEY ? "live" : "offline";
    let meta: Message["meta"] = {};
    let result: { text: string; suggestions: string[] };
    writer.send({ type: "start", messageId, mode: mode === "live" ? "live" : "offline" });
    try {
      if (mode === "live" && POLICY.test(text)) {
        const companion = await companionTurn(text, ctx, history);
        result = { text: companion.text, suggestions: companion.suggestions }; mode = "policy";
        writer.send({ type: "delta", text: companion.text });
      } else if (!ctx.state.profile?.onboardingDone) {
        // Onboarding is stateful product logic, not a generation task. Keeping
        // it deterministic prevents the model from re-asking names, confirming
        // numbers that were already stored, or losing the next question when
        // it omits a formatting marker.
        const companion = await companionTurn(text, ctx, history);
        result = { text: companion.text, suggestions: companion.suggestions }; meta = companion.meta;
        mode = env.GROQ_API_KEY ? "live" : companion.mode;
        writer.send({ type: "delta", text: companion.text });
      } else if (mode === "live") {
        const live = await liveTurn(text, ctx, history, writer);
        result = live; meta = live.meta;
      } else {
        const companion = await companionTurn(text, ctx, history);
        result = { text: companion.text, suggestions: companion.suggestions }; meta = companion.meta; mode = companion.mode;
        writer.send({ type: "delta", text: companion.text });
      }
    } catch (error) {
      // Model failed: fall back to the companion so the person always gets an answer.
      ctx.state = await buildState(env, userId);
      const companion = await companionTurn(text, ctx, history);
      const note = lang === "de" ? " (Das Live-Modell war gerade nicht erreichbar.)" : " (The live model was unavailable just now.)";
      result = { text: companion.text + note, suggestions: companion.suggestions }; meta = companion.meta; mode = "offline";
      writer.send({ type: "delta", text: result.text });
      console.warn("live turn failed:", error instanceof Error ? error.message : error);
    }
    const message: Message = { id: messageId, role: "assistant", text: result.text, cards, suggestions: result.suggestions, sourceIds: [...new Set(ctx.state.picture.metrics.flatMap(metric => metric.sourceIds))].slice(0, 12), mode, meta, createdAt: new Date().toISOString() };
    await saveMessage(env, userId, message);
    writer.send({ type: "done", message });
    writer.close();
  };
  run().catch(error => { writer.send({ type: "error", message: error instanceof Error ? error.message : "Something went wrong." }); writer.close(); });
  return response;
}

/** Greeting for a returning person when the thread is empty or stale — no model call needed. */
export function greeting(state: AppState, lang: Lang): { text: string; suggestions: string[] } {
  if (!state.profile?.name && !state.profile?.onboardingDone) return { text: lang === "de" ? "Hallo! Ich bin FinTwin, Ihr Begleiter für die eigenen Finanzen. Ich merke mir, was Sie mir erzählen, rechne ehrlich durch, was daraus folgt, und sage Ihnen, was ich nicht weiß. Wie darf ich Sie nennen?" : "Hi! I am FinTwin, your companion for your own money. I remember what you tell me, work out honestly what follows from it, and tell you what I do not know. What should I call you?", suggestions: [lang === "de" ? "Beispieldaten laden" : "Load sample data"] };
  if (!state.profile?.name) return { text: (lang === "de" ? "Willkommen zurück. " : "Welcome back. ") + firstRead(state, lang), suggestions: insightSuggestions(state.picture, lang) };
  return { text: (lang === "de" ? `Willkommen zurück, ${state.profile.name}. ` : `Welcome back, ${state.profile.name}. `) + firstRead(state, lang), suggestions: insightSuggestions(state.picture, lang) };
}
