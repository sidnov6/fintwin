import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Each test gets its own signed-in viewer so state never leaks between runs. */
test.beforeEach(async ({ context, page }, info) => {
  await context.setExtraHTTPHeaders({ "oai-authenticated-user-id": `e2e-${info.testId}-${Date.now()}` });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function say(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: /on your mind|beschäftigt/ });
  const stop = page.locator(".composer .send.stop");
  if (await stop.count()) await stop.click(); // stop FinTwin speaking, as a person would
  await box.fill(text);
  await box.press("Enter");
  await expect(page.getByRole("log").locator(".msg.user").last()).toContainText(text);
  await expect(page.locator(".caret, .typing")).toHaveCount(0, { timeout: 20_000 });
}

test("a new person is onboarded inside the conversation and the picture fills up", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("log")).toContainText(/What should I call you/);
  await say(page, "I'm Sid");
  await expect(page.getByRole("log")).toContainText(/Nice to meet you, Sid/);
  await page.getByRole("button", { name: "Build wealth" }).click();
  await expect(page.locator(".caret, .typing")).toHaveCount(0, { timeout: 20_000 });
  await say(page, "41");
  await say(page, "5200");
  await say(page, "3400");
  await expect(page.getByRole("log")).toContainText(/€1,800/);
  const rail = page.getByRole("complementary", { name: "Your picture" });
  await expect(rail).toContainText("€1,800");
  await expect(rail).toContainText("Savings rate");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(item => ["critical", "serious"].includes(item.impact ?? ""))).toEqual([]);
});

test("facts edited in the picture show up in the thread and change the numbers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "English" }).click();
  await say(page, "Sid");
  await page.getByRole("tab", { name: "Picture" }).click();
  await page.getByRole("button", { name: "Edit: Cash & savings" }).click();
  await page.getByLabel(/How much sits in current and savings accounts/).fill("18000");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("€18,000").first()).toBeVisible();
  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByRole("log")).toContainText("Updated");
  await expect(page.getByRole("complementary", { name: "Your picture" })).toContainText("€18,000");
});

test("sample data unlocks scenarios, cards and the planner", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Load sample data" }).first().click();
  await expect(page.locator(".caret, .typing")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole("log")).toContainText(/sample household/i);
  await say(page, "What happens to my payment at 4, 5 or 6%?");
  await expect(page.getByRole("log")).toContainText("1,719.43");
  await expect(page.getByRole("log").locator(".card").last()).toContainText("Mortgage refix");
  await page.getByRole("tab", { name: "Plan" }).click();
  await expect(page.getByRole("heading", { name: "What if?" })).toBeVisible();
  await expect(page.getByText("€1,454", { exact: false }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Retirement" }).click();
  await expect(page.getByText(/Required/)).toBeVisible();
});

test("German is a first-class language", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Deutsch" }).click();
  await expect(page.getByRole("log")).toContainText(/Wie darf ich Sie nennen/);
  await say(page, "Ich heiße Anna");
  await expect(page.getByRole("log")).toContainText(/Freut mich, Anna/);
  await say(page, "Beispieldaten laden");
  await expect(page.getByRole("log")).toContainText(/Nettovermögen/);
  await expect(page.getByRole("complementary", { name: "Ihr Bild" })).toContainText("Zinsbindung endet");
});

test("product picks are declined without stranding the person", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "English" }).click();
  await say(page, "Sid");
  await say(page, "Which ETF should I buy?");
  await expect(page.getByRole("log")).toContainText(/cannot pick a specific product/);
  await expect(page.getByRole("button", { name: /What matters when choosing ETFs/ })).toBeVisible();
});
