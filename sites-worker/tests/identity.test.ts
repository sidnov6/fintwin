/**
 * Identity has to survive a browser that refuses cookies, which is what happens
 * when the app is embedded in an iframe. Without this the app forgets the person
 * between turns and starts asking for their name again.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppState, ChatEvent } from "@fintwin/contracts";
import worker from "../src/index";
import type { Env } from "../src/db";

function d1(database: DatabaseSync): NonNullable<Env["DB"]> {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) { params = values.map(value => value === undefined ? null : value); return statement; },
      async first<T>() { return (database.prepare(sql).get(...(params as never[])) as T | undefined) ?? null; },
      async all<T>() { return { results: database.prepare(sql).all(...(params as never[])) as T[] }; },
      async run() { return database.prepare(sql).run(...(params as never[])); },
    };
    return statement;
  };
  return { prepare, async batch(statements) { for (const item of statements) await item.run(); return []; } };
}

let env: Env;
const DEVICE = "608f59ce-62ad-44e4-9724-eafde91b7040";
const OTHER = "11111111-2222-3333-4444-555555555555";

const call = (path: string, headers: Record<string, string>, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://fintwin.test${path}`, { ...init, headers: { "content-type": "application/json", ...headers } }), env);

async function say(text: string, headers: Record<string, string>) {
  const response = await call("/v1/chat", headers, { method: "POST", body: JSON.stringify({ text, language: "en" }) });
  const raw = await response.text();
  const events = raw.split("\n\n").filter(Boolean).map(frame => JSON.parse(frame.split("\n").find(line => line.startsWith("data:"))!.slice(5)) as ChatEvent);
  return (events.find(event => event.type === "done") as Extract<ChatEvent, { type: "done" }>).message.text;
}
const profileName = async (headers: Record<string, string>) =>
  ((await (await call("/v1/state", headers)).json()) as { data: AppState }).data.profile?.name ?? null;

beforeEach(() => { env = { DB: d1(new DatabaseSync(":memory:")) }; });

describe("identity without cookies", () => {
  it("remembers the person across turns using only the device header", async () => {
    const headers = { "x-fintwin-device": DEVICE };
    await say("Hey, what's up? How are things going?", headers);
    expect(await say("You can call me Sid, I guess.", headers)).toContain("Sid");
    expect(await profileName(headers)).toBe("Sid");
    // The turn that used to lose the name.
    const third = await say("I want to retire early. That's all I want to do.", headers);
    expect(third).not.toMatch(/what should i call you|what name should i use/i);
    expect(await profileName(headers)).toBe("Sid");
  });

  it("keeps two devices apart", async () => {
    await say("Call me Sid", { "x-fintwin-device": DEVICE });
    expect(await profileName({ "x-fintwin-device": DEVICE })).toBe("Sid");
    expect(await profileName({ "x-fintwin-device": OTHER })).toBeNull();
  });

  it("still requires some identity", async () => {
    expect((await call("/v1/state", {})).status).toBe(401);
    expect((await call("/v1/state", { "x-fintwin-device": "not-a-uuid" })).status).toBe(401);
  });

  it("lets a signed-in platform user override the device header", async () => {
    await say("Call me Sid", { "x-fintwin-device": DEVICE });
    const signedIn = { "x-fintwin-device": DEVICE, "oai-authenticated-user-id": "real-user" };
    expect(await profileName(signedIn)).toBeNull();
    await say("Call me Anna", signedIn);
    expect(await profileName(signedIn)).toBe("Anna");
    expect(await profileName({ "x-fintwin-device": DEVICE })).toBe("Sid");
  });
});
