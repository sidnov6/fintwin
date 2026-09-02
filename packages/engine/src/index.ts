/**
 * FinTwin engine — pure, deterministic, dependency-free.
 *
 * Everything the companion knows about a person is a set of typed facts.
 * This module defines those facts, derives the "financial picture" from them
 * (net worth, cashflow, runway, scenarios, insights, open questions) and
 * provides the deterministic calculators the assistant's tools call.
 *
 * No user-specific number should ever come from a language model; it comes
 * from here, with source ids attached.
 */

export type Lang = "de" | "en";
export type L = Record<Lang, string>;

export type FactKey =
  | "age" | "household" | "dependents"
  | "income_net_monthly" | "expenses_monthly" | "monthly_saving"
  | "cash_liquid" | "investments_value" | "retirement_assets" | "property_value"
  | "mortgage_balance" | "mortgage_rate_pct" | "mortgage_fixed_until" | "mortgage_remaining_months" | "mortgage_payment_monthly"
  | "other_debt"
  | "retirement_age" | "retirement_spending_monthly" | "expected_pension_monthly"
  | "goal_primary" | "goal_target_amount" | "goal_target_year"
  | "income_protection" | "emergency_target_months";

export type FactType = "money" | "number" | "percent" | "months" | "age" | "year_month" | "year" | "text" | "choice";
export type FactSource = "user" | "edit" | "sample" | "derived";
export type FactGroup = "person" | "cashflow" | "assets" | "debts" | "retirement" | "goals" | "protection";

export interface FactDef {
  key: FactKey;
  type: FactType;
  group: FactGroup;
  label: L;
  /** How the companion asks for it in conversation. */
  question: L;
  /** Why it matters — shown next to open questions. */
  why: L;
  /** Core facts drive onboarding order and completeness. */
  core: boolean;
  choices?: string[];
  choiceLabels?: Record<string, L>;
  min?: number;
  max?: number;
}

export interface Fact {
  key: FactKey;
  value: number | string;
  source: FactSource;
  updatedAt: string;
  note?: string;
}

export type Facts = Partial<Record<FactKey, Fact>>;

