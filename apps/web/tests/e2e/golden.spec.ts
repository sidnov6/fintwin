import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("seven-minute golden path remains navigable without an LLM", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Synthetische Daten")).toBeVisible();
  await expect(page.getByText("€487,320")).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(v => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]);

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("Klarheit statt Punktzahl.")).toBeVisible();
  await expect(page.getByText("Zinsbindung endet in 14 Monaten")).toBeVisible();

  await page.getByRole("button", { name: "Twin", exact: true }).click();
  await page.getByRole("button", { name: "Korrigieren" }).click();
  await page.getByLabel("Bestätigtes Zielalter").fill("64");
  await page.getByRole("button", { name: "Vorschlag bestätigen" }).click();
  await expect(page.getByText("Twin v18")).toBeVisible();

  await page.getByRole("button", { name: "Szenarien", exact: true }).click();
  await expect(page.getByText("4% nominal")).toBeVisible();
  await page.getByRole("button", { name: /Ruhestand/ }).click();
  await expect(page.getByText(/Projected real assets/)).toBeVisible();

  await page.getByRole("button", { name: "Fragen", exact: true }).click();
  await page.getByRole("button", { name: "Recommend the best product to buy" }).click();
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText(/keine konkrete Produktempfehlung/)).toBeVisible();
});

test("English smoke flow and adviser brief work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch language" }).click();
  await expect(page.getByText("Good morning, Michael & Anna.")).toBeVisible();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: /Adviser Brief/ }).click();
  await expect(page.getByText("Household Brief")).toBeVisible();
  await expect(page.getByText(/no product prescription/i)).toBeVisible();
});
