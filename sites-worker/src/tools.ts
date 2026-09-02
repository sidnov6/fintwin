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

export interface ToolContext {
  env: Env;
  userId: string;
  lang: Lang;
  now: Date;
  state: AppState;
  emitCard(card: Card): void;
  emitState(state: AppState): void;
}

export interface ToolOutcome { result: Record<string, unknown>; changed: boolean }

export const TOOL_DEFS = [
  { type: "function", function: { name: "set_facts", description: "Store facts the person just told you (amounts in EUR, monthly where the key says monthly). Call this as soon as they state or correct a number. Keys: " + Object.keys(FACT_BY_KEY).join(", ") + ". income_protection is one of yes|no|unknown. mortgage_fixed_until is YYYY-MM.",
    parameters: { type: "object", properties: { facts: { type: "array", items: { type: "object", properties: { key: { type: "string" }, value: { type: ["number", "string"] }, note: { type: "string" } }, required: ["key", "value"] } } }, required: ["facts"] } } },
  { type: "function", function: { name: "set_name", description: "Store what the person wants to be called.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "run_mortgage", description: "Deterministic mortgage payment scenario. Defaults come from stored facts. Returns payments at 4/5/6% plus any given rate.", parameters: { type: "object", properties: { principal: { type: "number" }, rate_pct: { type: "number" }, months: { type: "number" }, special_repayment_monthly: { type: "number" } } } } },
  { type: "function", function: { name: "run_retirement", description: "Deterministic retirement baseline in today's euros using stored facts with optional overrides.", parameters: { type: "object", properties: { retirement_age: { type: "number" }, monthly_contribution: { type: "number" }, spending_monthly: { type: "number" }, pension_monthly: { type: "number" }, annual_return_pct: { type: "number" } } } } },
  { type: "function", function: { name: "run_goal", description: "When would cash plus investments reach a target amount, given monthly investing and a return assumption (default 4%).", parameters: { type: "object", properties: { target_amount: { type: "number" }, monthly: { type: "number" }, annual_return_pct: { type: "number" }, label: { type: "string" } }, required: ["target_amount"] } } },
  { type: "function", function: { name: "get_portfolio", description: "Returns the connected sample brokerage holdings, sectors and concentration if sample data is loaded.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "remember", description: "Save a durable note about the person's preferences, situation or worries that is not a numeric fact (e.g. 'wants to keep the house', 'nervous about single stocks').", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } },
  { type: "function", function: { name: "add_next_step", description: "Add a concrete next step the person agreed to.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } },
  { type: "function", function: { name: "load_sample_data", description: "Fill the picture with the clearly labelled synthetic sample household (family, house, mortgage, brokerage) so the person can explore.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "finish_onboarding", description: "Mark the first conversation as done once the basics are covered or the person wants to move on.", parameters: { type: "object", properties: {} } } },
] as const;

export type ToolName = typeof TOOL_DEFS[number]["function"]["name"];

function num(value: unknown): number | null { const n = typeof value === "number" ? value : Number(value); return Number.isFinite(n) ? n : null; }

export function portfolioCard(portfolio: Portfolio): Card {
  return { type: "portfolio", summary: portfolio.summary, sectors: portfolio.sectors, top: [...portfolio.holdings].sort((a, b) => b.valueEur - a.valueEur).slice(0, 3).map(item => ({ symbol: item.symbol, weightPct: item.weightPct })) };
}

export async function runTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  const facts = ctx.state.facts;
  switch (name as ToolName) {
    case "set_facts": {
      const list = Array.isArray(args.facts) ? args.facts as Array<{ key: string; value: unknown; note?: string }> : [];
      const { accepted, rejected } = await setFacts(ctx.env, ctx.userId, list, "user");
      if (accepted.length) ctx.emitCard({ type: "facts", items: accepted.map(fact => ({ key: fact.key, value: fact.value })), source: "user" });
      return { result: { stored: accepted.map(fact => ({ key: fact.key, value: fact.value })), rejected }, changed: accepted.length > 0 };
    }
    case "set_name": {
      const name = String(args.name ?? "").trim().slice(0, 80);
      if (name.length < 1) return { result: { error: "empty name" }, changed: false };
      await upsertProfile(ctx.env, ctx.userId, { name });
      return { result: { name }, changed: true };
    }
    case "run_mortgage": {
      const principal = num(args.principal) ?? factNumber(facts, "mortgage_balance");
      if (!principal || principal <= 0) return { result: { error: "mortgage balance unknown; ask for it" }, changed: false };
      const months = Math.max(1, Math.min(600, Math.round(num(args.months) ?? factNumber(facts, "mortgage_remaining_months") ?? 240)));
      const special = Math.max(0, num(args.special_repayment_monthly) ?? 0);
      const rates = [4, 5, 6]; const given = num(args.rate_pct); if (given !== null && !rates.includes(given)) rates.unshift(given);
      const result = rates.map(rate => mortgage(principal, rate, months, special));
      const currentPayment = factNumber(facts, "mortgage_payment_monthly");
      ctx.emitCard({ type: "mortgage", result, principal, months, currentPayment });
      await saveScenarioRun(ctx.env, ctx.userId, "mortgage", { principal, months, special, rates }, result);
      return { result: { principal, months, special_repayment_monthly: special, current_payment: currentPayment, scenarios: result.map(item => ({ rate_pct: item.annualRatePct, monthly_payment: item.payment, total_interest: item.totalInterest })), note: "Planning model, not a lender quote. Assumed 20-year term when unknown." }, changed: false };
    }
    case "run_retirement": {
      const age = factNumber(facts, "age"), retirementAge = num(args.retirement_age) ?? factNumber(facts, "retirement_age");
      if (age === null || retirementAge === null) return { result: { error: "age or retirement age unknown; ask for it" }, changed: false };
      const assets = (factNumber(facts, "investments_value") ?? 0) + (factNumber(facts, "retirement_assets") ?? 0);
      const income = factNumber(facts, "income_net_monthly"), expenses = factNumber(facts, "expenses_monthly");
      const contribution = num(args.monthly_contribution) ?? factNumber(facts, "monthly_saving") ?? Math.max(0, income !== null && expenses !== null ? income - expenses : 0);
      const result = retirement({ currentAssets: assets, monthlyContribution: contribution, years: retirementAge - age, annualReturnPct: num(args.annual_return_pct) ?? 5, expectedPensionMonthly: num(args.pension_monthly) ?? factNumber(facts, "expected_pension_monthly"), targetSpendingMonthly: num(args.spending_monthly) ?? factNumber(facts, "retirement_spending_monthly") });
      ctx.emitCard({ type: "retirement", result, retirementAge });
      await saveScenarioRun(ctx.env, ctx.userId, "retirement", result.input, result);
      return { result: { retirement_age: retirementAge, years: result.input.years, projected_real_today_eur: result.projectedReal, required_capital_eur: result.requiredCapital, readiness_ratio: result.readinessRatio, sustainable_monthly_real_eur: result.sustainableMonthlyReal, monthly_gap_eur: result.gapMonthly, warnings: result.warnings, assumptions: result.input }, changed: false };
    }
    case "run_goal": {
      const target = num(args.target_amount);
      if (!target || target <= 0) return { result: { error: "target amount missing" }, changed: false };
      const start = (factNumber(facts, "cash_liquid") ?? 0) + (factNumber(facts, "investments_value") ?? 0);
      const income = factNumber(facts, "income_net_monthly"), expenses = factNumber(facts, "expenses_monthly");
      const monthly = num(args.monthly) ?? factNumber(facts, "monthly_saving") ?? Math.max(0, income !== null && expenses !== null ? income - expenses : 0);
      const result = goal(target, start, monthly, num(args.annual_return_pct) ?? 4, ctx.now);
      const label = String(args.label ?? factText(facts, "goal_primary") ?? "").slice(0, 80);
      ctx.emitCard({ type: "goal", result, label });
      await saveScenarioRun(ctx.env, ctx.userId, "goal", { target, start, monthly }, result);
      return { result: { target, start_from_cash_and_investments: start, monthly, months: result.months, reached: result.reachedYearMonth, required_monthly_for_years: result.requiredMonthlyForYears }, changed: false };
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
      const memory = await addMemory(ctx.env, ctx.userId, text);
      ctx.emitCard({ type: "memory", text: memory.text });
      return { result: { saved: memory.text }, changed: true };
    }
    case "add_next_step": {
      const text = String(args.text ?? "").trim();
      if (!text) return { result: { error: "empty" }, changed: false };
      const step = await addNextStep(ctx.env, ctx.userId, text);
      ctx.emitCard({ type: "next_step", step });
      return { result: { added: step.text }, changed: true };
    }
    case "load_sample_data": {
      const sample = sampleFacts(ctx.now);
      await setFacts(ctx.env, ctx.userId, Object.values(sample).map(fact => ({ key: fact.key, value: fact.value })), "sample");
      await upsertProfile(ctx.env, ctx.userId, { sampleLoaded: true, onboardingDone: true });
      ctx.emitCard({ type: "sample_loaded" });
      return { result: { loaded: Object.keys(sample), note: "All values are synthetic and labelled as sample." }, changed: true };
    }
    case "finish_onboarding": {
      await upsertProfile(ctx.env, ctx.userId, { onboardingDone: true });
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