export const FACT_DEFS: FactDef[] = [
  { key: "age", type: "age", group: "person", core: true, min: 16, max: 100,
    label: { de: "Alter", en: "Age" },
    question: { de: "Wie alt sind Sie?", en: "How old are you?" },
    why: { de: "Bestimmt den Zeitraum bis zur Rente.", en: "Sets the runway to retirement." } },
  { key: "income_net_monthly", type: "money", group: "cashflow", core: true, min: 0, max: 1e6,
    label: { de: "Nettoeinkommen / Monat", en: "Net income / month" },
    question: { de: "Was kommt bei Ihnen netto im Monat rein – ungefähr?", en: "Roughly what comes in each month after tax?" },
    why: { de: "Grundlage für Cashflow und Sparquote.", en: "Basis for cashflow and savings rate." } },
  { key: "expenses_monthly", type: "money", group: "cashflow", core: true, min: 0, max: 1e6,
    label: { de: "Ausgaben / Monat", en: "Spending / month" },
    question: { de: "Und was geht im Monat ungefähr raus – alles zusammen, inklusive Miete oder Rate?", en: "And roughly what goes out each month, everything included, rent or mortgage too?" },
    why: { de: "Nötig für Cashflow und Notfallreserve.", en: "Needed for cashflow and emergency runway." } },
  { key: "cash_liquid", type: "money", group: "assets", core: true, min: 0, max: 1e9,
    label: { de: "Verfügbares Guthaben", en: "Cash & savings" },
    question: { de: "Wie viel liegt auf Giro- und Tagesgeldkonten, auf das Sie sofort zugreifen könnten?", en: "How much sits in current and savings accounts that you could reach immediately?" },
    why: { de: "Bestimmt Ihre Notfallreserve.", en: "Determines your emergency runway." } },
  { key: "investments_value", type: "money", group: "assets", core: true, min: 0, max: 1e9,
    label: { de: "Depot & Anlagen", en: "Investments" },
    question: { de: "Wie viel haben Sie angelegt – ETFs, Aktien, Fonds, Krypto?", en: "How much do you have invested — ETFs, shares, funds, crypto?" },
    why: { de: "Teil des Nettovermögens und der Zielplanung.", en: "Part of net worth and goal planning." } },
  { key: "retirement_assets", type: "money", group: "retirement", core: false, min: 0, max: 1e9,
    label: { de: "Altersvorsorge-Vermögen", en: "Retirement accounts" },
    question: { de: "Gibt es zusätzlich Altersvorsorge-Verträge oder Betriebsrenten mit einem heutigen Wert?", en: "Do you also have retirement accounts or pension pots with a value today?" },
    why: { de: "Zählt für die Rentenprojektion.", en: "Counts toward the retirement projection." } },
  { key: "property_value", type: "money", group: "assets", core: true, min: 0, max: 1e9,
    label: { de: "Immobilie (Wert)", en: "Property (value)" },
    question: { de: "Besitzen Sie eine Immobilie? Wenn ja, was wäre sie heute ungefähr wert?", en: "Do you own property? If so, roughly what is it worth today?" },
    why: { de: "Größter Vermögensposten für viele Haushalte.", en: "Often the largest single asset." } },
  { key: "mortgage_balance", type: "money", group: "debts", core: true, min: 0, max: 1e9,
    label: { de: "Hypothek (Restschuld)", en: "Mortgage (balance)" },
    question: { de: "Wie hoch ist die Restschuld auf der Immobilie?", en: "How much is still owed on the mortgage?" },
    why: { de: "Nötig für Nettovermögen und Anschlussfinanzierung.", en: "Needed for net worth and refix planning." } },
  { key: "mortgage_rate_pct", type: "percent", group: "debts", core: false, min: 0, max: 20,
    label: { de: "Hypothekenzins", en: "Mortgage rate" },
    question: { de: "Welchen Zinssatz zahlen Sie aktuell?", en: "What rate are you paying at the moment?" },
    why: { de: "Zeigt, wie stark eine neue Zinsbindung wirkt.", en: "Shows how much a refix would change." } },
  { key: "mortgage_fixed_until", type: "year_month", group: "debts", core: false,
    label: { de: "Zinsbindung bis", en: "Fixed rate until" },
    question: { de: "Bis wann läuft die Zinsbindung? Monat und Jahr genügen.", en: "When does the fixed-rate period end? Month and year is enough." },
    why: { de: "Wichtigster Termin bei Wohneigentum.", en: "The most important date for homeowners." } },
  { key: "mortgage_remaining_months", type: "months", group: "debts", core: false, min: 1, max: 600,
    label: { de: "Restlaufzeit", en: "Remaining term" },
    question: { de: "Wie viele Jahre soll die Immobilie noch abbezahlt werden?", en: "Over how many more years do you plan to repay?" },
    why: { de: "Bestimmt die Rate in jedem Zinsszenario.", en: "Sets the payment in every rate scenario." } },
  { key: "mortgage_payment_monthly", type: "money", group: "debts", core: false, min: 0, max: 1e6,
    label: { de: "Aktuelle Rate", en: "Current payment" },
    question: { de: "Wie hoch ist Ihre aktuelle monatliche Rate?", en: "What is your current monthly payment?" },
    why: { de: "Vergleichswert für Zinsszenarien.", en: "Baseline for rate scenarios." } },
  { key: "other_debt", type: "money", group: "debts", core: true, min: 0, max: 1e9,
    label: { de: "Sonstige Schulden", en: "Other debt" },
    question: { de: "Gibt es sonst noch Kredite – Auto, Ratenkauf, Studienkredit?", en: "Any other loans — car, instalments, student loan?" },
    why: { de: "Reduziert das Nettovermögen.", en: "Reduces net worth." } },
  { key: "monthly_saving", type: "money", group: "cashflow", core: false, min: 0, max: 1e6,
    label: { de: "Monatliche Sparrate", en: "Monthly investing" },
    question: { de: "Wie viel legen Sie im Monat bewusst zurück oder investieren Sie?", en: "How much do you deliberately put aside or invest each month?" },
    why: { de: "Treibt jede Zielprojektion.", en: "Drives every goal projection." } },
  { key: "retirement_age", type: "age", group: "retirement", core: true, min: 40, max: 80,
    label: { de: "Wunsch-Rentenalter", en: "Target retirement age" },
    question: { de: "Mit welchem Alter möchten Sie aufhören zu arbeiten?", en: "At what age would you like to stop working?" },
    why: { de: "Zielpunkt der Rentenprojektion.", en: "The target of the retirement projection." } },
  { key: "retirement_spending_monthly", type: "money", group: "retirement", core: false, min: 0, max: 1e6,
    label: { de: "Wunschbudget im Ruhestand", en: "Retirement spending target" },
    question: { de: "Wie viel möchten Sie im Ruhestand monatlich zur Verfügung haben – in heutigen Euro?", en: "How much would you like to live on per month in retirement, in today's euros?" },
    why: { de: "Ohne diesen Wert gibt es keinen Deckungsgrad.", en: "Without it there is no readiness ratio." } },
  { key: "expected_pension_monthly", type: "money", group: "retirement", core: false, min: 0, max: 1e6,
    label: { de: "Erwartete Rente / Monat", en: "Expected pension / month" },
    question: { de: "Was steht in Ihrer letzten Renteninformation als erwartete monatliche Rente?", en: "What does your latest pension statement show as expected monthly pension?" },
    why: { de: "Reduziert das nötige Kapital.", en: "Reduces the capital you need." } },
  { key: "goal_primary", type: "text", group: "goals", core: true,
    label: { de: "Wichtigstes Ziel", en: "Main goal" },
    question: { de: "Was ist das eine Ziel, das Ihnen beim Thema Geld am wichtigsten ist?", en: "What is the one money goal that matters most to you right now?" },
    why: { de: "Richtet jede Antwort an Ihrem Ziel aus.", en: "Anchors every answer to what you want." } },
  { key: "goal_target_amount", type: "money", group: "goals", core: false, min: 0, max: 1e10,
    label: { de: "Zielbetrag", en: "Target amount" },
    question: { de: "Gibt es dafür einen konkreten Betrag?", en: "Is there a specific amount attached to that goal?" },
    why: { de: "Macht das Ziel berechenbar.", en: "Makes the goal computable." } },
  { key: "goal_target_year", type: "year", group: "goals", core: false, min: 2000, max: 2100,
    label: { de: "Zieljahr", en: "Target year" },
    question: { de: "Bis wann?", en: "By when?" },
    why: { de: "Bestimmt die nötige Sparrate.", en: "Determines the saving needed." } },
  { key: "income_protection", type: "choice", group: "protection", core: false, choices: ["yes", "no", "unknown"],
    choiceLabels: { yes: { de: "Ja, vorhanden", en: "Yes, in place" }, no: { de: "Nein", en: "No" }, unknown: { de: "Weiß ich nicht", en: "Not sure" } },
    label: { de: "Einkommensabsicherung", en: "Income protection" },
    question: { de: "Haben Sie eine Absicherung, falls Sie länger nicht arbeiten könnten – etwa eine Berufsunfähigkeitsversicherung?", en: "Do you have cover if you could not work for a long time, such as disability insurance?" },
    why: { de: "Nicht bestätigt heißt nicht falsch – aber offen.", en: "Unconfirmed does not mean wrong, but it is open." } },
  { key: "emergency_target_months", type: "months", group: "cashflow", core: false, min: 0, max: 36,
    label: { de: "Reserve-Ziel", en: "Reserve target" },
    question: { de: "Wie viele Monatsausgaben möchten Sie als Reserve halten?", en: "How many months of spending do you want to keep as a reserve?" },
    why: { de: "Standard sind 6 Monate.", en: "The default is 6 months." } },
  { key: "household", type: "choice", group: "person", core: false, choices: ["single", "partner", "family"],
    choiceLabels: { single: { de: "Allein", en: "Just me" }, partner: { de: "Mit Partner/in", en: "With a partner" }, family: { de: "Familie", en: "Family" } },
    label: { de: "Haushalt", en: "Household" },
    question: { de: "Planen Sie allein, mit Partner/in oder als Familie?", en: "Are you planning alone, with a partner, or as a family?" },
    why: { de: "Beeinflusst Reserve und Absicherung.", en: "Affects reserve and protection." } },
  { key: "dependents", type: "number", group: "person", core: false, min: 0, max: 20,
    label: { de: "Kinder / Angehörige", en: "Dependents" },
    question: { de: "Wie viele Kinder oder Angehörige hängen finanziell von Ihnen ab?", en: "How many children or dependents rely on you financially?" },
    why: { de: "Wichtig für Absicherung und Ziele.", en: "Matters for protection and goals." } },
];

