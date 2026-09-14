/**
 * POST /v1/chat — one conversational turn, streamed as server-sent events.
 *
 * Live path: OpenAI Responses or compatible Chat Completions, up to four
 * tool rounds. Offline path (no key, or the model failed): the deterministic
 * companion. Both emit the same events, so the UI does not care which ran.
 */
import { FACT_BY_KEY, isFactKey } from "@fintwin/engine";
import type { FactKey, Lang } from "@fintwin/engine";
import type { AppState, Card, ChatEvent, Message } from "@fintwin/contracts";
import { beginTurn, getHead, listMessages, saveMessage, type Env } from "./db";
import { buildState } from "./state";
import { companionTurn, firstRead, insightSuggestions, prestore } from "./companion";
import { apiFetch } from "./groq";
import { chatProvider, groqFallback, type ChatProvider } from "./providers";
import { textCost } from './pricing';
import { runToolAndRefresh, TOOL_DEFS, type ToolContext } from "./tools";
import { CONVERSATION_POLICY, POLICY_VERSION } from './policy';
import { readScenario } from './application';
import { AppError, publicError } from './errors';
import { reserve, settle } from './budget';
import { responsesRound } from './openai-responses';
import type { ScenarioSnapshot } from '@fintwin/contracts';
import {askedFact} from './dialogue';
import {onboardingPrompt} from './onboarding';
import {isBankQuestion} from './bank';

const POLICY = /\b(best(es|e)? (produkt|etf|fonds|aktie|investment|fund|stock)|buy for me|kauf(e|en)? für mich|execute (a )?trade|trade ausführen|guaranteed return|garantierte rendite|steuerlich verbindlich|kredit genehmigen)\b/i;

interface SseWriter { send(event: ChatEvent): void; close(): void }

function sse(cancel:()=>void): { writer: SseWriter; response: Response } {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { closed = true; cancel(); } });
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
    `PROFILE: name=${state.profile?.name || "(optional, unknown)"}; onboardingDone=${state.profile?.onboardingDone ?? false}; sampleLoaded=${state.profile?.sampleLoaded ?? false}; language=${lang}`,
    state.bank?`BANK: synthetic feed connected, ${state.bank.from} to ${state.bank.to}, ${state.bank.transactionCount} transactions. Use read_bank_trends for exact totals, filters and chart cards. Historical bank data is separate from editable planning facts.`:'BANK: no feed connected. Offer the explicit sample button for a fictional demo.',
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

function systemPrompt(state:AppState,lang:Lang,now:Date,turn:{introduced:boolean;stored:string;skipped:FactKey[];sourceTurnId?:string}):string {
  return `${CONVERSATION_POLICY}\nPolicy: ${POLICY_VERSION}. Selected language: ${lang==='de'?'German, Sie':'English'}.\nSource turn ID: ${turn.sourceTurnId}.\nAs of: ${state.picture.asOf}.\nAlready saved this turn: ${turn.stored || 'none'}. Do not propose these facts again.\nSkipped: ${turn.skipped.join(',')}.\n${compactState(state,lang)}\nRecent immutable snapshots: ${JSON.stringify(state.scenarios.slice(0,2))}\nAfter your prose you may add SUGGESTIONS: first | second and ASK: fact_key_or_none. Do not read these aloud. No headings or repeated greetings.`;
}

interface ToolCallAccumulator { id: string; name: string; arguments: string }

/** Streams one model round; returns text and any tool calls. */
export async function streamRound(env: Env, messages: unknown[], onDelta: (text: string) => void, signal?:AbortSignal, userId?:string, provider:ChatProvider|null=chatProvider(env), responseInput?:unknown[]): Promise<{ text: string; toolCalls: ToolCallAccumulator[]; finish: string; responseOutput?:unknown[] }> {
  if (!provider) throw new Error("No chat provider is configured.");
  if (provider.protocol === 'responses') return responsesRound(env, provider, responseInput ?? messages, onDelta, signal, userId);
  const payload: Record<string, unknown> = { model: provider.model, messages, tools: TOOL_DEFS, tool_choice: "auto", [provider.tokenField]: provider.maxTokens, stream: true };
  if(provider.id==='groq'||provider.id==='api.openai.com')payload.stream_options={include_usage:true};
  if(provider.temperature)payload.temperature=0.5;
  // Reasoning tokens count against max_tokens, so the budget above is sized for them.
  // reasoning_format must be parsed or hidden alongside tool calling, never raw.
  if (provider.reasoningEffort) { payload.reasoning_effort = provider.reasoningEffort; if(provider.id==='groq')payload.reasoning_format = "hidden"; }
  const reservation=userId?await reserve(env,userId,'chat',provider.id,0.50):null;
  let response:Response;
  try { response = await apiFetch(`${provider.baseUrl}/chat/completions`, provider.apiKey, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),signal }); }
  catch(error){if(reservation)await settle(env,reservation,null);throw error;}
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No stream from model.");
  const decoder = new TextDecoder();
  let buffer = "", text = "", finish = "";
  let reported:Record<string,number>|null=null;
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
      let payload: { usage?:Record<string,number>;x_groq?:{usage?:Record<string,number>};choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }> };
      try { payload = JSON.parse(data); } catch { continue; }
      if(payload.usage||payload.x_groq?.usage)reported=payload.usage??payload.x_groq!.usage!;
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
  if(reservation)await settle(env,reservation,reported,provider.id==='api.openai.com'?textCost(provider.model,reported):undefined);
  if(!finish)throw new Error('Incomplete provider stream');
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

