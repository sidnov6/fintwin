/**
 * Assembles the full application state for one user: profile, facts,
 * derived picture, optional sample portfolio with delayed public quotes,
 * next steps and memories.
 */
import { derivePicture, SAMPLE_HOLDINGS, SAMPLE_QUOTES } from "@fintwin/engine";
import type { Facts, PortfolioSummary } from "@fintwin/engine";
import type { AppState, Portfolio, PortfolioHolding } from "@fintwin/contracts";
import { getFacts, getProfile, listMemories, listNextSteps, type Env } from "./db";
import { chatProvider, speechInProvider, speechOutProvider } from "./providers";

interface Quote { symbol: string; price: number; currency: string; oneYearChangePct: number; source: "market" | "snapshot"; asOf: string }
const quoteCache = new Map<string, { value: Quote; cachedAt: number }>();

async function fetchQuote(symbol: string): Promise<Quote> {
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.cachedAt < 5 * 60_000) return cached.value;
  const snapshot = SAMPLE_QUOTES[symbol];
  const fallback: Quote = { symbol, price: snapshot.price, currency: snapshot.currency, oneYearChangePct: snapshot.oneYearChangePct, source: "snapshot", asOf: "2026-08-31T20:00:00Z" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`, { headers: { "user-agent": "Mozilla/5.0 (compatible; FinTwin/2.0)", accept: "application/json" }, signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error("quote unavailable");
    const payload = await response.json() as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; currency?: string; regularMarketTime?: number }; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } };
    const result = payload.chart?.result?.[0];
    const closes = (result?.indicators?.quote?.[0]?.close || []).filter((value): value is number => Number.isFinite(value as number));
    const price = Number(result?.meta?.regularMarketPrice ?? closes.at(-1));
    if (!Number.isFinite(price)) throw new Error("no price");
    const first = closes[0] || price;
    const value: Quote = { symbol, price, currency: result?.meta?.currency || fallback.currency, oneYearChangePct: first ? (price / first - 1) * 100 : 0, source: "market", asOf: new Date((result?.meta?.regularMarketTime || Date.now() / 1000) * 1000).toISOString() };
    quoteCache.set(symbol, { value, cachedAt: Date.now() });
    return value;
  } catch {
    quoteCache.set(symbol, { value: fallback, cachedAt: Date.now() });
    return fallback;
  }
}

export async function samplePortfolio(): Promise<Portfolio> {
  const [fx, ...quotes] = await Promise.all([fetchQuote("EURUSD=X"), ...SAMPLE_HOLDINGS.map(holding => fetchQuote(holding.symbol))]);
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
    pricing: { provider: "Yahoo Finance public chart feed, delayed; snapshot fallback", containsFallback: quotes.some(item => item.source === "snapshot"), eurUsd },
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
  return {
    live: Boolean(chat), provider: chat?.id ?? "offline", model: chat?.model ?? "", reasoning: chat?.reasoningEffort ?? null,
    voice: speechOut.id !== "none",
    speechIn: { provider: speechIn.id, model: speechIn.model },
    speechOut: { provider: speechOut.id, voice: speechOut.voice, maxChars: speechOut.maxChars, multilingual: speechOut.languages === "multilingual" },
  };
}

export async function buildState(env: Env, userId: string, options: { facts?: Facts; skipPortfolio?: boolean } = {}): Promise<AppState> {
  const now = new Date();
  const [profile, facts, nextSteps, memories] = await Promise.all([getProfile(env, userId), options.facts ? Promise.resolve(options.facts) : getFacts(env, userId), listNextSteps(env, userId), listMemories(env, userId)]);
  let portfolio: Portfolio | null = null;
  if (profile?.sampleLoaded && !options.skipPortfolio) {
    try { portfolio = await samplePortfolio(); } catch { portfolio = null; }
  }
  // Keep the investments fact in step with the live sample portfolio value.
  if (portfolio && facts.investments_value?.source === "sample") facts.investments_value = { ...facts.investments_value, value: Math.round(portfolio.summary.marketValueEur) };
  const picture = derivePicture(facts, now, portfolioSummary(portfolio));
  return { profile, facts, picture, portfolio, nextSteps, memories, ai: aiInfo(env), serverTime: now.toISOString() };
}