export const FACT_BY_KEY: Record<FactKey, FactDef> = Object.fromEntries(FACT_DEFS.map(def => [def.key, def])) as Record<FactKey, FactDef>;
export const FACT_KEYS = FACT_DEFS.map(def => def.key);
export function isFactKey(value: string): value is FactKey { return (FACT_KEYS as string[]).includes(value); }

/** Coerce and validate a raw value for a fact. Returns null when unusable. */
export function normalizeFactValue(key: FactKey, raw: unknown): number | string | null {
  const def = FACT_BY_KEY[key];
  if (!def) return null;
  if (def.type === "text") { const text = String(raw ?? "").trim().slice(0, 240); return text ? text : null; }
  if (def.type === "choice") { const choice = String(raw ?? "").trim().toLowerCase(); return def.choices?.includes(choice) ? choice : null; }
  if (def.type === "year_month") {
    const text = String(raw ?? "").trim();
    const match = text.match(/^(\d{4})-(\d{1,2})$/) || text.match(/^(\d{1,2})[./](\d{4})$/);
    if (!match) return null;
    const year = match[0].startsWith(match[1]) && match[1].length === 4 ? Number(match[1]) : Number(match[2]);
    const month = match[1].length === 4 ? Number(match[2]) : Number(match[1]);
    if (year < 1990 || year > 2100 || month < 1 || month > 12) return null;
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(value)) return null;
  if (def.min !== undefined && value < def.min) return null;
  if (def.max !== undefined && value > def.max) return null;
  return def.type === "money" ? Math.round(value * 100) / 100 : Math.round(value * 100) / 100;
}

export function factNumber(facts: Facts, key: FactKey): number | null {
  const fact = facts[key];
  if (!fact) return null;
  return typeof fact.value === "number" && Number.isFinite(fact.value) ? fact.value : null;
}
export function factText(facts: Facts, key: FactKey): string | null {
  const fact = facts[key];
  return fact && typeof fact.value === "string" ? fact.value : null;
}

// ---------------------------------------------------------------------------
// Deterministic calculators
// ---------------------------------------------------------------------------

const cents = (value: number) => Math.round(value * 100) / 100;

export interface MortgageResult {
  principal: number;
  annualRatePct: number;
  months: number;
  specialRepayment: number;
  payment: number;
  totalInterest: number;
  payoffMonths: number;
  engineVersion: "mortgage-1.0.0";
}

/** Annuity mortgage with monthly posting rounded to cents (ROUND_HALF_UP). */
export function mortgage(principal: number, annualRatePct: number, months: number, specialRepayment = 0): MortgageResult {
  const r = annualRatePct / 100 / 12;
  const payment = r > 0 ? cents(principal * r / (1 - Math.pow(1 + r, -months))) : cents(principal / months);
  let balance = principal, totalInterest = 0, payoffMonths = 0;
  while (balance > 0 && payoffMonths < months + 1) {
    const interest = cents(balance * r);
    let principalPaid = cents(payment - interest + specialRepayment);
    if (principalPaid > balance) principalPaid = balance;
    balance = cents(balance - principalPaid);
    totalInterest = cents(totalInterest + interest);
    payoffMonths++;
    if (principalPaid <= 0 && r > 0 && payoffMonths > months) break;
  }
  return { principal, annualRatePct, months, specialRepayment, payment, totalInterest, payoffMonths, engineVersion: "mortgage-1.0.0" };
}

export interface RetirementInput {
  currentAssets: number;
  monthlyContribution: number;
  years: number;
  annualReturnPct?: number;
  annualFeePct?: number;
  inflationPct?: number;
  expectedPensionMonthly?: number | null;
  targetSpendingMonthly?: number | null;
  withdrawalRatePct?: number;
}
export interface RetirementResult {
  input: Required<Omit<RetirementInput, "expectedPensionMonthly" | "targetSpendingMonthly">> & { expectedPensionMonthly: number | null; targetSpendingMonthly: number | null };
  projectedNominal: number;
  projectedReal: number;
  gapMonthly: number | null;
  requiredCapital: number | null;
  readinessRatio: number | null;
  sustainableMonthlyReal: number;
  warnings: string[];
  engineVersion: "retirement-1.0.0";
}

