/**
 * Tools the assistant can call. Both the live model and the offline
 * companion go through this layer, so behaviour is identical: every write is
 * validated, every scenario is deterministic, every result becomes a card.
 */
import { goal, mortgage, retirement, sampleFacts, factNumber, factText, FACT_BY_KEY } from "@fintwin/engine";
import type { FactKey, Lang } from "@fintwin/engine";
import type { AppState, Card, Portfolio } from "@fintwin/contracts";
import { addMemory, addNextStep, saveScenarioRun, setFacts, upsertProfile, type Env } from "./db";
import { buildState } from "./state";
import { assembleBrief, createScenario, readScenario } from './application';
import { applyProposals, type IntakeResult } from './intake';
import { AppError } from './errors';
import type { FactProposal } from '@fintwin/contracts';
import { getHead } from './db';
import {readBank} from './bank';
import {BANK_CATEGORIES} from '@fintwin/engine';

export interface ToolContext {
  env: Env;
  userId: string;
  lang: Lang;
  now: Date;
  state: AppState;
  turnId?: string;
  sourceText?: string;
  signal?: AbortSignal;
  intake?: IntakeResult;
  conversation?: Array<{role:string;text:string}>;
  toolId?: string;
  emitCard(card: Card): void;
  emitState(state: AppState): void;
}

export interface ToolOutcome { result: Record<string, unknown>; changed: boolean }

