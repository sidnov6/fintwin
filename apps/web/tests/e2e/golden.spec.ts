import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function completeOnboarding(page: import("@playwright/test").Page, language: "de" | "en" = "de") {
  await page.goto("/");
  if (language === "en") await page.getByRole("button", { name: "Switch to English" }).click();
  await page.getByLabel(language === "de" ? "Ihr Name" : "Your name").fill("Siddharth");
  await page.getByRole("button", { name: language === "de" ? "Weiter" : "Continue" }).click();
  await page.getByLabel(language === "de" ? "Aktuelles Nettovermögen" : "Current net worth").fill("487320");
  await page.getByRole("button", { name: language === "de" ? "Weiter" : "Continue" }).click();
  await page.getByLabel(language === "de" ? "Ihre Erwartungen" : "Your expectations").fill(language === "de" ? "Ich möchte wissen, wann ich finanziell unabhängig sein kann." : "I want to know when I can become financially independent.");
  await page.getByRole("button", { name: language === "de" ? "Weiter" : "Continue" }).click();
  await page.getByRole("button", { name: language === "de" ? "Demo-Bank verbinden" : "Connect demo bank" }).click();
}

test("deutscher Kernpfad bleibt vollständig bedienbar", async ({ page }) => {
  await completeOnboarding(page);
  await expect(page.getByText("Guten Morgen,")).toBeVisible();
  await expect(page.getByText("487.320 €")).toBeVisible();
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
  await completeOnboarding(page, "en");
  await expect(page.getByText("Good morning,")).toBeVisible();
  await page.getByRole("button", { name: "Financial review", exact: true }).click();
  await expect(page.getByText("Clarity, not a single score.")).toBeVisible();
  await page.getByRole("button", { name: /Home ownership/ }).click();
  await expect(page.getByRole("heading", { name: "Edit details" })).toBeVisible();
});

test("KI-Assistent zeigt Modellstatus, Quellen und Spracheingabe", async ({ page }) => {
  await completeOnboarding(page);
  await page.getByRole("button", { name: "KI-Assistent", exact: true }).click();
  await expect(page.getByText(/Demo-Modus|Live-KI über Groq verbunden/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sprachfrage starten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mikrofon auswählen" })).toBeVisible();
  await page.getByRole("button", { name: "Was bedeutet ein Zins von 6 %?" }).click();
  await page.getByRole("button", { name: "Frage senden" }).click();
  await expect(page.getByText(/1.719,43 €/)).toBeVisible();
  await expect(page.getByText("2 Quellen anzeigen").last()).toBeVisible();
});

test("Konto-Onboarding bleibt gespeichert und die Million-Antwort klingt menschlich", async ({ page }) => {
  await completeOnboarding(page);
  await page.reload();
  await expect(page.getByText("Guten Morgen,")).toBeVisible();
  await expect(page.getByText("Siddharth.")).toBeVisible();
  await page.getByTitle("Mein Konto").click();
  await expect(page.getByText("Demo-Bank verbunden")).toBeVisible();
  await page.getByRole("button", { name: "Schließen" }).click();
  await page.getByRole("button", { name: "KI-Assistent", exact: true }).click();
  await page.getByRole("button", { name: "Wann erreiche ich 1 Million Euro?" }).click();
  await page.getByRole("button", { name: "Frage senden" }).click();
  await expect(page.getByText(/2041/)).toBeVisible();
  await expect(page.getByText(/71 Jahre/)).toBeVisible();
  await expect(page.getByText("Model calculations")).toHaveCount(0);
});
