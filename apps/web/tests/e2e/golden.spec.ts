import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("deutscher Kernpfad bleibt vollständig bedienbar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Guten Morgen,")).toBeVisible();
  await expect(page.getByText("492.860 €")).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(v => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]);
  await page.getByRole("button", { name: "Finanzcheck", exact: true }).click();
  await expect(page.getByText("Klarheit statt Gesamtnote.")).toBeVisible();
  await expect(page.getByText("Zinsbindung endet am 31.10.2027")).toBeVisible();
  await page.getByRole("button", { name: /Wohneigentum/ }).click();
  await page.getByLabel("Notizen").fill("Darlehensvertrag liegt vollständig vor.");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Darlehensvertrag liegt vollständig vor.")).toBeVisible();
  await page.getByRole("button", { name: "Finanz-Twin", exact: true }).click();
  await page.getByRole("button", { name: "Bearbeiten" }).first().click();
  await page.getByLabel("Aktueller Wert").fill("7500");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("FinTwin v18", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Planung", exact: true }).click();
  await expect(page.getByText("1.454,35 €")).toBeVisible();
  await page.getByRole("button", { name: /Ruhestand/ }).click();
  await expect(page.getByText(/% des Zielkapitals/)).toBeVisible();
});

test("vollständiger englischer Modus bleibt interaktiv", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByText("Good morning,")).toBeVisible();
  await page.getByRole("button", { name: "Financial review", exact: true }).click();
  await expect(page.getByText("Clarity, not a single score.")).toBeVisible();
  await page.getByRole("button", { name: /Home ownership/ }).click();
  await expect(page.getByRole("heading", { name: "Edit details" })).toBeVisible();
});

test("KI-Assistent zeigt Modellstatus, Quellen und Spracheingabe", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "KI-Assistent", exact: true }).click();
  await expect(page.getByText(/Demo-Modus|Live-KI über Groq verbunden/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sprachfrage starten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mikrofon auswählen" })).toBeVisible();
  await page.getByRole("button", { name: "Was bedeutet ein Zins von 6 %?" }).click();
  await page.getByRole("button", { name: "Frage senden" }).click();
  await expect(page.getByText(/1.719,43 €/)).toBeVisible();
  await expect(page.getByText("2 Quellen anzeigen")).toBeVisible();
});