const LEGACY_TOOL_DEFS = [
  { type: "function", function: { name: "set_facts", description: "Store facts the person just told you (amounts in EUR, monthly where the key says monthly). Call this as soon as they state or correct a number. Keys: " + Object.keys(FACT_BY_KEY).join(", ") + ". income_protection is one of yes|no|unknown. mortgage_fixed_until is YYYY-MM.",
    parameters: { type: "object", properties: { facts: { type: "array", items: { type: "object", properties: { key: { type: "string" }, value: { type: ["number", "string"] }, note: { type: "string" } }, required: ["key", "value"] } } }, required: ["facts"] } } },
  { type: "function", function: { name: "set_name", description: "Store what the person wants to be called.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "run_mortgage", description: "Deterministic mortgage payment scenario. Defaults come from stored facts. Returns payments at 4/5/6% plus any given rate. Pass special_repayment_monthly whenever the person asks about overpaying, and the result then includes the exact interest and time saved.", parameters: { type: "object", properties: { principal: { type: "number" }, rate_pct: { type: "number" }, months: { type: "number" }, special_repayment_monthly: { type: "number" } } } } },
  { type: "function", function: { name: "run_retirement", description: "Deterministic retirement baseline in today's euros using stored facts with optional overrides.", parameters: { type: "object", properties: { retirement_age: { type: "number" }, monthly_contribution: { type: "number" }, spending_monthly: { type: "number" }, pension_monthly: { type: "number" }, annual_return_pct: { type: "number" } } } } },
  { type: "function", function: { name: "run_goal", description: "When would cash plus investments reach a target amount, given monthly investing and a return assumption (default 4%).", parameters: { type: "object", properties: { target_amount: { type: "number" }, monthly: { type: "number" }, annual_return_pct: { type: "number" }, label: { type: "string" } }, required: ["target_amount"] } } },
  { type: "function", function: { name: "get_portfolio", description: "Returns the connected sample brokerage holdings, sectors and concentration if sample data is loaded.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "remember", description: "Save a durable note about the person's preferences, situation or worries that is not a numeric fact (e.g. 'wants to keep the house', 'nervous about single stocks').", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } },
  { type: "function", function: { name: "add_next_step", description: "Add a concrete next step the person agreed to.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } },
  { type: "function", function: { name: "load_sample_data", description: "Fill the picture with the clearly labelled synthetic sample household (family, house, mortgage, brokerage) so the person can explore.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "finish_onboarding", description: "Mark the first conversation as done once the basics are covered or the person wants to move on.", parameters: { type: "object", properties: {} } } },
] as const;

export const TOOL_DEFS = [
  {type:'function',function:{name:'read_bank_trends',description:'Read exact synthetic bank transactions, spending totals, categories and monthly trends. Emits a chart card. Only available after explicit sample loading; never a real bank connection. Dates are ISO YYYY-MM-DD; coverage March–August 2026. Transfers are separate from spending. Use before making transaction-level claims.',parameters:{type:'object',properties:{from:{type:'string'},to:{type:'string'},category:{type:'string',enum:Object.keys(BANK_CATEGORIES)},merchant:{type:'string'},recurring:{type:'boolean'}},additionalProperties:false}}},
  ...LEGACY_TOOL_DEFS.filter(t=>!['set_facts','load_sample_data','set_name'].includes(t.function.name)),
  {type:'function',function:{name:'read_household',description:'Read authoritative household facts, revision, unknowns, derived picture and recent scenarios before personal reasoning.',parameters:{type:'object',properties:{},additionalProperties:false}}},
  {type:'function',function:{name:'propose_facts',description:'Propose facts from this user turn; quote its wording as evidence. Server binds turn ownership automatically. Do not repeat facts listed as already saved. Never mutate hypotheticals. Preserve currency, period, net/gross and household scope.',parameters:{type:'object',properties:{proposals:{type:'array',maxItems:30,items:{type:'object',properties:{operation:{type:'string',enum:['set','correct','remove','question','hypothetical']},key:{type:'string',enum:Object.keys(FACT_BY_KEY)},value:{type:['number','string']},currency:{type:'string'},period:{type:'string',enum:['month','year','once','unknown']},basis:{type:'string',enum:['net','gross','unknown']},scope:{type:'string',enum:['personal','household','partner','third_party','unknown']},evidence:{type:'string'},uncertain:{type:'boolean'}},required:['operation','key','currency','period','basis','scope','evidence'],additionalProperties:false}}},required:['proposals'],additionalProperties:false}}},
  {type:'function',function:{name:'create_scenario',description:'Create a server-computed immutable hypothetical snapshot. Inputs use the same snake_case names as run_mortgage/run_retirement/run_goal. No baseline fact is changed.',parameters:{type:'object',properties:{kind:{type:'string',enum:['mortgage','retirement','goal']},inputs:{type:'object',properties:{current_assets:{type:'number',description:'TOTAL capital allocated to this illustration; overrides account sums, never an additional account'},age:{type:'number'},start:{type:'number'},principal:{type:'number'},rate_pct:{type:'number'},months:{type:'number'},special_repayment_monthly:{type:'number'},retirement_age:{type:'number'},monthly_contribution:{type:'number'},spending_monthly:{type:'number'},pension_monthly:{type:'number'},annual_return_pct:{type:'number'},annual_fee_pct:{type:'number'},inflation_pct:{type:'number'},withdrawal_rate_pct:{type:'number'},target_amount:{type:'number'},monthly:{type:'number'}},additionalProperties:false}},required:['kind','inputs'],additionalProperties:false}}},
  {type:'function',function:{name:'read_scenario',description:'Read a selected snapshot by id, including exact assumptions, baseline, deltas and stale flag. Previous snapshot id supports comparison.',parameters:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}}},
  {type:'function',function:{name:'meeting_brief',description:'Assemble a deterministic adviser meeting brief from current facts and optionally one selected scenario.',parameters:{type:'object',properties:{scenario_id:{type:'string'}},additionalProperties:false}}},
];
export type ToolName = typeof LEGACY_TOOL_DEFS[number]["function"]["name"] | 'read_bank_trends' | 'read_household' | 'propose_facts' | 'create_scenario' | 'read_scenario' | 'meeting_brief';

function num(value: unknown): number | null { if(value===undefined)return null;if(typeof value!=='number'||!Number.isFinite(value))throw new AppError('invalid_numeric_input');return value; }

export function portfolioCard(portfolio: Portfolio): Card {
  return { type: "portfolio", summary: portfolio.summary, sectors: portfolio.sectors, top: [...portfolio.holdings].sort((a, b) => b.valueEur - a.valueEur).slice(0, 3).map(item => ({ symbol: item.symbol, weightPct: item.weightPct })) };
}

export async function runTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  const facts = ctx.state.facts;
  if(ctx.signal?.aborted)throw new AppError('cancelled',409);
  const head=await getHead(ctx.env,ctx.userId);
  if(ctx.turnId && (head.active_turn!==ctx.turnId || head.epoch!==ctx.state.epoch))throw new AppError('superseded',409);
  if(name==='read_bank_trends'){const report=readBank(ctx.state,args);ctx.emitCard({type:'bank_trends',report});return{result:{...report,transactions:report.transactions.slice(0,25),returnedTransactions:Math.min(25,report.transactions.length),totalTransactions:report.transactions.length},changed:false};}
  const mutation={id:ctx.toolId??crypto.randomUUID(),expectedRevision:ctx.state.revision,epoch:ctx.state.epoch,turnId:ctx.turnId};
  switch (name as ToolName) {
    case 'read_household': return {result:await buildState(ctx.env,ctx.userId) as unknown as Record<string,unknown>,changed:false};
    case 'propose_facts': {
      const proposals=args.proposals as FactProposal[];
      if(!Array.isArray(proposals))throw new AppError('invalid_proposals');
      const normalize=(text:string)=>text.normalize('NFKC').replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim().toLowerCase();
      if(proposals.some(p=>typeof p?.evidence!=='string'||!p.evidence.trim()||!normalize(ctx.sourceText??'').includes(normalize(p.evidence))))return{result:{error:'Evidence must quote this user message. Nothing was changed. Do not ask the user to repeat a special phrase; ask a normal clarification only if meaning is unclear.'},changed:false};
      // Turn ownership comes from the authenticated server context, not an ID
      // the model must reproduce. CAS/epoch checks above still reject stale tools.
      for(const p of proposals)p.sourceTurnId=ctx.turnId!;
      if(ctx.intake?.scenarioInputs?.current_assets!==undefined && proposals.some(p=>p.key==='retirement_assets'))return{result:{scenario_inputs:ctx.intake.scenarioInputs,note:'This is total capital allocated to an illustration, not an extra retirement account. Use create_scenario with current_assets. No baseline account was added.'},changed:false};
      if(proposals.some(p=>p.key==='age') && ctx.intake?.stored.some(f=>f.key==='retirement_age') && !/\b(?:i am|i'm|ich bin|current age|currently)\b/i.test(ctx.sourceText??''))return{result:{note:'The user answered the retirement-age question. That retirement age is already saved; their current age has not changed.'},changed:false};
      const remaining=proposals.filter(p=>!ctx.intake?.stored.some(f=>f.key===p.key) && !ctx.intake?.removed.includes(p.key));
      const result=await applyProposals(remaining,ctx,mutation.id);
      return {result:result as unknown as Record<string,unknown>,changed:result.stored.length+result.removed.length>0};
    }
    case 'create_scenario': {
      const inputs={...(args.kind==='retirement'?ctx.intake?.scenarioInputs:{}),...(args.inputs as Record<string,unknown>??{})};
      const snapshot=await createScenario(ctx.env,ctx.userId,args.kind as 'mortgage',inputs,mutation);
      ctx.emitCard({type:'scenario',snapshot});return{result:snapshot as unknown as Record<string,unknown>,changed:true};
    }
    case 'read_scenario': return{result:await readScenario(ctx.env,ctx.userId,String(args.id)) as unknown as Record<string,unknown>,changed:false};
    case 'meeting_brief': return{result:await assembleBrief(ctx.env,ctx.userId,ctx.lang,typeof args.scenario_id==='string'?args.scenario_id:undefined) as unknown as Record<string,unknown>,changed:false};
    case "set_facts": {
      const list = Array.isArray(args.facts) ? args.facts as Array<{ key: string; value: unknown; note?: string }> : [];
      const { accepted, rejected } = await setFacts(ctx.env, ctx.userId, list, "user",mutation);
      if (accepted.length) ctx.emitCard({ type: "facts", items: accepted.map(fact => ({ key: fact.key, value: fact.value })), source: "user" });
      return { result: { stored: accepted.map(fact => ({ key: fact.key, value: fact.value })), rejected }, changed: accepted.length > 0 };
    }
    case "set_name": {
      const name = String(args.name ?? "").trim().slice(0, 80);
      if (name.length < 1) return { result: { error: "empty name" }, changed: false };
      await upsertProfile(ctx.env, ctx.userId, { name },mutation);
      return { result: { name }, changed: true };
    }
    case "run_mortgage": {
      const snapshot=await createScenario(ctx.env,ctx.userId,'mortgage',args,mutation);
      const principal=Number(snapshot.inputs.principal),months=Number(snapshot.inputs.months),special=Number(snapshot.inputs.special_repayment_monthly);
      const rates=[Number(snapshot.inputs.rate_pct),4,5,6].filter((v,i,a)=>a.indexOf(v)===i),result=rates.map(rate=>mortgage(principal,rate,months,special));
      ctx.emitCard({type:'scenario',snapshot});
      return {result:{snapshot_id:snapshot.id,principal,months,special_repayment_monthly:special,current_payment:snapshot.inputs.baseline_payment,scenarios:result.map(r=>({rate_pct:r.annualRatePct,monthly_payment:r.payment,total_interest:r.totalInterest,payoff_months:r.payoffMonths})),overpayment_effect:rates.map(rate=>{const b=mortgage(principal,rate,months),s=mortgage(principal,rate,months,special);return{rate_pct:rate,interest_saved:Math.round((b.totalInterest-s.totalInterest)*100)/100,months_saved:b.payoffMonths-s.payoffMonths,paid_off_after_months:s.payoffMonths};}),snapshot},changed:true};
    }
    case "run_retirement": {
      const snapshot=await createScenario(ctx.env,ctx.userId,'retirement',args,mutation), result=snapshot.result as ReturnType<typeof retirement>;
      ctx.emitCard({type:'scenario',snapshot});
      return {result:{snapshot_id:snapshot.id,retirement_age:snapshot.inputs.retirement_age,years:result.input.years,projected_real_today_eur:result.projectedReal,required_capital_eur:result.requiredCapital,readiness_ratio:result.readinessRatio,sustainable_monthly_real_eur:result.sustainableMonthlyReal,gap_monthly:result.gapMonthly,warnings:result.warnings,assumptions:result.input,snapshot},changed:true};
    }
    case "run_goal": {
      const {label:ignored,...inputs}=args;
      const snapshot=await createScenario(ctx.env,ctx.userId,'goal',inputs,mutation),result=snapshot.result as ReturnType<typeof goal>;
      ctx.emitCard({type:'scenario',snapshot});
      return {result:{snapshot_id:snapshot.id,target:result.target,start_from_cash_and_investments:result.start,monthly:result.monthly,months:result.months,reached:result.reachedYearMonth,required_monthly_for_years:result.requiredMonthlyForYears,snapshot},changed:true};
    }
    case "get_portfolio": {
      const portfolio = ctx.state.portfolio;
      if (!portfolio) return { result: { connected: false, note: "No brokerage connected. The person can load sample data or state their investments value." }, changed: false };
      ctx.emitCard(portfolioCard(portfolio));
      return { result: { connected: true, market_value_eur: portfolio.summary.marketValueEur, gain_eur: portfolio.summary.gainEur, top_three_weight_pct: portfolio.summary.topThreeWeightPct, sectors: portfolio.sectors.map(item => ({ name: item.name, weight_pct: Math.round(item.weightPct * 10) / 10 })), holdings: portfolio.holdings.map(item => ({ symbol: item.symbol, name: item.name, value_eur: Math.round(item.valueEur), weight_pct: Math.round(item.weightPct * 10) / 10, one_year_change_pct: Math.round(item.oneYearChangePct * 10) / 10, quote: item.quoteSource })), pricing: portfolio.pricing.provider }, changed: false };
    }
    case "remember": {
      const text = String(args.text ?? "").trim();
      if (!text) return { result: { error: "empty" }, changed: false };
      if(/[\d€$£]/.test(text))return{result:{error:'Numeric information belongs in validated facts or an explicit scenario, not a memory note.'},changed:false};
      const memory = await addMemory(ctx.env, ctx.userId, text,mutation);
      ctx.emitCard({ type: "memory", text: memory.text });
      return { result: { saved: memory.text }, changed: true };
    }
    case "add_next_step": {
      const text = String(args.text ?? "").trim();
      if (!text) return { result: { error: "empty" }, changed: false };
      const step = await addNextStep(ctx.env, ctx.userId, text,mutation);
      ctx.emitCard({ type: "next_step", step });
      return { result: { added: step.text }, changed: true };
    }
    case "load_sample_data": {
      return {result:{error:'Use the explicit sample-household button and confirmation. The model cannot replace a household.'},changed:false};
    }
    case "finish_onboarding": {
      await upsertProfile(ctx.env, ctx.userId, { onboardingDone: true },mutation);
      return { result: { onboarding: "done" }, changed: true };
    }
    default:
      return { result: { error: `unknown tool ${name}` }, changed: false };
  }
}

/** Runs a tool and, if it changed stored data, refreshes and broadcasts the state. */
export async function runToolAndRefresh(name: string, args: unknown, ctx: ToolContext): Promise<Record<string, unknown>> {
  const outcome = await runTool(name, args, ctx);
  if (outcome.changed) {
    ctx.state = await buildState(ctx.env, ctx.userId);
    ctx.emitState(ctx.state);
  }
  return outcome.result;
}

export type { FactKey };