/** Retirement baseline in today's euros. Sensitivity analysis, not a forecast. */
export function retirement(input: RetirementInput): RetirementResult {
  const annualReturnPct = input.annualReturnPct ?? 5, annualFeePct = input.annualFeePct ?? 0.5, inflationPct = input.inflationPct ?? 2, withdrawalRatePct = input.withdrawalRatePct ?? 4;
  const years = Math.max(0, input.years), months = Math.round(years * 12);
  const net = (annualReturnPct - annualFeePct) / 100;
  const rm = Math.pow(1 + net, 1 / 12) - 1;
  const fv = input.currentAssets * Math.pow(1 + rm, months) + (rm === 0 ? input.monthlyContribution * months : input.monthlyContribution * ((Math.pow(1 + rm, months) - 1) / rm));
  const projectedNominal = cents(fv);
  const projectedReal = cents(fv / Math.pow(1 + inflationPct / 100, years));
  const pension = input.expectedPensionMonthly ?? null, spending = input.targetSpendingMonthly ?? null;
  const warnings: string[] = [];
  let gapMonthly: number | null = null, requiredCapital: number | null = null, readinessRatio: number | null = null;
  if (spending !== null) {
    gapMonthly = cents(Math.max(spending - (pension ?? 0), 0));
    requiredCapital = cents(gapMonthly * 12 / (withdrawalRatePct / 100));
    readinessRatio = requiredCapital > 0 ? Math.round(projectedReal / requiredCapital * 1000) / 1000 : 9.99;
    if (pension === null) warnings.push("pension_missing");
  } else warnings.push("spending_missing");
  if (years <= 0) warnings.push("already_at_retirement_age");
  const sustainableMonthlyReal = cents(projectedReal * (withdrawalRatePct / 100) / 12);
  return {
    input: { currentAssets: input.currentAssets, monthlyContribution: input.monthlyContribution, years, annualReturnPct, annualFeePct, inflationPct, withdrawalRatePct, expectedPensionMonthly: pension, targetSpendingMonthly: spending },
    projectedNominal, projectedReal, gapMonthly, requiredCapital, readinessRatio, sustainableMonthlyReal, warnings, engineVersion: "retirement-1.0.0",
  };
}

export interface GoalResult {
  target: number;
  start: number;
  monthly: number;
  annualReturnPct: number;
  months: number | null;
  reachedYearMonth: string | null;
  requiredMonthlyForYears: Array<{ years: number; monthly: number }>;
  engineVersion: "goal-1.0.0";
}

/** Months until start + monthly contributions (compounding) reach target. */
export function goal(target: number, start: number, monthly: number, annualReturnPct: number, now: Date): GoalResult {
  const r = annualReturnPct / 100 / 12;
  let months: number | null = 0, balance = start;
  if (start < target) {
    months = 0;
    while (balance < target && months < 1200) { balance = balance * (1 + r) + monthly; months++; }
    if (balance < target) months = null;
  }
  const reached = months === null ? null : (() => { const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; })();
  const requiredMonthlyForYears = [5, 10, 15, 20].map(years => {
    const n = years * 12, growth = Math.pow(1 + r, n);
    const need = target - start * growth;
    const monthlyNeeded = need <= 0 ? 0 : r === 0 ? need / n : need * r / (growth - 1);
    return { years, monthly: cents(Math.max(0, monthlyNeeded)) };
  });
  return { target, start, monthly, annualReturnPct, months, reachedYearMonth: reached, requiredMonthlyForYears, engineVersion: "goal-1.0.0" };
}

// ---------------------------------------------------------------------------
// The financial picture
// ---------------------------------------------------------------------------

export type Tone = "positive" | "neutral" | "attention" | "unknown";
export type Unit = "eur" | "eur_month" | "months" | "percent" | "ratio" | "count";

export interface Metric {
  key: "net_worth" | "free_cashflow" | "runway" | "savings_rate" | "total_assets" | "total_liabilities" | "liquid";
  label: L;
  value: number | null;
  unit: Unit;
  tone: Tone;
  sourceIds: string[];
  missing: FactKey[];
  note?: L;
}

export interface Insight {
  id: string;
  severity: "good" | "info" | "attention";
  title: L;
  body: L;
  sourceIds: string[];
  /** A message the person can send to dig in. */
  ask: L;
}

export interface OpenQuestion { key: FactKey; label: L; question: L; why: L; impact: number }

export interface PortfolioSummary { marketValueEur: number; topThreeWeightPct: number; largestSector: string; largestSectorWeightPct: number; holdingsCount: number }

export interface Picture {
  asOf: string;
  metrics: Metric[];
  insights: Insight[];
  openQuestions: OpenQuestion[];
  completeness: { known: number; total: number; coreKnown: number; coreTotal: number };
  mortgage: { sensitivity: MortgageResult[]; assumedMonths: boolean; monthsUntilRefix: number | null; currentPayment: number | null } | null;
  retirement: RetirementResult | null;
  goal: GoalResult | null;
  assumptions: L[];
}

const eur = (value: number, lang: Lang) => new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);

function sid(key: FactKey, facts: Facts) { const fact = facts[key]; return fact ? `fact_${key}_${fact.source}` : `missing_${key}`; }

export function monthsBetween(now: Date, yearMonth: string): number {
  const [year, month] = yearMonth.split("-").map(Number);
  return (year - now.getUTCFullYear()) * 12 + (month - (now.getUTCMonth() + 1));
}

