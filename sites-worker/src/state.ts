/**
 * Assembles the full application state for one user: profile, facts,
 * derived picture, optional sample portfolio with delayed public quotes,
 * next steps and memories.
 */
import { derivePicture, SAMPLE_HOLDINGS, SAMPLE_QUOTES, SAMPLE_AS_OF, SAMPLE_VERSION } from "@fintwin/engine";
import type { Facts, PortfolioSummary } from "@fintwin/engine";
import type { AppState, Portfolio, PortfolioHolding } from "@fintwin/contracts";
import { db, getHead, getFacts, getProfile, listMemories, listNextSteps, type Env } from "./db";
import { chatProvider, providerError, speechInProvider, speechOutProvider } from "./providers";
import {AppError} from './errors';
import { bankOverview, factNumber, sampleFacts } from '@fintwin/engine';

interface Quote { symbol: string; price: number; currency: string; oneYearChangePct: number; source: "market" | "snapshot"; asOf: string }

export async function samplePortfolio(): Promise<Portfolio> {
  const frozen = (symbol: string): Quote => ({ symbol, ...SAMPLE_QUOTES[symbol], source: "snapshot", asOf: SAMPLE_AS_OF });
  const [fx, ...quotes] = [frozen("EURUSD=X"), ...SAMPLE_HOLDINGS.map(holding => frozen(holding.symbol))];
  const eurUsd = Number(fx.price) || 1.1618;
  const holdings: PortfolioHolding[] = SAMPLE_HOLDINGS.map((holding, index) => {
    const quote = quotes[index];
    const priceEur = holding.currency === "USD" ? quote.price / eurUsd : quote.price;
    const valueEur = priceEur * holding.quantity;
    return { symbol: holding.symbol, name: holding.name, quantity: holding.quantity, currency: holding.currency, sector: holding.sector, price: quote.price, priceEur, valueEur, costBasisEur: holding.costBasisEur, gainEur: valueEur - holding.costBasisEur, gainPct: (valueEur / holding.costBasisEur - 1) * 100, oneYearChangePct: quote.oneYearChangePct, weightPct: 0, quoteSource: quote.source, quoteAsOf: quote.asOf };
  });
  const marketValueEur = holdings.reduce((sum, item) => sum + item.valueEur, 0);
  const costBasisEur = holdings.reduce((sum, item) => sum + item.costBasisEur, 0);
  holdings.forEach(item => { item.weightPct = marketValueEur ? item.valueEur / marketValueEur * 100 : 0; });
  const sectorMap = new Map<string, number>();
  holdings.forEach(item => sectorMap.set(item.sector, (sectorMap.get(item.sector) || 0) + item.valueEur));
  const sectors = [...sectorMap].map(([name, valueEur]) => ({ name, valueEur, weightPct: valueEur / marketValueEur * 100 })).sort((a, b) => b.valueEur - a.valueEur);
  const topThreeWeightPct = [...holdings].sort((a, b) => b.valueEur - a.valueEur).slice(0, 3).reduce((sum, item) => sum + item.weightPct, 0);
  return {
    asOf: quotes.reduce((latest, item) => item.asOf > latest ? item.asOf : latest, ""),
    pricing: { provider: `Frozen synthetic quotes · ${SAMPLE_VERSION} · not live`, containsFallback: true, eurUsd },
    summary: { marketValueEur, costBasisEur, gainEur: marketValueEur - costBasisEur, gainPct: (marketValueEur / costBasisEur - 1) * 100, topThreeWeightPct },
    holdings, sectors,
  };
}

export function portfolioSummary(portfolio: Portfolio | null): PortfolioSummary | null {
  if (!portfolio) return null;
  return { marketValueEur: portfolio.summary.marketValueEur, topThreeWeightPct: portfolio.summary.topThreeWeightPct, largestSector: portfolio.sectors[0]?.name ?? "", largestSectorWeightPct: portfolio.sectors[0]?.weightPct ?? 0, holdingsCount: portfolio.holdings.length };
}

export function aiInfo(env: Env): AppState["ai"] {
  const chat = chatProvider(env), speechIn = speechInProvider(env), speechOut = speechOutProvider(env);
  const paid = env.FINTWIN_ALLOW_PAID === '1';
  const realtime = Boolean(paid && env.OPENAI_API_KEY && env.REALTIME && env.FINTWIN_VOICE_MODE === 'realtime');
  return {
    live: paid && Boolean(chat), provider: chat?.id ?? "offline", model: chat?.model ?? "", reasoning: chat?.reasoningEffort ?? null,
    voice: paid && speechOut.id !== "none" && env.FINTWIN_VOICE_MODE !== 'text',
    speechIn: { provider: paid && env.FINTWIN_VOICE_MODE !== 'text' ? speechIn.id : 'none', model: speechIn.model },
    speechOut: { provider: speechOut.id, voice: speechOut.voice, maxChars: speechOut.maxChars, multilingual: speechOut.languages === "multilingual" },
    configurationError: providerError(env),
    realtime: { available: realtime, mode: env.FINTWIN_VOICE_MODE || 'text', model: env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1', voice: env.OPENAI_REALTIME_VOICE || 'marin', reason: realtime ? 'Configured; actual audio must be verified separately.' : !env.REALTIME ? 'This runtime has no Realtime transport. Text and chained fallback remain available.' : 'Realtime is not enabled. Use text or the configured fallback.' },
  };
}

export async function buildState(env: Env, userId: string, options: { facts?: Facts; skipPortfolio?: boolean } = {},attempt=0): Promise<AppState> {
  let now = new Date();
  const head = await getHead(env,userId);
  const [profile, facts, nextSteps, memories] = await Promise.all([getProfile(env, userId), options.facts ? Promise.resolve(options.facts) : getFacts(env, userId), listNextSteps(env, userId), listMemories(env, userId)]);
  if (profile?.sampleLoaded) now = new Date(SAMPLE_AS_OF);
  let portfolio: Portfolio | null = null;
  if (profile?.sampleLoaded && !options.skipPortfolio) {
    try { portfolio = await samplePortfolio(); } catch { portfolio = null; }
  }
  // A sample quote never silently rewrites a person's investments fact.
  const picture = derivePicture(facts, now, portfolioSummary(portfolio));
  const rows = await db(env).prepare('SELECT payload FROM scenario_snapshots WHERE user_id=? AND epoch=? ORDER BY created_at DESC,rowid DESC LIMIT 12').bind(userId,head.epoch).all<{payload:string}>();
  const scenarios = (rows.results??[]).map(row=>{const s=JSON.parse(row.payload); return {...s,stale:s.revision!==head.revision};});
  const after=await getHead(env,userId);
  if(after.revision!==head.revision||after.epoch!==head.epoch){if(attempt>=3)throw new AppError('state_changed',409,'The household is changing. Please refresh.');return buildState(env,userId,options,attempt+1);}
  return { revision: head.revision, epoch: head.epoch, sampleVersion: profile?.sampleLoaded ? SAMPLE_VERSION : null, scenarios, profile, facts, picture, portfolio, bank: profile?.sampleLoaded ? bankOverview(factNumber(sampleFacts(),'mortgage_payment_monthly')!) : null, nextSteps, memories, ai: aiInfo(env), serverTime: new Date().toISOString() };
}
