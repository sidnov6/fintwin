/**
 * API contract between the FinTwin web app and the worker.
 * The engine types (facts, picture, scenario results) are re-exported so the
 * UI only needs one import for everything the server returns.
 */
import type { Fact, FactKey, Facts, Lang, MortgageResult, Picture, RetirementResult, GoalResult } from "@fintwin/engine";

export type { Fact, FactKey, Facts, Lang, MortgageResult, Picture, RetirementResult, GoalResult };

export interface Profile {
  name: string;
  email?: string;
  language: Lang;
  onboardingDone: boolean;
  voiceAutoplay: boolean;
  sampleLoaded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NextStep { id: string; text: string; done: boolean; createdAt: string }
export interface Memory { id: string; text: string; createdAt: string }

export interface PortfolioHolding {
  symbol: string; name: string; quantity: number; currency: string; sector: string;
  price: number; priceEur: number; valueEur: number; costBasisEur: number; gainEur: number; gainPct: number; oneYearChangePct: number; weightPct: number;
  quoteSource: "market" | "snapshot"; quoteAsOf: string;
}
export interface Portfolio {
  asOf: string;
  pricing: { provider: string; containsFallback: boolean; eurUsd: number };
  summary: { marketValueEur: number; costBasisEur: number; gainEur: number; gainPct: number; topThreeWeightPct: number };
  holdings: PortfolioHolding[];
  sectors: Array<{ name: string; valueEur: number; weightPct: number }>;
}

export interface AppState {
  profile: Profile | null;
  facts: Facts;
  picture: Picture;
  portfolio: Portfolio | null;
  nextSteps: NextStep[];
  memories: Memory[];
  ai: {
    live: boolean; provider: string; model: string; reasoning: string | null; voice: boolean;
    speechIn: { provider: string; model: string };
    speechOut: { provider: string; voice: string; maxChars: number; multilingual: boolean };
  };
  serverTime: string;
}

/** Cards the assistant can place inside the conversation. */
export type Card =
  | { type: "facts"; items: Array<{ key: FactKey; value: number | string }>; source: Fact["source"] }
  | { type: "mortgage"; result: MortgageResult[]; principal: number; months: number; currentPayment: number | null }
  | { type: "retirement"; result: RetirementResult; retirementAge: number | null }
  | { type: "goal"; result: GoalResult; label: string }
  | { type: "picture"; metrics: Picture["metrics"] }
  | { type: "portfolio"; summary: Portfolio["summary"]; sectors: Portfolio["sectors"]; top: Array<{ symbol: string; weightPct: number }> }
  | { type: "next_step"; step: NextStep }
  | { type: "memory"; text: string }
  | { type: "sample_loaded" }
  | { type: "policy"; reason: string };

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  cards: Card[];
  suggestions?: string[];
  sourceIds?: string[];
  mode?: "live" | "offline" | "policy" | "voice";
  /** Conversation bookkeeping (which fact the assistant is waiting for, what was skipped). */
  meta?: { pendingFact?: FactKey; skipped?: FactKey[]; onboarding?: boolean; opener?: boolean; lang?: Lang };
  createdAt: string;
}

export interface ChatRequest { text: string; language: Lang; mode?: "text" | "voice"; clientTime?: string }

/** Server-sent events emitted by POST /v1/chat. */
export type ChatEvent =
  | { type: "start"; messageId: string; mode: "live" | "offline" }
  | { type: "delta"; text: string }
  | { type: "card"; card: Card }
  | { type: "state"; state: AppState }
  | { type: "done"; message: Message }
  | { type: "error"; message: string };

export interface Envelope<T> { ok: true; data: T }
export interface ErrorEnvelope { ok: false; error: string }