export function derivePicture(facts: Facts, now: Date, portfolio?: PortfolioSummary | null): Picture {
  const n = (key: FactKey) => factNumber(facts, key);
  const income = n("income_net_monthly"), expenses = n("expenses_monthly"), cash = n("cash_liquid"), investments = n("investments_value"), retirementAssets = n("retirement_assets"), property = n("property_value");
  const mortgageBalance = n("mortgage_balance"), otherDebt = n("other_debt"), saving = n("monthly_saving"), age = n("age"), retirementAge = n("retirement_age");
  const assetsKnown = [cash, investments, retirementAssets, property].some(value => value !== null);
  const totalAssets = assetsKnown ? (cash ?? 0) + (investments ?? 0) + (retirementAssets ?? 0) + (property ?? 0) : null;
  const liabilitiesKnown = [mortgageBalance, otherDebt].some(value => value !== null);
  const totalLiabilities = liabilitiesKnown ? (mortgageBalance ?? 0) + (otherDebt ?? 0) : null;
  const netWorth = totalAssets !== null ? totalAssets - (totalLiabilities ?? 0) : null;
  const freeCashflow = income !== null && expenses !== null ? cents(income - expenses) : null;
  const savingsRate = income && freeCashflow !== null ? Math.round(freeCashflow / income * 1000) / 10 : null;
  const reserveTarget = n("emergency_target_months") ?? 6;
  const runway = cash !== null && expenses ? Math.round(cash / expenses * 10) / 10 : null;
  const assumptions: L[] = [];

  const metrics: Metric[] = [
    { key: "net_worth", label: { de: "Nettovermögen", en: "Net worth" }, value: netWorth, unit: "eur", tone: netWorth === null ? "unknown" : netWorth >= 0 ? "neutral" : "attention",
      sourceIds: (["cash_liquid", "investments_value", "retirement_assets", "property_value", "mortgage_balance", "other_debt"] as FactKey[]).filter(key => facts[key]).map(key => sid(key, facts)),
      missing: (["cash_liquid", "investments_value", "property_value", "mortgage_balance", "other_debt"] as FactKey[]).filter(key => !facts[key] && !(key === "mortgage_balance" && property === 0)),
      note: netWorth !== null && !liabilitiesKnown ? { de: "Ohne bekannte Schulden", en: "No debts recorded yet" } : undefined },
    { key: "free_cashflow", label: { de: "Frei pro Monat", en: "Free each month" }, value: freeCashflow, unit: "eur_month", tone: freeCashflow === null ? "unknown" : freeCashflow > 0 ? "positive" : "attention",
      sourceIds: (["income_net_monthly", "expenses_monthly"] as FactKey[]).filter(key => facts[key]).map(key => sid(key, facts)), missing: (["income_net_monthly", "expenses_monthly"] as FactKey[]).filter(key => !facts[key]) },
    { key: "runway", label: { de: "Notfallreserve", en: "Emergency runway" }, value: runway, unit: "months", tone: runway === null ? "unknown" : runway >= reserveTarget ? "positive" : runway >= reserveTarget / 2 ? "neutral" : "attention",
      sourceIds: (["cash_liquid", "expenses_monthly"] as FactKey[]).filter(key => facts[key]).map(key => sid(key, facts)), missing: (["cash_liquid", "expenses_monthly"] as FactKey[]).filter(key => !facts[key]),
      note: { de: `Ziel: ${reserveTarget} Monate`, en: `Target: ${reserveTarget} months` } },
    { key: "savings_rate", label: { de: "Sparquote", en: "Savings rate" }, value: savingsRate, unit: "percent", tone: savingsRate === null ? "unknown" : savingsRate >= 15 ? "positive" : savingsRate > 0 ? "neutral" : "attention",
      sourceIds: (["income_net_monthly", "expenses_monthly"] as FactKey[]).filter(key => facts[key]).map(key => sid(key, facts)), missing: (["income_net_monthly", "expenses_monthly"] as FactKey[]).filter(key => !facts[key]) },
    { key: "total_assets", label: { de: "Vermögen gesamt", en: "Total assets" }, value: totalAssets, unit: "eur", tone: totalAssets === null ? "unknown" : "neutral", sourceIds: [], missing: [] },
    { key: "total_liabilities", label: { de: "Schulden gesamt", en: "Total debt" }, value: totalLiabilities ?? (assetsKnown ? 0 : null), unit: "eur", tone: "neutral", sourceIds: [], missing: [] },
    { key: "liquid", label: { de: "Sofort verfügbar", en: "Available now" }, value: cash, unit: "eur", tone: cash === null ? "unknown" : "neutral", sourceIds: cash === null ? [] : [sid("cash_liquid", facts)], missing: cash === null ? ["cash_liquid"] : [] },
  ];

  // Mortgage sensitivity
  let mortgageBlock: Picture["mortgage"] = null;
  if (mortgageBalance && mortgageBalance > 0) {
    const months = n("mortgage_remaining_months");
    const assumedMonths = months === null;
    const term = months ?? 240;
    if (assumedMonths) assumptions.push({ de: "Restlaufzeit der Hypothek mit 20 Jahren angenommen.", en: "Mortgage term assumed at 20 years." });
    const fixedUntil = factText(facts, "mortgage_fixed_until");
    mortgageBlock = { sensitivity: [4, 5, 6].map(rate => mortgage(mortgageBalance, rate, term)), assumedMonths, monthsUntilRefix: fixedUntil ? monthsBetween(now, fixedUntil) : null, currentPayment: n("mortgage_payment_monthly") };
  }

  // Retirement
  let retirementBlock: RetirementResult | null = null;
  if (age !== null && retirementAge !== null && (investments !== null || retirementAssets !== null)) {
    retirementBlock = retirement({ currentAssets: (investments ?? 0) + (retirementAssets ?? 0), monthlyContribution: saving ?? Math.max(0, freeCashflow ?? 0), years: retirementAge - age, expectedPensionMonthly: n("expected_pension_monthly"), targetSpendingMonthly: n("retirement_spending_monthly") });
    assumptions.push({ de: "Rente: 5 % Rendite, 0,5 % Kosten, 2 % Inflation, 4 % Entnahme.", en: "Retirement: 5% return, 0.5% fees, 2% inflation, 4% withdrawal." });
    if (saving === null) assumptions.push({ de: "Sparrate mit dem freien Cashflow angenommen.", en: "Monthly investing assumed equal to free cashflow." });
  }

  // Goal
  let goalBlock: GoalResult | null = null;
  const goalAmount = n("goal_target_amount");
  if (goalAmount && goalAmount > 0) {
    goalBlock = goal(goalAmount, (cash ?? 0) + (investments ?? 0), saving ?? Math.max(0, freeCashflow ?? 0), 4, now);
    assumptions.push({ de: "Ziel: 4 % Rendite auf Guthaben und Depot.", en: "Goal: 4% return on cash and investments." });
  }

  // Insights (neutral wording: topics to review, not verdicts)
  const insights: Insight[] = [];
  if (mortgageBlock?.monthsUntilRefix !== null && mortgageBlock?.monthsUntilRefix !== undefined && mortgageBlock.monthsUntilRefix <= 18 && mortgageBlock.monthsUntilRefix >= -1) {
    const m = mortgageBlock.monthsUntilRefix, delta = cents(mortgageBlock.sensitivity[2].payment - mortgageBlock.sensitivity[0].payment);
    insights.push({ id: "mortgage_refix_horizon", severity: "attention", title: { de: `Zinsbindung endet in ${m} Monaten`, en: `Fixed rate ends in ${m} months` },
      body: { de: `Zwischen 4 % und 6 % liegen bei Ihrer Restschuld rund ${eur(delta, "de")} Rate pro Monat.`, en: `Between 4% and 6% your payment would differ by about ${eur(delta, "en")} a month.` },
      sourceIds: [sid("mortgage_balance", facts), sid("mortgage_fixed_until", facts)], ask: { de: "Was passiert mit meiner Rate bei 4, 5 oder 6 %?", en: "What happens to my payment at 4, 5 or 6%?" } });
  }
  if (runway !== null) {
    if (runway < reserveTarget) insights.push({ id: "runway_below_target", severity: runway < reserveTarget / 2 ? "attention" : "info", title: { de: `Reserve reicht ${runway} Monate`, en: `Reserve covers ${runway} months` },
      body: { de: `Ihr Ziel sind ${reserveTarget} Monate. Es fehlen etwa ${eur(Math.max(0, reserveTarget * (expenses ?? 0) - (cash ?? 0)), "de")}.`, en: `Your target is ${reserveTarget} months. About ${eur(Math.max(0, reserveTarget * (expenses ?? 0) - (cash ?? 0)), "en")} is missing.` },
      sourceIds: [sid("cash_liquid", facts), sid("expenses_monthly", facts)], ask: { de: "Wie baue ich meine Reserve am besten auf?", en: "How do I build my reserve up?" } });
    else insights.push({ id: "runway_ok", severity: "good", title: { de: `Reserve deckt ${runway} Monate`, en: `Reserve covers ${runway} months` },
      body: { de: `Das liegt über Ihrem Ziel von ${reserveTarget} Monaten.`, en: `That is above your ${reserveTarget}-month target.` }, sourceIds: [sid("cash_liquid", facts), sid("expenses_monthly", facts)],
      ask: { de: "Ist ein Teil meiner Reserve zu viel Liquidität?", en: "Is part of my reserve more cash than I need?" } });
    if (cash !== null && expenses && cash > reserveTarget * expenses + 12 * (saving ?? 0) + 5000) insights.push({ id: "liquidity_above_floor", severity: "info", title: { de: "Mehr Guthaben als Reserve-Ziel", en: "More cash than your reserve target" },
      body: { de: `Etwa ${eur(cash - reserveTarget * expenses, "de")} liegen über der Reserve. Ob das eine Aufgabe hat, ist eine gute Frage für Sie.`, en: `About ${eur(cash - reserveTarget * expenses, "en")} sits above the reserve. Whether it has a purpose is a fair question.` },
      sourceIds: [sid("cash_liquid", facts)], ask: { de: "Was könnte ich mit dem Guthaben über der Reserve tun?", en: "What could the cash above my reserve be for?" } });
  }
  if (freeCashflow !== null && freeCashflow < 0) insights.push({ id: "negative_cashflow", severity: "attention", title: { de: "Ausgaben über Einnahmen", en: "Spending exceeds income" },
    body: { de: `Pro Monat fehlen ${eur(-freeCashflow, "de")}. Das ist der erste Punkt, den wir uns ansehen sollten.`, en: `You are short ${eur(-freeCashflow, "en")} a month. That is the first thing to look at.` },
    sourceIds: [sid("income_net_monthly", facts), sid("expenses_monthly", facts)], ask: { de: "Wo geht mein Geld hin?", en: "Where is my money going?" } });
  if (savingsRate !== null && savingsRate >= 15) insights.push({ id: "savings_rate_good", severity: "good", title: { de: `Sparquote ${savingsRate} %`, en: `Savings rate ${savingsRate}%` },
    body: { de: "Das ist ein solider Wert. Die Frage ist, wohin das Geld fließt.", en: "That is solid. The question is where it goes." }, sourceIds: [sid("income_net_monthly", facts), sid("expenses_monthly", facts)], ask: { de: "Fließt mein freier Cashflow sinnvoll?", en: "Is my free cashflow going somewhere useful?" } });
  if (income !== null && (facts.income_protection?.value ?? "unknown") === "unknown") insights.push({ id: "protection_unconfirmed", severity: "info", title: { de: "Einkommensabsicherung nicht bestätigt", en: "Income protection not confirmed" },
    body: { de: "Ich weiß nicht, ob Ihr Einkommen bei längerer Krankheit abgesichert ist. Das ist eine Angabe, keine Bewertung.", en: "I do not know whether your income is covered if you could not work. That is a missing fact, not a verdict." },
    sourceIds: [sid("income_protection", facts)], ask: { de: "Warum ist Einkommensabsicherung relevant?", en: "Why does income protection matter?" } });
  if (retirementBlock) {
    if (retirementBlock.readinessRatio !== null) {
      const pct = Math.round(retirementBlock.readinessRatio * 100);
      insights.push({ id: "retirement_readiness", severity: pct >= 100 ? "good" : pct >= 80 ? "info" : "attention", title: { de: `Rente mit ${retirementAge}: ${pct} % Deckung`, en: `Retiring at ${retirementAge}: ${pct}% covered` },
        body: { de: `Modellrechnung in heutigen Euro: ${eur(retirementBlock.projectedReal, "de")} gegenüber ${eur(retirementBlock.requiredCapital ?? 0, "de")} Bedarf.`, en: `Model in today's euros: ${eur(retirementBlock.projectedReal, "en")} against ${eur(retirementBlock.requiredCapital ?? 0, "en")} needed.` },
        sourceIds: [sid("retirement_age", facts), sid("investments_value", facts), sid("retirement_spending_monthly", facts)], ask: { de: "Welche Annahme verändert mein Rentenergebnis am stärksten?", en: "Which assumption changes my retirement result the most?" } });
    } else insights.push({ id: "retirement_input_gap", severity: "info", title: { de: "Rentenbild noch unvollständig", en: "Retirement picture incomplete" },
      body: { de: `Mit ${retirementAge} hätten Sie modellhaft rund ${eur(retirementBlock.projectedReal, "de")} in heutigen Euro. Ob das reicht, weiß ich erst mit Ihrem Wunschbudget.`, en: `At ${retirementAge} the model gives about ${eur(retirementBlock.projectedReal, "en")} in today's euros. Whether that is enough depends on your spending target.` },
      sourceIds: [sid("retirement_age", facts)], ask: { de: "Wie sieht meine Rente mit dem Wunschbudget aus?", en: "What does retirement look like with my spending target?" } });
  }
  if (property !== null && totalAssets && property / totalAssets > 0.7) insights.push({ id: "property_share", severity: "info", title: { de: `${Math.round(property / totalAssets * 100)} % des Vermögens in der Immobilie`, en: `${Math.round(property / totalAssets * 100)}% of assets in property` },
    body: { de: "Das ist typisch für Eigentümer, aber wenig flexibel.", en: "Common for homeowners, but not flexible." }, sourceIds: [sid("property_value", facts)], ask: { de: "Wie flexibel ist mein Vermögen wirklich?", en: "How flexible is my wealth really?" } });
  if (portfolio && portfolio.topThreeWeightPct >= 60) insights.push({ id: "portfolio_concentration", severity: "info", title: { de: `Top 3 Positionen = ${Math.round(portfolio.topThreeWeightPct)} % des Depots`, en: `Top 3 holdings = ${Math.round(portfolio.topThreeWeightPct)}% of portfolio` },
    body: { de: `${portfolio.largestSector} macht ${Math.round(portfolio.largestSectorWeightPct)} % aus. Ein Rückgang dort trifft mehrere Positionen gleichzeitig.`, en: `${portfolio.largestSector} is ${Math.round(portfolio.largestSectorWeightPct)}%. A fall there would hit several positions at once.` },
    sourceIds: ["portfolio_live_value"], ask: { de: "Wie konzentriert ist mein Depot?", en: "How concentrated is my portfolio?" } });
  if (goalBlock && goalBlock.months !== null && goalBlock.months > 0) insights.push({ id: "goal_projection", severity: "info", title: { de: `Zielbetrag rechnerisch ${goalBlock.reachedYearMonth?.slice(0, 4)}`, en: `Goal amount reached around ${goalBlock.reachedYearMonth?.slice(0, 4)}` },
    body: { de: `Bei ${eur(goalBlock.monthly, "de")} im Monat und 4 % Rendite.`, en: `At ${eur(goalBlock.monthly, "en")} a month and 4% return.` }, sourceIds: [sid("goal_target_amount", facts)], ask: { de: "Wie erreiche ich mein Ziel früher?", en: "How could I reach my goal sooner?" } });

  const order: Record<Insight["severity"], number> = { attention: 0, info: 1, good: 2 };
  insights.sort((a, b) => order[a.severity] - order[b.severity]);

  // Open questions, ranked by impact on what is still unknown
  const impact: Partial<Record<FactKey, number>> = { income_net_monthly: 10, expenses_monthly: 10, cash_liquid: 9, age: 8, investments_value: 7, property_value: 6, mortgage_balance: 6, other_debt: 5, retirement_age: 6, goal_primary: 6, monthly_saving: 5, retirement_spending_monthly: 4, expected_pension_monthly: 3, mortgage_fixed_until: 5, mortgage_rate_pct: 3, mortgage_remaining_months: 3, mortgage_payment_monthly: 2, retirement_assets: 3, goal_target_amount: 3, income_protection: 3, emergency_target_months: 1, household: 2, dependents: 2 };
  const hasMortgage = mortgageBalance !== null && mortgageBalance > 0, hasProperty = property !== null && property > 0;
  const openQuestions: OpenQuestion[] = FACT_DEFS.filter(def => !facts[def.key])
    .filter(def => !(def.key.startsWith("mortgage_") && def.key !== "mortgage_balance" && !hasMortgage))
    .filter(def => !(def.key === "mortgage_balance" && !hasProperty && property !== null))
    .filter(def => !(def.key === "goal_target_amount" && !facts.goal_primary))
    .filter(def => !(def.key === "goal_target_year" && !facts.goal_target_amount))
    .filter(def => !(def.key === "retirement_spending_monthly" && retirementAge === null))
    .filter(def => !(def.key === "expected_pension_monthly" && retirementAge === null))
    .map(def => ({ key: def.key, label: def.label, question: def.question, why: def.why, impact: impact[def.key] ?? 1 }))
    .sort((a, b) => b.impact - a.impact);

  const coreDefs = FACT_DEFS.filter(def => def.core);
  const completeness = { known: FACT_DEFS.filter(def => facts[def.key]).length, total: FACT_DEFS.length, coreKnown: coreDefs.filter(def => facts[def.key]).length, coreTotal: coreDefs.length };
  return { asOf: now.toISOString(), metrics, insights, openQuestions, completeness, mortgage: mortgageBlock, retirement: retirementBlock, goal: goalBlock, assumptions };
}