async function liveTurn(text: string, ctx: ToolContext, history: Message[], writer: SseWriter, messageId:string, voice=false): Promise<{ text: string; suggestions: string[]; meta: Message["meta"] }> {
  const pre = await prestore(text, ctx, history);
  const storedNote = [pre.name ? `name=${pre.name}` : "", ...pre.stored.map(item => `${item.key}=${JSON.stringify(item.value)}`)].filter(Boolean).join(", ");
  const turn = { introduced: history.some(message => message.role === "assistant"), stored: storedNote, skipped: pre.skipped,sourceTurnId:ctx.turnId };
  const prompt=()=>systemPrompt(ctx.state,ctx.lang,ctx.now,turn)+(voice?'\nThis is a spoken conversation. Lead with the answer in a short first sentence; usually 1–3 sentences total, unless the user asks for detail. Skip suggestions/footer metadata for voice; the app supplies suggestions. Do not omit a negative remaining_after_saving: say the monthly shortfall. Keep all fact validation, tools and financial limitations in force.':'');
  const messages: unknown[] = [{ role: "system", content: prompt() }];
  for (const message of history.slice(-20)) if (message.role !== "system" && message.text) messages.push({ role: message.role, content: message.text.slice(0, 4000) });
  messages.push({ role: "user", content: text });
  const responseInput = [...messages];
  let finalText = "", provider = chatProvider(ctx.env)!;
  let fallbackFrom:string|undefined;
  for (let round = 0; round < 4; round++) {
    const invoke=()=>streamRound(ctx.env,messages,delta=>writer.send({type:'delta',text:delta}),ctx.signal,ctx.userId,provider,responseInput);
    let result:Awaited<ReturnType<typeof streamRound>>;
    try { result=await invoke(); }
    catch(error) {
      const fallback=groqFallback(ctx.env,provider);
      if (!fallback || ctx.signal?.aborted || (error instanceof AppError && ['budget_exhausted','paid_disabled','superseded','state_changed','cancelled'].includes(error.code))) throw error;
      fallbackFrom=provider.id;provider=fallback;
      // Discard the failed round only. Completed tools and their outputs remain
      // in history; never replay them as a fresh user turn on the backup model.
      writer.send({type:'replace',messageId,text:humanize(splitSuggestions(finalText).text)});
      result=await invoke();
    }
    finalText += (finalText && result.text ? "\n\n" : "") + result.text;
    if (!result.toolCalls.length) break;
    if (result.responseOutput) responseInput.push(...result.responseOutput);
    messages.push({ role: "assistant", content: result.text || null, tool_calls: result.toolCalls.map(call => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } })) });
    for (const call of result.toolCalls) {
      let args: unknown = {};
      try { args = JSON.parse(call.arguments || "{}"); } catch { args = {}; }
      ctx.toolId=`${ctx.turnId}:${call.id}`;
      let output:Record<string,unknown>;
      try{output = await runToolAndRefresh(call.name, args, ctx);}catch(error){if(ctx.signal?.aborted)throw error;output={error:publicError(error).error};}
      messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: JSON.stringify(output) });
      if (result.responseOutput) responseInput.push({ type: 'function_call_output', call_id: call.id, output: JSON.stringify(output) });
    }
    // Refresh the picture the model sees after tool writes.
    (messages[0] as { content: string }).content = prompt();
  }
  const split = splitSuggestions(humanize(finalText));
  if (!split.text) throw new Error("The model returned an empty answer.");
  // If the streamed text differs from the final text (markdown stripped), the UI replaces it on `done`.
  return { text: split.text, suggestions: split.suggestions.length ? split.suggestions : insightSuggestions(ctx.state.picture, ctx.lang, 2), meta: { provider:provider.id,model:provider.model,fallbackFrom,pendingFact: split.ask ?? undefined, skipped: pre.skipped, onboarding: !ctx.state.profile?.onboardingDone } };
}

