"use client";
import { useState } from "react";
import type { FactKey, Lang } from "@fintwin/contracts";
import { FACT_BY_KEY } from "@fintwin/engine";
import { copy } from "../lib/i18n";

export function FactEditor({ factKey, lang, initial, onSave, onCancel, onRemove }: { factKey: FactKey; lang: Lang; initial?: number | string; onSave(value: number | string): Promise<void>; onCancel(): void; onRemove?(): Promise<void> }) {
  const def = FACT_BY_KEY[factKey];
  const t = copy(lang);
  const [value, setValue] = useState<string>(initial === undefined ? "" : def.type === "months" ? String(Number(initial) / 12) : String(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      let next: number | string = value.trim();
      if (def.type === "months") next = Math.round(Number(value.replace(",", ".")) * 12);
      else if (def.type !== "text" && def.type !== "choice" && def.type !== "year_month") next = Number(value.replace(/\s/g, "").replace(",", "."));
      if (typeof next === "number" && !Number.isFinite(next)) throw new Error("number");
      await onSave(next);
    } catch { setError(lang === "de" ? "Das konnte ich nicht speichern. Bitte prüfen Sie den Wert." : "Could not save that. Please check the value."); setSaving(false); }
  }

  const prefix = def.type === "money" ? "€" : def.type === "percent" ? "%" : def.type === "months" ? (lang === "de" ? "Jahre" : "years") : def.type === "age" ? (lang === "de" ? "Jahre" : "years") : null;
  return <form className="fact-editor field" onSubmit={submit}>
    <label htmlFor={`fact-${factKey}`}>{def.question[lang]}</label>
    <div className="input">
      {def.type === "choice" ? <select id={`fact-${factKey}`} value={value} onChange={event => setValue(event.target.value)} autoFocus><option value="">—</option>{def.choices?.map(choice => <option value={choice} key={choice}>{def.choiceLabels?.[choice]?.[lang] ?? choice}</option>)}</select>
        : def.type === "year_month" ? <input id={`fact-${factKey}`} type="month" value={value} onChange={event => setValue(event.target.value)} autoFocus />
        : def.type === "text" ? <input id={`fact-${factKey}`} type="text" value={value} onChange={event => setValue(event.target.value)} maxLength={240} autoFocus />
        : <><input id={`fact-${factKey}`} type="text" inputMode="decimal" value={value} onChange={event => setValue(event.target.value)} placeholder={def.type === "money" ? "0" : ""} autoFocus />{prefix && <b>{prefix}</b>}</>}
    </div>
    {error && <span className="error-line">{error}</span>}
    <div className="field-actions">
      {onRemove && initial !== undefined && <button type="button" className="btn sm ghost" onClick={() => void onRemove()}>{t.remove}</button>}
      <button type="button" className="btn sm" onClick={onCancel}>{t.cancel}</button>
      <button type="submit" className="btn sm primary" disabled={saving || value === ""}>{t.save}</button>
    </div>
  </form>;
}
