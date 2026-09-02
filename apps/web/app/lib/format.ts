import type { Fact, FactKey, Lang } from "@fintwin/contracts";
import { FACT_BY_KEY } from "@fintwin/engine";

const locale = (lang: Lang) => lang === "de" ? "de-DE" : "en-GB";

export function money(value: number, lang: Lang, decimals = 0): string {
  return new Intl.NumberFormat(locale(lang), { style: "currency", currency: "EUR", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}
export function compactMoney(value: number, lang: Lang): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2 }).format(value / 1_000_000)} ${lang === "de" ? "Mio. €" : "M €"}`;
  if (abs >= 100_000) return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(value / 1000)} k€`;
  return money(value, lang);
}
export function pct(value: number, lang: Lang, decimals = 1): string {
  const number = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: decimals }).format(value);
  return lang === "de" ? `${number} %` : `${number}%`;
}
export function num(value: number, lang: Lang, decimals = 1): string {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: decimals }).format(value);
}
export function months(value: number, lang: Lang): string {
  return `${num(value, lang)} ${lang === "de" ? (value === 1 ? "Monat" : "Monate") : value === 1 ? "month" : "months"}`;
}
export function yearMonth(value: string, lang: Lang): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale(lang), { month: "short", year: "numeric", timeZone: "UTC" });
}
export function relativeTime(iso: string, lang: Lang): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return lang === "de" ? "gerade eben" : "just now";
  if (minutes < 60) return lang === "de" ? `vor ${minutes} Min.` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return lang === "de" ? `vor ${hours} Std.` : `${hours} h ago`;
  return new Date(iso).toLocaleDateString(locale(lang), { day: "numeric", month: "short" });
}
export function timeOfDay(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleTimeString(locale(lang), { hour: "2-digit", minute: "2-digit" });
}

export function factDisplay(key: FactKey, value: number | string | undefined, lang: Lang): string {
  if (value === undefined || value === null) return "—";
  const def = FACT_BY_KEY[key];
  if (typeof value === "string") return def.type === "year_month" ? yearMonth(value, lang) : def.choiceLabels?.[value]?.[lang] ?? value;
  switch (def.type) {
    case "money": return money(value, lang);
    case "percent": return pct(value, lang, 2);
    case "months": return months(value, lang);
    case "age": return `${value} ${lang === "de" ? "Jahre" : "years"}`;
    case "year": return String(value);
    default: return num(value, lang, 0);
  }
}

export function sourceLabel(source: Fact["source"] | undefined, lang: Lang): string {
  switch (source) {
    case "user": return lang === "de" ? "Von Ihnen" : "You told me";
    case "edit": return lang === "de" ? "Bearbeitet" : "Edited";
    case "sample": return lang === "de" ? "Beispiel" : "Sample";
    case "derived": return lang === "de" ? "Berechnet" : "Derived";
    default: return lang === "de" ? "Offen" : "Open";
  }
}

export function metricValue(value: number | null, unit: string, lang: Lang): string {
  if (value === null) return "—";
  switch (unit) {
    case "eur": return compactMoney(value, lang);
    case "eur_month": return `${money(value, lang)}`;
    case "months": return months(value, lang);
    case "percent": return pct(value, lang);
    default: return num(value, lang);
  }
}

export function initials(name: string | undefined): string {
  return (name || "?").split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase();
}