// ---------------------------------------------------------------------------
// Sample household (clearly labelled synthetic data)
// ---------------------------------------------------------------------------

export function sampleFacts(now: Date): Facts {
  const updatedAt = now.toISOString();
  const entries: Array<[FactKey, number | string]> = [
    ["age", 52], ["household", "family"], ["dependents", 2],
    ["income_net_monthly", 7240], ["expenses_monthly", 6672], ["monthly_saving", 568],
    ["cash_liquid", 61900], ["investments_value", 148850], ["retirement_assets", 96600], ["property_value", 420000],
    ["mortgage_balance", 240000], ["mortgage_rate_pct", 2.15], ["mortgage_fixed_until", "2027-10"], ["mortgage_remaining_months", 240], ["mortgage_payment_monthly", 1420],
    ["other_debt", 0], ["retirement_age", 63], ["retirement_spending_monthly", 3800], ["expected_pension_monthly", 2100],
    ["goal_primary", "Retire at 63 with the house paid off"], ["income_protection", "unknown"], ["emergency_target_months", 6],
  ];
  return Object.fromEntries(entries.map(([key, value]) => [key, { key, value, source: "sample", updatedAt } satisfies Fact])) as Facts;
}

export const SAMPLE_HOLDINGS = [
  { symbol: "AAPL", name: "Apple", quantity: 90, currency: "USD", costBasisEur: 14718, sector: "Technology" },
  { symbol: "MSFT", name: "Microsoft", quantity: 60, currency: "USD", costBasisEur: 17558, sector: "Technology" },
  { symbol: "NVDA", name: "NVIDIA", quantity: 120, currency: "USD", costBasisEur: 9812, sector: "Technology" },
  { symbol: "VWCE.DE", name: "Vanguard FTSE All-World ETF", quantity: 300, currency: "EUR", costBasisEur: 33000, sector: "Global equity ETF" },
  { symbol: "SAP.DE", name: "SAP", quantity: 100, currency: "EUR", costBasisEur: 15000, sector: "Technology" },
  { symbol: "VOW3.DE", name: "Volkswagen preference", quantity: 80, currency: "EUR", costBasisEur: 9200, sector: "Automotive" },
] as const;