const activeTurns=new WeakMap<NonNullable<Env['DB']>,Map<string,AbortController>>();
export function liveFailureMessage(error:unknown,lang:Lang):string {
  const de=lang==='de',code=publicError(error).code;
  if(code==='budget_exhausted')return de?'Das lokale Demo-Limit wurde erreicht. Das ist nicht Ihr OpenAI-Guthaben; wir können offline weiterarbeiten.':'The local demo allowance has been reached. This is separate from your OpenAI balance; we can continue offline.';
  if(code==='openai_billing_required')return de?'OpenAI meldet ein Abrechnungs- oder Kontingentproblem. Prüfen Sie das API-Konto und dessen Limits.':'OpenAI reported a billing or quota problem. Check the API account and its limits.';
  if(code==='provider_auth_failed')return de?'Der KI-Anbieter hat den API-Zugang abgelehnt. Die serverseitige Konfiguration muss geprüft werden.':'The AI provider rejected API access. The server configuration needs checking.';
  if(code==='provider_request_invalid')return de?'Der KI-Anbieter hat die Anfragekonfiguration abgelehnt. Das ist ein Integrationsfehler, keine Guthabenmeldung.':'The AI provider rejected the request configuration. This is an integration error, not a credit-balance message.';
  if(code==='provider_rate_limited')return de?'Der KI-Anbieter begrenzt gerade die Anfragen. Bitte versuchen Sie es gleich noch einmal.':'The AI provider is temporarily rate-limiting requests. Please try again shortly.';
  return de?'Die Live-Antwort konnte nicht abgeschlossen werden. Diese Antwort nutzt den Offline-Modus; Ihre Angaben bleiben gespeichert.':'The live reply could not complete. This reply uses offline mode; your saved information is safe.';
}
export function explainScenario(snapshot:ScenarioSnapshot,lang:Lang):string {
  const de=lang==='de',money=(v:number)=>new Intl.NumberFormat(de?'de-DE':'en-GB',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(v);
  const stale=snapshot.stale?(de?'Dieses Szenario basiert auf einer früheren Haushaltsversion. ':'This scenario uses an earlier household revision. '):'';
  if(snapshot.kind==='mortgage'){
    const r=snapshot.result as import('@fintwin/contracts').MortgageResult;
    const remaining=snapshot.delta.remaining_after_saving;
    const budget=remaining!==null&&remaining<0?(de?` Bei unveränderten Ausgaben und Sparraten fehlen dafür monatlich ${money(-remaining)}.`:` With your current spending and saving unchanged, that leaves a monthly shortfall of ${money(-remaining)}.`):'';
    return stale+(de?`Bei ${r.annualRatePct} % Zins und ${money(r.specialRepayment)} zusätzlicher monatlicher Tilgung beträgt die Modellrate ${money(r.payment+r.specialRepayment)}. Die zusätzliche Tilgung spart im gleichen Zinsszenario ${money(snapshot.delta.extra_interest_saved!)} Zinsen.${budget} Ob Ihr Vertrag das erlaubt, bleibt zu prüfen.`:`At ${r.annualRatePct}% interest with ${money(r.specialRepayment)} extra each month, the modeled payment is ${money(r.payment+r.specialRepayment)}. Extra repayments save ${money(snapshot.delta.extra_interest_saved!)} in interest at that same rate.${budget} Your mortgage contract still needs checking.`);
  }
  if(snapshot.kind==='retirement'){
    const r=snapshot.result as import('@fintwin/contracts').RetirementResult;
    return stale+(de?`Das Szenario ergibt ${money(r.projectedReal)} in heutiger Kaufkraft. ${r.requiredCapital===null?'Ein persönlicher Deckungsgrad ist mit den fehlenden Angaben nicht berechenbar.':`Dem stehen ${money(r.requiredCapital)} modellhafter Kapitalbedarf gegenüber.`} Das hängt von Rendite, Kosten, Inflation und Entnahme ab, nicht von einer garantierten Entwicklung.`:`This scenario gives ${money(r.projectedReal)} in today's purchasing power. ${r.requiredCapital===null?'Missing information prevents a personal readiness calculation.':`The modeled capital needed is ${money(r.requiredCapital)}.`} That depends on returns, fees, inflation and withdrawals; it is not a guaranteed outcome.`);
  }
  const r=snapshot.result as import('@fintwin/contracts').GoalResult;
  return stale+(de?`Mit ${money(r.monthly)} im Monat und ${r.annualReturnPct} % angenommener Rendite liegt der Zielzeitpunkt bei ${r.reachedYearMonth??'außerhalb des Modellhorizonts'}. Ausgangspunkt sind Guthaben und Anlagen, nicht das gesamte Nettovermögen. Steuern, Kosten und Inflation sind hier nicht enthalten.`:`With ${money(r.monthly)} a month and an assumed ${r.annualReturnPct}% return, the target date is ${r.reachedYearMonth??'outside the model horizon'}. This starts from cash and investments, not total net worth. Taxes, fees and inflation are excluded.`);
}

export async function handleChat(request:Request,env:Env,userId:string):Promise<Response>{
  const body=await request.json() as {text?:unknown;language?:string;mode?:string;requestId?:string;scenarioId?:string;expectedEpoch?:number};
  if(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000)throw new AppError('invalid_message');
  const text=body.text.trim(),lang:Lang=body.language==='en'?'en':'de';
  const turnId=body.requestId && /^[a-zA-Z0-9-]{8,80}$/.test(body.requestId)?body.requestId:crypto.randomUUID();
  const startHead=await getHead(env,userId);
  if(body.expectedEpoch!==undefined&&body.expectedEpoch!==startHead.epoch)throw new AppError('state_changed',409,'The household was reset. Refresh before continuing.');
  const history=await listMessages(env,userId,60);
  const completed=history.find(m=>m.meta?.turnId===turnId && m.role==='assistant');
  if(completed){const {writer,response}=sse(()=>{});writer.send({type:'done',message:completed});writer.close();return response;}
  let active=activeTurns.get(env.DB!);if(!active){active=new Map();activeTurns.set(env.DB!,active);}
  active.get(userId)?.abort();const controller=new AbortController();active.set(userId,controller);
  const cancel=()=>controller.abort();request.signal.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,60_000);
  let initialState:AppState;
  try{
    await beginTurn(env,userId,turnId,controller.signal,startHead.epoch);
    initialState=await buildState(env,userId);
    await saveMessage(env,userId,{id:`${userId}:${turnId}`,role:'user',text,cards:[],mode:body.mode==='voice'?'voice':undefined,meta:{turnId},createdAt:new Date().toISOString()},{id:`message:${userId}:${turnId}`,expectedRevision:initialState.revision,epoch:initialState.epoch,turnId});
  }catch(error){clearTimeout(timer);request.signal.removeEventListener('abort',cancel);if(active.get(userId)===controller)active.delete(userId);controller.abort();throw error;}
  const {writer,response}=sse(cancel),messageId=crypto.randomUUID(),cards:Card[]=[];
  const ctx:ToolContext={env,userId,lang,now:new Date(initialState.picture.asOf),state:initialState,turnId,sourceText:text,signal:controller.signal,emitCard:card=>{cards.push(card);writer.send({type:'card',card});},emitState:state=>{if(!controller.signal.aborted)writer.send({type:'state',state});}};
  void (async()=>{
    let origin:NonNullable<Message['meta']>['origin']='deterministic',invoked:ReturnType<typeof chatProvider>=null;
    let result:{text:string;suggestions:string[];meta?:Message['meta']};
    writer.send({type:'start',messageId,mode:'offline'});
    try{
      await prestore(text,ctx,history);
      if(body.scenarioId){const snapshot=await readScenario(env,userId,body.scenarioId);ctx.emitCard({type:'scenario',snapshot});result={text:explainScenario(snapshot,lang),suggestions:[],meta:{scenarioId:snapshot.id}};
        if(/previous|compare|vorher|vergleich/i.test(text)&&snapshot.previousId){const previous=await readScenario(env,userId,snapshot.previousId);ctx.emitCard({type:'scenario',snapshot:previous});result.text+=(lang==='de'?' Vorheriges Szenario: ':' Previous scenario: ')+explainScenario(previous,lang);}
      }else if(POLICY.test(text) || /which (etf|stock|fund) should|welchen.*kaufen/i.test(text)){
        const answer=await companionTurn(text,ctx,history);result=answer;origin='policy';
      }else if(ctx.intake?.question){result={text:ctx.intake.question,suggestions:[],meta:{clarification:ctx.intake.clarification}};
      }else if(isBankQuestion(text)||(/^(?:and|what about|how about|only|just|und|nur|wie sieht|was ist mit)\b/i.test(text)&&history.at(-1)?.cards.some(c=>c.type==='bank_trends'))||(!ctx.state.profile?.onboardingDone&&history.at(-1)?.meta?.pendingFacts?.length&&(Boolean(ctx.intake?.stored.length||ctx.intake?.name||ctx.intake?.skipped.length)||/^(?:hi|hello|hey|hallo|yes|yeah|ja|ok|okay|sure|skip|give name|name)$/i.test(text)))){
        result=await companionTurn(text,ctx,history);
      }else if(chatProvider(env) && env.FINTWIN_ALLOW_PAID==='1'){
        invoked=chatProvider(env);origin='live';result=await liveTurn(text,ctx,history,writer,messageId,body.mode==='voice');
      }else result=await companionTurn(text,ctx,history);
      if(controller.signal.aborted)throw new AppError('cancelled',409);
    }catch(error){
      if(controller.signal.aborted || (error instanceof AppError && ['superseded','state_changed'].includes(error.code))){writer.send({type:'cancelled',messageId});return;}
      origin=invoked?'fallback':'deterministic';
      try{ctx.state=await buildState(env,userId);const answer=await companionTurn(text,ctx,history);result={...answer,text:answer.text+(invoked?' '+liveFailureMessage(error,lang):''),meta:{...answer.meta,...(invoked?{failureCode:publicError(error).code}:{})}};}
      catch {result={text:lang==='de'?'Dafür fehlen mir noch gültige Angaben. Prüfen Sie Ihr Bild; wir können danach weiterrechnen.':'I still need valid inputs for that. Review your picture, then we can calculate it.',suggestions:[]};}
      writer.send({type:'replace',messageId,text:result.text});
    }
    const head=await getHead(env,userId);
    if(controller.signal.aborted||head.active_turn!==turnId||head.epoch!==ctx.state.epoch){writer.send({type:'cancelled',messageId});return;}
    const message:Message={id:messageId,role:'assistant',text:result!.text,cards,suggestions:result!.suggestions,mode:origin==='live'?'live':origin==='policy'?'policy':'offline',meta:{...(invoked?{provider:invoked.id,model:invoked.model}:{}),...result!.meta,pendingFact:result!.meta?.pendingFact??askedFact(result!.text),origin,turnId},createdAt:new Date().toISOString()};
    await saveMessage(env,userId,message,{id:`message:${message.id}`,expectedRevision:head.revision,epoch:ctx.state.epoch,turnId});
    writer.send({type:'done',message});
  })().catch(error=>writer.send({type:'error',message:publicError(error).error})).finally(()=>{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);if(active!.get(userId)===controller)active!.delete(userId);writer.close();});
  return response;
}

