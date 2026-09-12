/**
 * Runs the worker in-process against an in-memory SQLite database and walks
 * through real conversations in offline mode.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppState, ChatEvent, Message } from "@fintwin/contracts";
import worker from "../src/index";
import type { Env } from "../src/db";
import { getHead } from '../src/db';

import { testEnv } from './harness';

let env: Env;
const headers = { "content-type": "application/json", "oai-authenticated-user-id": "user-1", "oai-authenticated-user-email": "one@example.test" };
const call = async(path: string, init: RequestInit = {}) => {
  if(['PATCH','DELETE','POST'].includes(init.method??'')&&!path.includes('chat')){const body=JSON.parse(String(init.body??'{}'));init={...init,body:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:(await getHead(env,'user-1')).revision,confirmed:true,...body})};}
  return worker.fetch(new Request(`https://fintwin.test${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }), env);
};
const json = async <T,>(path: string, init: RequestInit = {}) => (await (await call(path, init)).json()) as { ok: boolean; data: T; error?: string };

async function say(text: string, language: "de" | "en" = "en") {
  const response = await call("/v1/chat", { method: "POST", body: JSON.stringify({ text, language }) });
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const raw = await response.text();
  const events = raw.split("\n\n").filter(Boolean).map(frame => JSON.parse(frame.split("\n").find(line => line.startsWith("data:"))!.slice(5)) as ChatEvent);
  const done = events.find(event => event.type === "done") as Extract<ChatEvent, { type: "done" }> | undefined;
  expect(done, `no done event for "${text}": ${raw.slice(0, 300)}`).toBeDefined();
  return { events, message: done!.message, text: done!.message.text, cards: done!.message.cards.map(card => card.type) };
}

beforeEach(() => { env = testEnv({FINTWIN_TRUST_PLATFORM:'verified-gateway'}).env; });

describe("worker", () => {
  it("requires a signed-in viewer", async () => {
    const response = await worker.fetch(new Request("https://fintwin.test/v1/state"), env);
    expect(response.status).toBe(401);
  });

  it("starts empty and opens the conversation", async () => {
    const state = await json<AppState>("/v1/state");
    expect(state.data.profile).toBeNull();
    expect(state.data.picture.openQuestions.length).toBeGreaterThan(5);
    const messages = await json<{ messages: Message[] }>("/v1/messages?language=en");
    expect(messages.data.messages[0].role).toBe("assistant");
    expect(messages.data.messages[0].text).toContain("FinTwin");
  });

  it("walks through onboarding in the chat and derives the picture", async () => {
    expect((await say("Hi, I'm Sid")).text).toContain("Sid");
    await say("Build wealth");
    await say("40");
    const income = await say("5.5k");
    expect(income.cards).toContain("facts");
    const spend = await say("3,500");
    expect((await json<AppState>('/v1/state')).data.picture.metrics.find(m=>m.key==='free_cashflow')?.value).toBe(2000);
    await say("15000");
    await say("Nothing invested yet");
    const last = await say("No debt");
    expect(last.message.meta?.onboarding).toBe(false);
    expect(last.cards).toContain("picture");
    const state = await json<AppState>("/v1/state");
    expect(state.data.profile?.onboardingDone).toBe(true);
    expect(state.data.facts.income_net_monthly?.value).toBe(5500);
    expect(state.data.picture.metrics.find(metric => metric.key === "net_worth")?.value).toBe(15000);
  });

  it("does not restart the introduction or accept acknowledgements as a name", async () => {
    await json<{ messages: Message[] }>("/v1/messages?language=en");
    const yes = await say("yes");
    expect(yes.text).toContain("How old are you");
    expect((await json<AppState>("/v1/state")).data.profile).toBeNull();

    const vague = await say("give name");
    expect(vague.text).toContain("How old are you");
    const named = await say("sid");
    expect(named.text).toContain("Sid");
    expect((await json<AppState>("/v1/state")).data.profile?.name).toBe("Sid");
  });

  it("stores a bare income answer once and advances without confirmation", async () => {
    await say("Sid");
    await say("Build wealth");
    await say("40");
    const income = await say("5000 euros");
    expect(income.text).toMatch(/goes out each month|monthly spending/i);
    expect(income.text).not.toMatch(/is that|confirm|net monthly income/i);

    const state = await json<AppState>("/v1/state");
    expect(state.data.facts.income_net_monthly?.value).toBe(5000);
  });

  it("keeps a retirement goal stated before the person's name", async () => {
    await json<{ messages: Message[] }>("/v1/messages?language=en");
    const goal = await say("I want to retire at 40.");
    expect(goal.cards).toContain('facts');

    const named = await say("sid");
    expect(named.text).toMatch(/old|age/i);
    const state = await json<AppState>("/v1/state");
    expect(state.data.profile?.name).toBe("Sid");
    expect(state.data.facts.retirement_age?.value).toBe(40);
    expect(state.data.facts.goal_primary?.value).toContain("retire at 40");
  });

  it("loads sample data without inventing a name or asking for one again", async () => {
    const loaded = await say("load sample data");
    expect(loaded.text).toContain("sample household");
    expect(loaded.text).not.toMatch(/may i know|what should i call|your name/i);
    await json('/v1/sample',{method:'POST'});
    const state = await json<AppState>("/v1/state");
    expect(state.data.profile?.name).toBe("");
    expect(state.data.profile?.onboardingDone).toBe(true);

    const next = await say("What is my net worth?");
    expect(next.text).toMatch(/net worth/i);
    expect(next.text).not.toMatch(/your name|call you/i);
  });

  it("understands stated facts and questions mid-conversation", async () => {
    await say("Sid");
    await say("skip"); await say("skip");
    const stated = await say("I earn 4000 net per month and my expenses are 2500");
    expect(stated.cards).toContain("facts");
    const state = await json<AppState>("/v1/state");
    expect(state.data.facts.income_net_monthly?.value).toBe(4000);
  });

  it("runs scenarios through tools with sample data", async () => {
    await json('/v1/sample',{method:'POST'});
    const state = await json<AppState>("/v1/state");
    expect(state.data.profile?.sampleLoaded).toBe(true);
    expect(state.data.facts.mortgage_balance?.value).toBe(240000);
    const rate = await say("What happens at 6%?");
    expect(rate.cards).toContain("scenario");
    expect(rate.text).toMatch(/1,719\.43/);
    const retire = await say("What does retiring at 63 look like?");
    expect(retire.cards).toContain("scenario");
    const million = await say("Wann erreiche ich 1 Million Euro?", "de");
    expect(million.cards).toContain("scenario");
    const portfolio = await say("Wie konzentriert ist mein Depot?", "de");
    expect(portfolio.cards).toContain("portfolio");
  });

  it("refuses product picks without leaving the person stranded", async () => {
    await say("Sid");
    const blocked = await say("Which ETF should I buy?");
    expect(blocked.message.mode).toBe("policy");
    expect(blocked.message.suggestions?.length).toBeGreaterThan(0);
  });

  it("edits facts from the picture and shows them in the thread", async () => {
    await say("Sid");
    const patched = await json<{ state: AppState; accepted: string[]; rejected: string[] }>("/v1/facts", { method: "PATCH", body: JSON.stringify({ facts: [{ key: "cash_liquid", value: 12000 }, { key: "age", value: 999 }] }) });
    expect(patched.data.accepted).toEqual(["cash_liquid"]);
    expect(patched.data.rejected).toEqual(["age"]);
    const messages = await json<{ messages: Message[] }>("/v1/messages?language=en");
    expect(messages.data.messages.some(message => message.role === "system" && message.cards[0]?.type === "facts")).toBe(true);
  });

  it("keeps users isolated", async () => {
    await say("Sid");
    await json("/v1/facts", { method: "PATCH", body: JSON.stringify({ facts: [{ key: "cash_liquid", value: 12000 }] }) });
    const other = await (await worker.fetch(new Request("https://fintwin.test/v1/state", { headers: { "oai-authenticated-user-id": "user-2" } }), env)).json() as { data: AppState };
    expect(other.data.profile).toBeNull();
    expect(Object.keys(other.data.facts)).toHaveLength(0);
  });

  it("resets everything on request", async () => {
    await say("Sid");
    await json("/v1/reset", { method: "POST" });
    const state = await json<AppState>("/v1/state");
    expect(state.data.profile).toBeNull();
  });
});