export const SAMPLE_QUOTES: Record<string, { price: number; currency: string; oneYearChangePct: number }> = {
  AAPL: { price: 316.85, currency: "USD", oneYearChangePct: 38.4 }, MSFT: { price: 507.29, currency: "USD", oneYearChangePct: 1.3 },
  NVDA: { price: 220.78, currency: "USD", oneYearChangePct: 29.4 }, "VWCE.DE": { price: 166.66, currency: "EUR", oneYearChangePct: 22.7 },
  "SAP.DE": { price: 190.9, currency: "EUR", oneYearChangePct: -17 }, "VOW3.DE": { price: 77.68, currency: "EUR", oneYearChangePct: -17.1 },
  "EURUSD=X": { price: 1.1618, currency: "USD", oneYearChangePct: 0 },
};

// ---------------------------------------------------------------------------
// Parsing helpers shared by the offline companion and the UI
// ---------------------------------------------------------------------------

/** Parse a human money/number expression: "4.200", "4,200", "4k", "1,5 Mio", "€ 500", "none". */
export function parseAmount(text: string, lang: Lang): number | null {
  const lower = text.toLowerCase().trim();
  if (/^(keine|nichts|nein|none|nothing|no|zero|null|0)\b/.test(lower)) return 0;
  const match = lower.replace(/€|eur|euro/g, " ").match(/(-?\d[\d.,\s']*)\s*(k|tsd|tausend|thousand|mio|m|million|millionen|mn)?\b/);
  if (!match) return null;
  let digits = match[1].replace(/\s|'/g, "");
  const suffix = match[2] ?? "";
  // Decide decimal vs thousands separator.
  if (/[.,]/.test(digits)) {
    const lastSep = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
    const decimals = digits.length - lastSep - 1;
    const sepCount = (digits.match(/[.,]/g) || []).length;
    if (sepCount === 1 && decimals === 3) digits = digits.replace(/[.,]/g, "");
    else if (sepCount === 1 && decimals <= 2) digits = digits.slice(0, lastSep).replace(/[.,]/g, "") + "." + digits.slice(lastSep + 1);
    else if (sepCount > 1) { const decimalChar = lang === "de" ? "," : "."; digits = digits.replace(new RegExp(`[${decimalChar === "," ? "." : ","}]`, "g"), "").replace(decimalChar, "."); }
    else digits = digits.replace(/[.,]/g, "");
  }
  let value = Number(digits);
  if (!Number.isFinite(value)) return null;
  if (/^(k|tsd|tausend|thousand)$/.test(suffix)) value *= 1000;
  if (/^(mio|m|million|millionen|mn)$/.test(suffix)) value *= 1e6;
  return Math.round(value * 100) / 100;
}