/** Greeting for a returning person when the thread is empty or stale — no model call needed. */
export function greeting(state: AppState, lang: Lang): { text: string; suggestions: string[]; meta?:Message['meta'] } {
  if(state.profile?.sampleLoaded)return{text:lang==='de'?'Ihr Beispielhaushalt ist bereit: sechs Monate Demo-Buchungen, Depot und Hypothek. Was möchten Sie entdecken?':'Your sample household is ready: six months of demo transactions, investments and a mortgage. What would you like to explore?',suggestions:lang==='de'?['Zeig meine Ausgabentrends','Zeig meine Hypothekenentwicklung','Wie sieht mein Ruhestand aus?']:['Show my spending trends','Show my mortgage trends','How does my retirement look?']};
  if(!state.profile?.onboardingDone){const next=onboardingPrompt(state,lang);return{text:(state.profile?.name?(lang==='de'?`Hallo ${state.profile.name}. `:`Hi ${state.profile.name}. `):(lang==='de'?'Hallo, ich bin FinTwin. Ihren Namen können Sie gern dazusagen. ':'Hi, I’m FinTwin. Feel free to include your name. '))+(next?.text??''),suggestions:[lang==='de'?'Beispieldaten laden':'Load sample data'],meta:next?.meta};}
  if (!state.profile?.name) return { text: (lang === "de" ? "Willkommen zurück. " : "Welcome back. ") + firstRead(state, lang), suggestions: insightSuggestions(state.picture, lang) };
  return { text: (lang === "de" ? `Willkommen zurück, ${state.profile.name}. ` : `Welcome back, ${state.profile.name}. `) + firstRead(state, lang), suggestions: insightSuggestions(state.picture, lang) };
}
