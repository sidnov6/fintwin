import { describe, expect, it } from "vitest";
import { derivePicture, goal, mortgage, normalizeFactValue, parseAmount, retirement, sampleFacts } from "@fintwin/engine";

const now = new Date("2026-09-02T10:00:00Z");

describe("mortgage engine", () => {
  it("matches the golden annuity payment", () => {
    expect(mortgage(240000, 4, 240).payment).toBe(1454.35);
    expect(mortgage(240000, 6, 240).payment).toBe(1719.43);
  });
  it("handles a zero rate", () => {
    const result = mortgage(240000, 0, 240);
    expect(result.payment).toBe(1000);
    expect(result.totalInterest).toBe(0);
  });
  it("never lowers payment or interest with a higher rate", () => {
    const low = mortgage(300000, 3, 300), high = mortgage(300000, 5, 300);
    expect(high.payment).toBeGreaterThan(low.payment);
    expect(high.totalInterest).toBeGreaterThan(low.totalInterest);
  });
  it("pays off sooner with special repayments", () => {
    const base = mortgage(240000, 4, 240), extra = mortgage(240000, 4, 240, 300);
    expect(extra.payoffMonths).toBeLessThan(base.payoffMonths);
    expect(extra.totalInterest).toBeLessThan(base.totalInterest);
  });
});

describe("retirement engine", () => {
  it("is monotonic in contribution and fee", () => {
    const base = retirement({ currentAssets: 50000, monthlyContribution: 500, years: 20, targetSpendingMonthly: 3000 });
    const more = retirement({ currentAssets: 50000, monthlyContribution: 800, years: 20, targetSpendingMonthly: 3000 });
    const fee = retirement({ currentAssets: 50000, monthlyContribution: 500, years: 20, annualFeePct: 1.5, targetSpendingMonthly: 3000 });
    expect(more.projectedReal).toBeGreaterThan(base.projectedReal);
    expect(fee.projectedReal).toBeLessThan(base.projectedReal);
    expect(base.requiredCapital).toBe(900000);
  });
  it("flags missing spending target instead of guessing", () => {
    const result = retirement({ currentAssets: 10000, monthlyContribution: 100, years: 10 });
    expect(result.readinessRatio).toBeNull();
    expect(result.warnings).toContain("spending_missing");
  });
});

describe("goal engine", () => {
  it("finds the month a target is reached", () => {
    const result = goal(100000, 20000, 1000, 4, now);
    expect(result.months).toBeGreaterThan(60);
    expect(result.reachedYearMonth).toMatch(/^\d{4}-\d{2}$/);
  });
  it("returns zero months when already reached", () => {
    expect(goal(1000, 5000, 0, 4, now).months).toBe(0);
  });
});

describe("picture", () => {
  it("derives the sample household consistently", () => {
    const picture = derivePicture(sampleFacts(now), now);
    const metric = (key: string) => picture.metrics.find(item => item.key === key)?.value;
    expect(metric("net_worth")).toBe(487350);
    expect(metric("free_cashflow")).toBe(568);
    expect(picture.insights.map(item => item.id)).toContain("mortgage_refix_horizon");
    expect(picture.mortgage?.monthsUntilRefix).toBe(13);
  });
  it("asks the most useful question first when empty", () => {
    const picture = derivePicture({}, now);
    expect(picture.openQuestions[0].key).toBe("income_net_monthly");
    expect(picture.metrics.every(metric => metric.value === null)).toBe(true);
  });
  it("does not list a mortgage as missing for renters", () => {
    const picture = derivePicture({ cash_liquid: { key: "cash_liquid", value: 5000, source: "user", updatedAt: "" }, property_value: { key: "property_value", value: 0, source: "user", updatedAt: "" } }, now);
    expect(picture.metrics.find(item => item.key === "net_worth")?.missing).not.toContain("mortgage_balance");
  });
});

describe("parsing", () => {
  it("reads German and English amounts", () => {
    expect(parseAmount("4.200", "de")).toBe(4200);
    expect(parseAmount("4,200", "en")).toBe(4200);
    expect(parseAmount("1.234,56", "de")).toBe(1234.56);
    expect(parseAmount("1,234.56", "en")).toBe(1234.56);
    expect(parseAmount("about 3.5k", "en")).toBe(3500);
    expect(parseAmount("1,5 Mio", "de")).toBe(1500000);
    expect(parseAmount("keine", "de")).toBe(0);
  });
  it("validates fact values", () => {
    expect(normalizeFactValue("age", 200)).toBeNull();
    expect(normalizeFactValue("income_protection", "maybe")).toBeNull();
    expect(normalizeFactValue("mortgage_fixed_until", "10/2027")).toBe("2027-10");
    expect(normalizeFactValue("mortgage_fixed_until", "2027-10")).toBe("2027-10");
  });
});
