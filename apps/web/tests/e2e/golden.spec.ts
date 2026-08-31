import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("deutscher Kernpfad bleibt vollständig bedienbar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Guten Morgen,")).toBeVisible();
  await expect(page.getByText("487.320 €")).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(v => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]);
  await page.getByRole("button", { name: "Finanzcheck", exact: true }).click();
  await expect(page.getByText("Klarheit statt Gesamtnote.")).toBeVisible();
  await expect(page.getByText("Zinsbindung endet am 31.10.2027")).toBeVisible();
  await page.getByRole("button", { name: "Finanz-Twin", exact: true }).click();
  await page.getByRole("button", { name: "Korrigieren" }).click();
  await expect(page.getByText("Finanz-Twin v18", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Planung", exact: true }).click();
  await expect(page.getByText("1.454,35 €")).toBeVisible();
  await page.getByRole("button", { name: /Ruhestand/ }).click();
  await expect(page.getByText("92 % des Zielkapitals")).toBeVisible();
});

test("KI-Assistent zeigt Modellstatus, Quellen und Spracheingabe", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "KI-Assistent", exact: true }).click();
  await expect(page.getByText(/Demo-Modus|Live-KI über Groq verbunden/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sprachfrage starten" })).toBeVisible();
  await page.getByRole("button", { name: "Was bedeutet ein Zins von 6 %?" }).click();
  await page.getByRole("button", { name: "Frage senden" }).click();
  await expect(page.getByText(/1.719,43 €/)).toBeVisible();
  await expect(page.getByText("2 Quellen anzeigen")).toBeVisible();
});
