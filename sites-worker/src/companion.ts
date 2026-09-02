/**
 * Offline companion: a deterministic conversation engine that runs when no
 * model key is configured (and as the safety net when the model fails).
 * It guides a first conversation, understands stated facts, answers the
 * core money questions with computed numbers and uses the same tools as the
 * live model. Wording is intentionally plain and human.
 */
import { FACT_BY_KEY, factNumber, factText, parseAmount } from "@fintwin/engine";
import type { FactKey, Lang, Picture } from "@fintwin/engine";
import type { AppState, Message } from "@fintwin/contracts";
import { runToolAndRefresh, type ToolContext } from "./tools";

export interface CompanionResult { text: string; suggestions: string[]; meta: NonNullable<Message["meta"]>; mode: "offline" | "policy" }

const ONBOARDING: FactKey[] = ["goal_primary", "age", "income_net_monthly", "expenses_monthly", "cash_liquid", "investments_value", "property_value", "mortgage_balance", "other_debt", "retirement_age"];

const money = (value: number, lang: Lang, decimals = 0) => new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value);
const pct = (value: number, lang: Lang) => lang === "de" ? `${value.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %` : `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
const num = (value: number, lang: Lang) => value.toLocaleString(lang === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 1 });

const t = (lang: Lang, de: string, en: string) => lang === "de" ? de : en;
const has = (text: string, ...patterns: RegExp[]) => patterns.some(pattern => pattern.test(text));

const RX = {
  sample: /\b(sample|beispiel\w*|demo\w*|muster\w*|test ?daten|example)\b/i,
  skip: /^(skip|später|spaeter|weiter|überspringen|ueberspringen|next|later|pass|weiß (ich )?nicht|weiss (ich )?nicht|keine ahnung|not sure|dont know|don't know|no idea|i don't know)\b/i,
  none: /^(keine|nein|nichts|none|no|nope|nothing|zero|null|0)\b/i,
  greeting: /^(hi|hey|hallo|hello|moin|servus|guten (morgen|tag|abend)|good (morning|afternoon|evening))\b/i,
  thanks: /\b(danke|thanks|thank you|merci|super|great|perfekt|perfect|cool|ok(ay)?)\b/i,
  help: /\b(help|hilfe|was kannst du|what can you|how does this work|wie funktioniert)\b/i,
  aboutMe: /\b(was weißt du|was weisst du|what do you know|welche daten|which facts|my facts|meine (daten|angaben))\b/i,
  networth: /\b(nettoverm|net ?worth|vermögen|vermoegen|wealth|how much (am i|do i have)|wie reich)\b/i,
  cashflow: /\b(cash ?flow|übrig|uebrig|bleibt|wohin|where (does|is) my money|spending|ausgaben|einnahmen|budget|sparquote|savings rate)\b/i,
  runway: /\b(reserve|runway|notfall|emergency|puffer|buffer|notgroschen)\b/i,
  mortgage: /\b(hypothek|zins|anschluss|refix|mortgage|rate bei|interest|darlehen|kredit)\b/i,
  retirement: /\b(rente|ruhestand|retir\w*|pension|altersvorsorge)\b/i,
  million: /\b(million|millionen|mio|1\.000\.000|1,000,000|1000000)\b/i,
  goalWhen: /\b(wann (erreiche|habe|bin)|when (will|do|can) i|how long until|wie lange bis|reach)\b/i,
  portfolio: /\b(depot|portfolio|konzentr|concentrat|diversif|etf|aktien|stocks|holdings|risk|risiko)\b/i,
  next: /\b(what (should|do) i (do|focus)|was (soll|sollte) ich|next step|nächste schritte|naechste|what matters|was ist wichtig|priorit|worauf)\b/i,
  adviser: /\b(berater|adviser|advisor|beratung|gespräch vorbereiten|prepare|mitbringen|what to bring)\b/i,
  policy: /\b(best(es|e)? (produkt|etf|fonds|aktie|investment|fund|stock)|welche(n|s)? (etf|aktie|fonds) (soll|kaufen)|which (etf|stock|fund) should|buy for me|kauf(e|en)? für mich|trade|execute|guaranteed|garantiert|steuerlich verbindlich|tax advice|rechtsberatung)\b/i,
  name: /(?:ich heiße|ich heisse|ich bin|mein name ist|my name is|i am|i'm|im|call me|nenn mich)\s+([^\d.,!?]{1,40})/i,
};

const FACT_HINTS: Array<[FactKey, RegExp]> = [
  ["income_net_monthly", /\b(verdiene|einkommen|gehalt|netto|income|earn|salary|take.?home)\b/i],
  ["expenses_monthly", /\b(ausgaben|gebe .* aus|spend|expenses|kosten|costs)\b/i],
  ["monthly_saving", /\b(spare|sparrate|lege .* zurück|invest(iere|ing)? (monatlich|each month|per month|a month)|save (each|per|a) month)\b/i],
  ["cash_liquid", /\b(konto|tagesgeld|guthaben|cash|savings account|bank|erspart|liquid)\b/i],
  ["investments_value", /\b(depot|angelegt|etf|aktien|investments?|invested|portfolio)\b/i],
  ["retirement_assets", /\b(riester|rürup|betriebsrente|altersvorsorge|pension pot|retirement account)\b/i],
  ["property_value", /\b(immobilie|haus|wohnung|property|house|home|flat)\b/i],
  ["mortgage_balance", /\b(hypothek|restschuld|darlehen|mortgage|baufinanzierung)\b/i],
  ["other_debt", /\b(kredit|schulden|loan|debt|ratenkauf)\b/i],
  ["retirement_age", /\b(rente mit|in rente|retire at|retirement age|aufhören mit)\b/i],
  ["age", /\b(ich bin \d{2}|i am \d{2}|i'm \d{2}|jahre alt|years old)\b/i],
];

function extractYearMonth(text: string, now: Date): string | null {
  const months = ["jan", "feb", "mär|mar", "apr", "mai|may", "jun", "jul", "aug", "sep", "okt|oct", "nov", "dez|dec"];
  const iso = text.match(/(\d{4})-(\d{1,2})/); if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}`;
  const slash = text.match(/(\d{1,2})[./](\d{4})/); if (slash) return `${slash[2]}-${String(Number(slash[1])).padStart(2, "0")}`;
  for (let index = 0; index < months.length; index++) { const match = text.match(new RegExp(`(?:${months[index]})[a-zäö]*\\.?\\s+(\\d{4})`, "i")); if (match) return `${match[1]}-${String(index + 1).padStart(2, "0")}`; }
  const relative = text.match(/in\s+(\d{1,3})\s+(monat|month)/i); if (relative) { const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + Number(relative[1]), 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
  const year = text.match(/\b(20\d{2})\b/); if (year) return `${year[1]}-12`;
  return null;
}

export function parseFactAnswer(key: FactKey, text: string, lang: Lang, now: Date): number | string | null {
  const def = FACT_BY_KEY[key];
  if (def.type === "text") {
    const value = text.trim();
    // A bare acknowledgement is not a financial goal. Treating "yes" as the
    // goal used to silently advance onboarding and made the following turns
    // look as though the companion had forgotten the conversation.
    if (key === "goal_primary" && /^(ja|yes|yep|yeah|sure|klar|ok(?:ay)?|continue|weiter|give name|name)$/i.test(value)) return null;
    return value.slice(0, 240);
  }
  if (def.type === "choice") {
    const lower = text.toLowerCase();
    if (key === "income_protection") return /\b(ja|yes|habe ich|vorhanden|have|yep|in place)\b/.test(lower) ? "yes" : /\b(nein|no|nicht|none|nope)\b/.test(lower) ? "no" : "unknown";
    if (key === "household") return /\b(familie|family|kinder|children|kids)\b/.test(lower) ? "family" : /\b(partner|frau|mann|wife|husband|zusammen|together|couple)\b/.test(lower) ? "partner" : "single";
    return null;
  }
  if (def.type === "year_month") return extractYearMonth(text, now);
  if (RX.none.test(text.trim())) return 0;
  const amount = parseAmount(text, lang);
  if (amount === null) return null;
  if (def.type === "months" && /\b(jahr|year)/i.test(text)) return amount * 12;
  if (def.type === "months" && key === "mortgage_remaining_months" && amount <= 60) return amount * 12; // "20" means years
  if (def.min !== undefined && amount < def.min) return null;
  if (def.max !== undefined && amount > def.max) return null;
  return amount;
}

function metricValue(picture: Picture, key: Picture["metrics"][number]["key"]): number | null { return picture.metrics.find(metric => metric.key === key)?.value ?? null; }

function firstRead(state: AppState, lang: Lang): string {
  const picture = state.picture, name = state.profile?.name;
  const netWorth = metricValue(picture, "net_worth"), free = metricValue(picture, "free_cashflow"), runway = metricValue(picture, "runway");
  const parts: string[] = [];
  if (netWorth !== null) parts.push(t(lang, `${name ? name + ", " : ""}Ihr Nettovermögen liegt bei rund ${money(netWorth, lang)}.`, `${name ? name + ", " : ""}your net worth comes to about ${money(netWorth, lang)}.`));
  if (free !== null) parts.push(free >= 0 ? t(lang, `Im Monat bleiben Ihnen ${money(free, lang)} frei.`, `Each month you have ${money(free, lang)} left over.`) : t(lang, `Im Monat fehlen Ihnen ${money(-free, lang)} – das sehen wir uns als Erstes an.`, `Each month you are short ${money(-free, lang)}, which is the first thing to look at.`));
  const attention = picture.insights.find(insight => insight.severity === "attention");
  const lead = attention ?? picture.insights[0];
  if (runway !== null && !lead?.id.startsWith("runway")) parts.push(t(lang, `Ihre Reserve reicht ${num(runway, lang)} Monate.`, `Your reserve covers ${num(runway, lang)} months.`));
  if (lead) parts.push(t(lang, `Was mir auffällt: ${lead.title.de.charAt(0).toLowerCase() + lead.title.de.slice(1)}. ${lead.body.de}`, `What stands out: ${lead.title.en.charAt(0).toLowerCase() + lead.title.en.slice(1)}. ${lead.body.en}`));
  if (!parts.length) return t(lang, "Ich habe noch keine Zahlen von Ihnen. Erzählen Sie mir einfach, was reinkommt und was rausgeht – oder laden Sie Beispieldaten.", "I do not have any numbers from you yet. Just tell me what comes in and what goes out, or load sample data.");
  parts.push(t(lang, "Womit möchten Sie anfangen?", "Where would you like to start?"));
  return parts.join(" ");
}

function insightSuggestions(picture: Picture, lang: Lang, count = 3): string[] { return picture.insights.slice(0, count).map(insight => insight.ask[lang]); }

function skipWords(lang: Lang) { return t(lang, "Überspringen", "Skip"); }

function questionSuggestions(key: FactKey, lang: Lang): string[] {
  switch (key) {
    case "goal_primary": return lang === "de" ? ["Früher in Rente", "Vermögen aufbauen", "Immobilie abbezahlen", "Einfach Überblick"] : ["Retire earlier", "Build wealth", "Pay off the house", "Just an overview"];
    case "property_value": return [t(lang, "Keine Immobilie", "No property"), skipWords(lang)];
    case "other_debt": return [t(lang, "Keine Schulden", "No debt"), skipWords(lang)];
    case "investments_value": return [t(lang, "Noch nichts angelegt", "Nothing invested yet"), skipWords(lang)];
    case "retirement_age": return ["63", "67", skipWords(lang)];
    case "income_protection": return [t(lang, "Ja, vorhanden", "Yes, in place"), t(lang, "Nein", "No"), t(lang, "Weiß ich nicht", "Not sure")];
    case "age": return [skipWords(lang)];
    default: return [skipWords(lang)];
  }
}

function askQuestion(key: FactKey, lang: Lang, lead = ""): string { return `${lead ? lead + " " : ""}${FACT_BY_KEY[key].question[lang]}`; }

function reflectOnAnswer(key: FactKey, state: AppState, lang: Lang): string {
  const facts = state.facts, picture = state.picture;
  const n = (k: FactKey) => factNumber(facts, k);
  switch (key) {
    case "goal_primary": return t(lang, "Verstanden – das behalte ich als Ihren Kompass.", "Got it, I will keep that as your compass.");
    case "income_net_monthly": return "";
    case "expenses_monthly": { const free = metricValue(picture, "free_cashflow"); if (free === null) return ""; return free >= 0 ? t(lang, `Dann bleiben Ihnen rund ${money(free, lang)} im Monat – ${pct(metricValue(picture, "savings_rate") ?? 0, lang)} vom Einkommen.`, `That leaves you about ${money(free, lang)} a month, ${pct(metricValue(picture, "savings_rate") ?? 0, lang)} of your income.`) : t(lang, `Das ist mehr, als reinkommt: ${money(-free, lang)} im Monat zu viel. Wir schauen uns das gleich genauer an.`, `That is more than comes in: ${money(-free, lang)} a month over. We will look at that properly in a moment.`); }
    case "cash_liquid": { const runway = metricValue(picture, "runway"); if (runway === null) return ""; return runway >= 6 ? t(lang, `Das reicht für ${num(runway, lang)} Monate – eine solide Reserve.`, `That covers ${num(runway, lang)} months, a solid reserve.`) : t(lang, `Das reicht für etwa ${num(runway, lang)} Monate. Sechs wären ein guter Richtwert – wir kommen darauf zurück.`, `That covers about ${num(runway, lang)} months. Six is a good benchmark, we will come back to it.`); }
    case "investments_value": return (n("investments_value") ?? 0) > 0 ? t(lang, "Notiert.", "Noted.") : t(lang, "Alles klar, dann fangen wir dort bei null an.", "All right, then we start from zero there.");
    case "property_value": return (n("property_value") ?? 0) > 0 ? t(lang, "Schön.", "Nice.") : t(lang, "Okay, keine Immobilie.", "Okay, no property.");
    case "mortgage_balance": return "";
    case "other_debt": return (n("other_debt") ?? 0) > 0 ? t(lang, "Notiert.", "Noted.") : t(lang, "Gut, keine weiteren Schulden.", "Good, no other debt.");
    case "retirement_age": { const age = n("age"), target = n("retirement_age"); return age !== null && target !== null ? t(lang, `Also noch ${target - age} Jahre.`, `So ${target - age} more years.`) : ""; }
    case "age": return "";
    default: return t(lang, "Gespeichert.", "Saved.");
  }
}

/** Decides what the companion says next. Runs tools through ctx as needed. */
export async function companionTurn(text: string, ctx: ToolContext, history: Message[]): Promise<CompanionResult> {
  const lang = ctx.lang, now = ctx.now;
  const lastAssistant = [...history].reverse().find(message => message.role === "assistant");
  const skipped = new Set<FactKey>(lastAssistant?.meta?.skipped ?? []);
  // Old/live-model messages may be missing bookkeeping. Recover the question
  // from the visible wording so a bare answer such as "5000" still lands in
  // the right field after a deploy or model-formatting miss.
  const pending = lastAssistant?.meta?.pendingFact ?? inferAskedFact(lastAssistant?.text ?? "", ctx.state);
  const trimmed = text.trim();
  const finish = (reply: string, suggestions: string[], meta: CompanionResult["meta"] = {}, mode: CompanionResult["mode"] = "offline"): CompanionResult => ({ text: reply.replace(/\s+/g, " ").trim(), suggestions: suggestions.filter(Boolean).slice(0, 4), meta: { ...meta, skipped: [...skipped] }, mode });

  // 0. Policy: no product picks, trades, guarantees, tax or legal conclusions.
  if (RX.policy.test(trimmed)) {
    ctx.emitCard({ type: "policy", reason: t(lang, "Keine Produktempfehlung, kein Handel, keine Steuer- oder Rechtsauskunft.", "No product picks, no trades, no tax or legal conclusions.") });
    return finish(t(lang, "Ein konkretes Produkt kann ich Ihnen nicht auswählen – und ich handle auch nichts für Sie. Was ich kann: Ihnen zeigen, worauf es bei der Entscheidung ankommt, etwa Kosten, Streuung, Zeithorizont und wie viel Sie wirklich entbehren können. Wenn Sie möchten, bereiten wir daraus Fragen für eine qualifizierte Beratung vor.", "I cannot pick a specific product for you, and I do not trade anything on your behalf. What I can do is show what the decision hinges on: costs, diversification, time horizon, and how much you can really set aside. If you like, we can turn that into questions for a qualified adviser."), [t(lang, "Worauf kommt es bei ETFs an?", "What matters when choosing ETFs?"), t(lang, "Wie viel kann ich monatlich anlegen?", "How much could I invest monthly?")], {}, "policy");
  }

  // 1. New person: keep a useful goal mentioned before their name, then ask
  // for the name once. A name is optional after sample data has been loaded.
  if (!ctx.state.profile?.name && !ctx.state.profile?.onboardingDone) {
    if (RX.sample.test(trimmed)) return loadSample(ctx, lang, finish);
    const retirementTarget = extractRetirementTarget(trimmed);
    if (retirementTarget !== null) {
      const initialFacts: Array<{ key: FactKey; value: number | string }> = [];
      if (!ctx.state.facts.goal_primary) initialFacts.push({ key: "goal_primary", value: t(lang, `Mit ${retirementTarget} in Rente gehen`, `Retire at ${retirementTarget}`) });
      if (!ctx.state.facts.retirement_age) initialFacts.push({ key: "retirement_age", value: retirementTarget });
      if (initialFacts.length) await runToolAndRefresh("set_facts", { facts: initialFacts }, ctx);
    }
    const name = extractName(trimmed);
    if (!name) {
      const alreadyIntroduced = history.some(message => message.role === "assistant");
      const reply = retirementTarget !== null
        ? t(lang, `Mit ${retirementTarget} in Rente zu gehen ist ein klares Ziel – das habe ich festgehalten. Wie darf ich Sie nennen?`, `Retiring at ${retirementTarget} is a clear goal, and I have saved it. What should I call you?`)
        : alreadyIntroduced
          ? t(lang, "Wie darf ich Sie nennen?", "What name should I use?")
          : t(lang, "Hallo! Ich bin FinTwin, Ihr Begleiter für die eigenen Finanzen. Wie darf ich Sie nennen?", "Hi! I am FinTwin, your companion for your own money. What should I call you?");
      return finish(reply, [t(lang, "Beispieldaten laden", "Load sample data")], { onboarding: true });
    }
    await runToolAndRefresh("set_name", { name }, ctx);
    return nextQuestion(ctx, lang, skipped, finish, t(lang, `Freut mich, ${name}. Jede Antwort lässt sich später ändern.`, `Nice to meet you, ${name}. You can change any answer later.`));
  }

  // Sample profiles deliberately have no forced placeholder name. If the
  // person later supplies one, remember it without restarting onboarding.
  if (!ctx.state.profile?.name) {
    const name = !/[\d?]/.test(trimmed) ? extractName(trimmed) : null;
    if (name) {
      await runToolAndRefresh("set_name", { name }, ctx);
      return finish(t(lang, `Alles klar, ${name}. Womit möchten Sie weitermachen?`, `Got it, ${name}. What would you like to look at next?`), insightSuggestions(ctx.state.picture, lang));
    }
  }

  const name = ctx.state.profile?.name ?? "";
  const onboarding = !ctx.state.profile.onboardingDone;

  // 2. Sample data at any time.
  if (RX.sample.test(trimmed) && !RX.aboutMe.test(trimmed)) return loadSample(ctx, lang, finish);

  // 3. Pending onboarding question: skip or answer.
  if (pending) {
    if (RX.skip.test(trimmed)) { skipped.add(pending); return nextQuestion(ctx, lang, skipped, finish, t(lang, "Kein Problem.", "No problem.")); }
    if (/^(ja|yes|yep|yeah|correct|stimmt|genau|richtig)[.! ]*$/i.test(trimmed) && ctx.state.facts[pending]) {
      return nextQuestion(ctx, lang, skipped, finish, t(lang, "Alles klar.", "Got it."));
    }
    const value = parseFactAnswer(pending, trimmed, lang, now);
    const isQuestion = /\?$/.test(trimmed) || has(trimmed, RX.networth, RX.cashflow, RX.mortgage, RX.retirement, RX.help, RX.next, RX.million);
    if (value !== null && !(isQuestion && FACT_BY_KEY[pending].type !== "text")) {
      await runToolAndRefresh("set_facts", { facts: [{ key: pending, value }] }, ctx);
      const reflection = reflectOnAnswer(pending, ctx.state, lang);
      if (pending === "goal_primary" && /\b(million|mio)\b/i.test(trimmed)) { const amount = parseAmount(trimmed, lang); if (amount && amount >= 100000) await runToolAndRefresh("set_facts", { facts: [{ key: "goal_target_amount", value: amount }] }, ctx); }
      return nextQuestion(ctx, lang, skipped, finish, reflection);
    }
    if (!isQuestion && FACT_BY_KEY[pending].type !== "text") {
      const example = FACT_BY_KEY[pending].type === "age" ? "44" : FACT_BY_KEY[pending].type === "year_month" ? t(lang, "10/2027", "10/2027") : t(lang, "z. B. 3.200 oder 3,2k", "e.g. 3,200 or 3.2k");
      return finish(t(lang, `Das habe ich nicht als Zahl verstanden. Eine grobe Schätzung reicht völlig – ${example} – oder Sie überspringen die Frage.`, `I could not read that as a number. A rough estimate is fine, ${example}, or just skip the question.`), questionSuggestions(pending, lang), { pendingFact: pending, onboarding });
    }
    // Fall through: the person asked something instead of answering. Answer, then resume.
  }

  // 4. Stated facts in free text ("I earn 4k", "mein Depot ist 20.000 wert").
  const stated = detectStatedFacts(trimmed, lang, now);
  if (stated.length) {
    await runToolAndRefresh("set_facts", { facts: stated }, ctx);
    const labels = stated.map(fact => FACT_BY_KEY[fact.key].label[lang].toLowerCase()).join(", ");
    const reflection = stated.map(fact => reflectOnAnswer(fact.key, ctx.state, lang)).filter(Boolean).join(" ");
    const lead = t(lang, `Aktualisiert: ${labels}. ${reflection}`, `Updated ${labels}. ${reflection}`);
    if (onboarding) return nextQuestion(ctx, lang, skipped, finish, lead);
    return finish(`${lead} ${t(lang, "Soll ich Ihnen zeigen, was sich dadurch im Bild verändert?", "Want me to show what that changes in your picture?")}`, [t(lang, "Ja, zeig mir mein Bild", "Yes, show my picture"), ...insightSuggestions(ctx.state.picture, lang, 2)]);
  }

  // 5. Questions and intents.
  const resume = async (reply: string, suggestions: string[]): Promise<CompanionResult> => {
    if (!onboarding) return finish(reply, suggestions);
    const next = ONBOARDING.find(key => !ctx.state.facts[key] && !skipped.has(key) && questionApplies(key, ctx.state));
    if (!next) { await runToolAndRefresh("finish_onboarding", {}, ctx); return finish(reply, suggestions); }
    return finish(`${reply} ${t(lang, `Wenn Sie mögen, machen wir kurz weiter: ${FACT_BY_KEY[next].question[lang]}`, `If you like, let us carry on briefly: ${FACT_BY_KEY[next].question[lang]}`)}`, questionSuggestions(next, lang), { pendingFact: next, onboarding: true });
  };
  const picture = ctx.state.picture, facts = ctx.state.facts;
  const n = (key: FactKey) => factNumber(facts, key);

  if (RX.help.test(trimmed)) return resume(t(lang, `Ich bin ${name ? "für Sie, " + name + ", " : ""}eine Art Finanz-Gedächtnis mit Rechenkopf: Sie erzählen mir Ihre Zahlen, ich halte sie fest, rechne Nettovermögen, Cashflow, Reserve, Hypotheken- und Rentenszenarien durch und sage Ihnen ehrlich, was mir auffällt und was ich nicht weiß. Was ich nicht tue: Produkte empfehlen oder für Sie handeln.`, `Think of me as a financial memory with a calculator: you tell me your numbers, I keep them, work out net worth, cashflow, reserve, mortgage and retirement scenarios, and tell you honestly what stands out and what I do not know. What I do not do: recommend products or trade for you.`), [t(lang, "Wie steht mein Nettovermögen?", "What is my net worth?"), t(lang, "Was ist gerade wichtig?", "What matters right now?"), t(lang, "Beispieldaten laden", "Load sample data")]);

  if (RX.aboutMe.test(trimmed)) {
    const known = Object.values(facts).filter(Boolean).map(fact => `${FACT_BY_KEY[fact!.key].label[lang]}: ${formatFact(fact!.key, fact!.value, lang)}`);
    ctx.emitCard({ type: "picture", metrics: picture.metrics.slice(0, 4) });
    return resume(known.length ? t(lang, `Das habe ich von Ihnen: ${known.join(", ")}. ${picture.openQuestions.length ? `Noch offen: ${picture.openQuestions.slice(0, 3).map(question => question.label.de.toLowerCase()).join(", ")}.` : ""} Jede Angabe können Sie rechts direkt ändern.`, `Here is what I have from you: ${known.join(", ")}. ${picture.openQuestions.length ? `Still open: ${picture.openQuestions.slice(0, 3).map(question => question.label.en.toLowerCase()).join(", ")}.` : ""} You can change any of it directly on the right.`) : t(lang, "Noch nichts – wir fangen gerade erst an.", "Nothing yet, we are only getting started."), insightSuggestions(picture, lang));
  }

  const asksAboutRate = RX.mortgage.test(trimmed) || (/\d\s*%/.test(trimmed) && n("mortgage_balance") !== null);
  if (asksAboutRate && !RX.retirement.test(trimmed)) {
    if (!n("mortgage_balance")) return finish(t(lang, "Dafür brauche ich Ihre Restschuld. Wie hoch ist sie ungefähr?", "For that I need your remaining mortgage balance. Roughly how much is it?"), [t(lang, "Keine Hypothek", "No mortgage"), skipWords(lang)], { pendingFact: "mortgage_balance", onboarding });
    const rate = trimmed.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const result = await runToolAndRefresh("run_mortgage", { rate_pct: rate ? Number(rate[1].replace(",", ".")) : undefined }, ctx) as { scenarios?: Array<{ rate_pct: number; monthly_payment: number }>; current_payment: number | null; months: number };
    const scenarios = result.scenarios ?? [];
    const four = scenarios.find(item => item.rate_pct === 4), six = scenarios.find(item => item.rate_pct === 6), given = rate ? scenarios.find(item => item.rate_pct === Number(rate[1].replace(",", "."))) ?? null : null;
    const current = result.current_payment;
    const refix = picture.mortgage?.monthsUntilRefix;
    let reply = t(lang, `Bei ${money(n("mortgage_balance")!, lang)} Restschuld über ${Math.round(result.months / 12)} Jahre`, `With ${money(n("mortgage_balance")!, lang)} outstanding over ${Math.round(result.months / 12)} years`);
    reply += given ? t(lang, ` läge die Rate bei ${pct(given.rate_pct, lang)} bei ${money(given.monthly_payment, lang, 2)} im Monat.`, ` the payment at ${pct(given.rate_pct, lang)} would be ${money(given.monthly_payment, lang, 2)} a month.`) : t(lang, ` liegt die Rate zwischen ${money(four!.monthly_payment, lang, 2)} bei 4 % und ${money(six!.monthly_payment, lang, 2)} bei 6 %.`, ` the payment ranges from ${money(four!.monthly_payment, lang, 2)} at 4% to ${money(six!.monthly_payment, lang, 2)} at 6%.`);
    if (current) { const compare = given ?? six!; const delta = compare.monthly_payment - current; reply += t(lang, ` Heute zahlen Sie ${money(current, lang)}, das wären also ${delta >= 0 ? "rund " + money(delta, lang) + " mehr" : "rund " + money(-delta, lang) + " weniger"}.`, ` You pay ${money(current, lang)} today, so that is ${delta >= 0 ? "about " + money(delta, lang) + " more" : "about " + money(-delta, lang) + " less"}.`); }
    if (refix !== null && refix !== undefined && refix <= 18) reply += t(lang, ` Ihre Zinsbindung endet in ${refix} Monaten – Zeit genug, um Angebote zu vergleichen, aber nicht zu viel.`, ` Your fixed rate ends in ${refix} months, enough time to compare offers but not too much.`);
    reply += t(lang, " Das ist eine Modellrechnung, kein Kreditangebot.", " This is a planning model, not a lender quote.");
    return resume(reply, [t(lang, "Was bringt eine Sondertilgung?", "What would extra repayments do?"), t(lang, "Wie viel Puffer brauche ich dafür?", "How much buffer do I need for that?")]);
  }

  if (RX.retirement.test(trimmed)) {
    if (n("age") === null) return finish(t(lang, "Dafür brauche ich zuerst Ihr Alter.", "For that I first need your age."), [], { pendingFact: "age", onboarding });
    if (n("retirement_age") === null) return finish(t(lang, "Mit welchem Alter möchten Sie aufhören zu arbeiten?", "At what age would you like to stop working?"), ["63", "67"], { pendingFact: "retirement_age", onboarding });
    const ageMatch = trimmed.match(/\b(mit|at)\s+(\d{2})\b/i);
    const result = await runToolAndRefresh("run_retirement", { retirement_age: ageMatch ? Number(ageMatch[2]) : undefined }, ctx) as { retirement_age: number; years: number; projected_real_today_eur: number; required_capital_eur: number | null; readiness_ratio: number | null; sustainable_monthly_real_eur: number; warnings: string[] };
    let reply = t(lang, `Wenn Sie mit ${result.retirement_age} aufhören, kommen Sie im Modell auf rund ${money(result.projected_real_today_eur, lang)} in heutiger Kaufkraft – das entspricht etwa ${money(result.sustainable_monthly_real_eur, lang)} im Monat bei 4 % Entnahme.`, `If you stop at ${result.retirement_age}, the model gives you about ${money(result.projected_real_today_eur, lang)} in today's purchasing power, roughly ${money(result.sustainable_monthly_real_eur, lang)} a month at a 4% withdrawal.`);
    if (result.readiness_ratio !== null && result.required_capital_eur !== null) reply += t(lang, ` Für Ihr Wunschbudget bräuchten Sie ${money(result.required_capital_eur, lang)}, Deckungsgrad ${pct(result.readiness_ratio * 100, lang)}.`, ` For your spending target you would need ${money(result.required_capital_eur, lang)}, a readiness of ${pct(result.readiness_ratio * 100, lang)}.`);
    else return finish(`${reply} ${t(lang, "Ob das reicht, kann ich erst sagen, wenn ich Ihr Wunschbudget kenne: Wie viel möchten Sie im Ruhestand monatlich zur Verfügung haben?", "Whether that is enough depends on your spending target: how much would you like to live on each month in retirement?")}`, ["2.500", "3.500", skipWords(lang)], { pendingFact: "retirement_spending_monthly", onboarding });
    if (result.warnings.includes("pension_missing")) reply += t(lang, " Ihre gesetzliche Rente habe ich dabei noch nicht – die würde den Bedarf senken.", " I have not included your state pension yet, which would lower the need.");
    reply += t(lang, " Annahmen: 5 % Rendite, 0,5 % Kosten, 2 % Inflation. Keine Prognose, nur ein Rechenmodell.", " Assumptions: 5% return, 0.5% fees, 2% inflation. Not a forecast, just a model.");
    return resume(reply, [t(lang, "Was, wenn ich 200 € mehr spare?", "What if I save €200 more?"), t(lang, "Wie sieht es mit 67 aus?", "What about 67?"), t(lang, "Welche Annahme wiegt am meisten?", "Which assumption weighs most?")]);
  }

  if (RX.million.test(trimmed) || (RX.goalWhen.test(trimmed) && parseAmount(trimmed, lang))) {
    const target = RX.million.test(trimmed) && !parseAmount(trimmed.replace(/million(en)?|mio/gi, ""), lang) ? 1_000_000 : (parseAmount(trimmed, lang) ?? 1_000_000);
    const result = await runToolAndRefresh("run_goal", { target_amount: target }, ctx) as { start_from_cash_and_investments: number; monthly: number; months: number | null; reached: string | null; required_monthly_for_years: Array<{ years: number; monthly: number }> };
    if (result.monthly <= 0 && result.start_from_cash_and_investments < target) return resume(t(lang, `Mit ${money(result.start_from_cash_and_investments, lang)} heute und ohne monatliche Sparrate komme ich rechnerisch nicht auf ${money(target, lang)}. Wie viel könnten Sie im Monat anlegen?`, `Starting from ${money(result.start_from_cash_and_investments, lang)} with no monthly investing, the model never reaches ${money(target, lang)}. How much could you invest each month?`), ["300", "500", "1.000"]);
    const ten = result.required_monthly_for_years.find(item => item.years === 10);
    const reply = result.months === 0 ? t(lang, `Rechnerisch sind Sie mit ${money(result.start_from_cash_and_investments, lang)} in Guthaben und Depot schon dort.`, `On paper you are already there with ${money(result.start_from_cash_and_investments, lang)} in cash and investments.`)
      : result.reached ? t(lang, `Mit ${money(result.start_from_cash_and_investments, lang)} heute, ${money(result.monthly, lang)} im Monat und 4 % Rendite wären es rechnerisch ${money(target, lang)} etwa ${result.reached.slice(0, 4)} – in ${Math.round(result.months! / 12)} Jahren. Wollten Sie es in zehn Jahren schaffen, bräuchte es rund ${money(ten?.monthly ?? 0, lang)} im Monat. Die Immobilie zählt hier nicht mit, weil sie nicht flüssig ist.`, `Starting from ${money(result.start_from_cash_and_investments, lang)} today, ${money(result.monthly, lang)} a month and a 4% return, you would reach ${money(target, lang)} around ${result.reached.slice(0, 4)}, in ${Math.round(result.months! / 12)} years. To do it in ten years you would need about ${money(ten?.monthly ?? 0, lang)} a month. Property is left out because it is not liquid.`)
      : t(lang, "Das Ziel ist mit den heutigen Zahlen sehr weit weg.", "With today's numbers that goal is very far away.");
    return resume(reply, [t(lang, "Wie erreiche ich das früher?", "How could I get there sooner?"), t(lang, "Was ist realistisch für mich?", "What is realistic for me?")]);
  }

  if (RX.portfolio.test(trimmed)) {
    if (!ctx.state.portfolio) {
      const invested = n("investments_value");
      return resume(invested ? t(lang, `Ich weiß, dass Sie rund ${money(invested, lang)} angelegt haben, aber nicht worin – ein Depot ist nicht verbunden. Wenn Sie mir grob sagen, wie es aufgeteilt ist, kann ich etwas zur Streuung sagen. Zum Ausprobieren gibt es auch ein Beispieldepot.`, `I know you have about ${money(invested, lang)} invested, but not in what, since no brokerage is connected. If you tell me roughly how it is split I can say something about diversification. There is also a sample portfolio to explore.`) : t(lang, "Ein Depot ist nicht verbunden und ich habe noch keinen Anlagewert von Ihnen. Sagen Sie mir grob, wie viel angelegt ist, oder laden Sie das Beispieldepot.", "No brokerage is connected and I do not have an investments value from you yet. Tell me roughly how much is invested, or load the sample portfolio."), [t(lang, "Beispieldepot laden", "Load sample portfolio")]);
    }
    const result = await runToolAndRefresh("get_portfolio", {}, ctx) as { market_value_eur: number; gain_eur: number; top_three_weight_pct: number; sectors: Array<{ name: string; weight_pct: number }>; holdings: Array<{ symbol: string; weight_pct: number }> };
    const top = [...result.holdings].sort((a, b) => b.weight_pct - a.weight_pct).slice(0, 3);
    const sector = result.sectors[0];
    return resume(t(lang, `Ihr Depot ist ${money(result.market_value_eur, lang)} wert, ${result.gain_eur >= 0 ? money(result.gain_eur, lang) + " über dem Einstand" : money(-result.gain_eur, lang) + " unter dem Einstand"}. Die drei größten Positionen (${top.map(item => item.symbol).join(", ")}) machen ${pct(result.top_three_weight_pct, lang)} aus, und ${sector.name} allein ${pct(sector.weight_pct, lang)}. Das ist nicht automatisch falsch – aber ein Rückgang dort trifft mehrere Positionen gleichzeitig. Bevor man etwas ändert, lohnt der Blick, welche Regionen und Branchen im ETF schon stecken. Kurse sind verzögert, das Depot ist ein Beispiel.`, `Your portfolio is worth ${money(result.market_value_eur, lang)}, ${result.gain_eur >= 0 ? money(result.gain_eur, lang) + " above cost" : money(-result.gain_eur, lang) + " below cost"}. The three largest positions (${top.map(item => item.symbol).join(", ")}) make up ${pct(result.top_three_weight_pct, lang)}, and ${sector.name} alone ${pct(sector.weight_pct, lang)}. That is not automatically wrong, but a fall there would hit several positions at once. Before changing anything it is worth checking which regions and sectors the ETF already covers. Prices are delayed and the portfolio is a sample.`), [t(lang, "Worauf achte ich bei Diversifikation?", "What should I look at for diversification?"), t(lang, "Wie hoch ist mein Verlustrisiko?", "How big is my downside risk?")]);
  }

  if (RX.runway.test(trimmed)) {
    const runway = metricValue(picture, "runway");
    if (runway === null) return finish(t(lang, "Dafür brauche ich Ihr verfügbares Guthaben und Ihre monatlichen Ausgaben.", "For that I need your available cash and your monthly spending."), [], { pendingFact: n("expenses_monthly") === null ? "expenses_monthly" : "cash_liquid", onboarding });
    const target = n("emergency_target_months") ?? 6, gap = Math.max(0, target * (n("expenses_monthly") ?? 0) - (n("cash_liquid") ?? 0));
    return resume(runway >= target ? t(lang, `Ihre Reserve deckt ${num(runway, lang)} Monatsausgaben – mehr als Ihr Ziel von ${target} Monaten. Alles darüber (${money((n("cash_liquid") ?? 0) - target * (n("expenses_monthly") ?? 0), lang)}) könnte eine andere Aufgabe bekommen, muss es aber nicht.`, `Your reserve covers ${num(runway, lang)} months of spending, above your ${target}-month target. Anything above that (${money((n("cash_liquid") ?? 0) - target * (n("expenses_monthly") ?? 0), lang)}) could take on another job, but it does not have to.`) : t(lang, `Ihre Reserve reicht ${num(runway, lang)} Monate; Ziel sind ${target}. Es fehlen ${money(gap, lang)}. Bei ${money(metricValue(picture, "free_cashflow") ?? 0, lang)} frei im Monat wäre das in etwa ${Math.ceil(gap / Math.max(1, metricValue(picture, "free_cashflow") ?? 1))} Monaten erreichbar, wenn der gesamte Überschuss dorthin fließt.`, `Your reserve covers ${num(runway, lang)} months; the target is ${target}. ${money(gap, lang)} is missing. With ${money(metricValue(picture, "free_cashflow") ?? 0, lang)} free each month that is about ${Math.ceil(gap / Math.max(1, metricValue(picture, "free_cashflow") ?? 1))} months away if the whole surplus goes there.`), [t(lang, "Reserve-Ziel ändern", "Change reserve target"), t(lang, "Was ist gerade wichtig?", "What matters right now?")]);
  }

  if (RX.networth.test(trimmed)) {
    const netWorth = metricValue(picture, "net_worth");
    if (netWorth === null) return finish(t(lang, "Dafür brauche ich zumindest Ihr Guthaben und Ihre Anlagen.", "For that I need at least your cash and investments."), [], { pendingFact: "cash_liquid", onboarding });
    ctx.emitCard({ type: "picture", metrics: picture.metrics.filter(metric => ["net_worth", "total_assets", "total_liabilities", "liquid"].includes(metric.key)) });
    const items = (["property_value", "investments_value", "retirement_assets", "cash_liquid"] as FactKey[]).filter(key => n(key)).map(key => `${FACT_BY_KEY[key].label[lang].toLowerCase()} ${money(n(key)!, lang)}`);
    const debts = (["mortgage_balance", "other_debt"] as FactKey[]).filter(key => n(key)).map(key => `${FACT_BY_KEY[key].label[lang].toLowerCase()} ${money(n(key)!, lang)}`);
    const missing = picture.metrics.find(metric => metric.key === "net_worth")?.missing ?? [];
    return resume(t(lang, `Ihr Nettovermögen liegt bei ${money(netWorth, lang)}: ${items.join(", ")}${debts.length ? `, abzüglich ${debts.join(" und ")}` : ""}. ${missing.length ? `Noch nicht enthalten: ${missing.map(key => FACT_BY_KEY[key].label.de.toLowerCase()).join(", ")}.` : "Alle Bausteine sind erfasst."}`, `Your net worth is ${money(netWorth, lang)}: ${items.join(", ")}${debts.length ? `, minus ${debts.join(" and ")}` : ""}. ${missing.length ? `Not included yet: ${missing.map(key => FACT_BY_KEY[key].label.en.toLowerCase()).join(", ")}.` : "All the building blocks are in."}`), insightSuggestions(picture, lang));
  }

  if (RX.cashflow.test(trimmed)) {
    const free = metricValue(picture, "free_cashflow");
    if (free === null) return finish(t(lang, "Dafür brauche ich Einnahmen und Ausgaben.", "For that I need income and spending."), [], { pendingFact: n("income_net_monthly") === null ? "income_net_monthly" : "expenses_monthly", onboarding });
    const saving = n("monthly_saving");
    return resume(t(lang, `Es kommen ${money(n("income_net_monthly")!, lang)} rein und ${money(n("expenses_monthly")!, lang)} gehen raus – ${free >= 0 ? `es bleiben ${money(free, lang)} (${pct(metricValue(picture, "savings_rate") ?? 0, lang)})` : `es fehlen ${money(-free, lang)}`}. ${saving !== null ? `Davon legen Sie ${money(saving, lang)} bewusst an.` : "Wohin der Rest fließt, weiß ich nicht – Kontodaten habe ich nicht, nur Ihre Angaben."}`, `${money(n("income_net_monthly")!, lang)} comes in and ${money(n("expenses_monthly")!, lang)} goes out, ${free >= 0 ? `leaving ${money(free, lang)} (${pct(metricValue(picture, "savings_rate") ?? 0, lang)})` : `a shortfall of ${money(-free, lang)}`}. ${saving !== null ? `Of that you deliberately invest ${money(saving, lang)}.` : "Where the rest goes I cannot see; I only have your figures, not your bank data."}`), [t(lang, "Wie viel könnte ich monatlich anlegen?", "How much could I invest monthly?"), t(lang, "Wie steht meine Reserve?", "How is my reserve?")]);
  }

  if (RX.adviser.test(trimmed)) {
    const points = picture.insights.slice(0, 3).map(insight => insight.title[lang]);
    const open = picture.openQuestions.slice(0, 3).map(question => question.label[lang].toLowerCase());
    for (const point of points) await runToolAndRefresh("add_next_step", { text: t(lang, `Im Gespräch klären: ${point}`, `Discuss with adviser: ${point}`) }, ctx);
    return resume(t(lang, `Für ein Beratungsgespräch würde ich drei Dinge mitnehmen: ${points.join("; ")}. Und Unterlagen zu dem, was ich noch nicht weiß: ${open.join(", ")}. Ich habe die Punkte als nächste Schritte notiert.`, `For an adviser conversation I would bring three things: ${points.join("; ")}. Plus documents for what I do not know yet: ${open.join(", ")}. I have noted them as next steps.`), [t(lang, "Welche Fragen sollte ich stellen?", "What questions should I ask?")]);
  }

  if (RX.next.test(trimmed) || /^(ja|yes)[,!. ]*(zeig|show)/i.test(trimmed)) {
    if (!picture.insights.length) return resume(t(lang, "Dafür fehlen mir noch die Grundzahlen.", "I still need the basic numbers for that."), []);
    ctx.emitCard({ type: "picture", metrics: picture.metrics.slice(0, 4) });
    const [first, second, third] = picture.insights;
    return resume(t(lang, `Am wichtigsten: ${first.title.de}. ${first.body.de}${second ? ` Danach: ${second.title.de.charAt(0).toLowerCase() + second.title.de.slice(1)}.` : ""}${third ? ` Und im Blick behalten: ${third.title.de.charAt(0).toLowerCase() + third.title.de.slice(1)}.` : ""}`, `Most important: ${first.title.en}. ${first.body.en}${second ? ` After that: ${second.title.en.charAt(0).toLowerCase() + second.title.en.slice(1)}.` : ""}${third ? ` And keep an eye on: ${third.title.en.charAt(0).toLowerCase() + third.title.en.slice(1)}.` : ""}`), insightSuggestions(picture, lang));
  }

  if (RX.greeting.test(trimmed) && trimmed.length < 40) return resume(t(lang, `Hallo ${name}. ${firstRead(ctx.state, lang)}`, `Hi ${name}. ${firstRead(ctx.state, lang)}`), insightSuggestions(picture, lang));
  if (RX.thanks.test(trimmed) && trimmed.length < 40) return resume(t(lang, "Gern. Ich bin da, wenn Sie weitermachen möchten.", "You are welcome. I am here whenever you want to continue."), insightSuggestions(picture, lang, 2));

  // 6. Fallback: be honest, reflect, offer the two most useful directions.
  await runToolAndRefresh("remember", { text: t(lang, `Hat angesprochen: "${trimmed.slice(0, 120)}"`, `Raised: "${trimmed.slice(0, 120)}"`) }, ctx);
  return resume(t(lang, `Das nehme ich mit. Ohne Live-Modell kann ich dazu nichts Klügeres sagen, als was aus Ihren Zahlen folgt – und die zeigen vor allem ${picture.insights[0] ? picture.insights[0].title.de.charAt(0).toLowerCase() + picture.insights[0].title.de.slice(1) : "noch nicht viel, weil Grundzahlen fehlen"}.`, `I will keep that in mind. Without a live model I cannot say anything smarter than what follows from your numbers, and those mainly show ${picture.insights[0] ? picture.insights[0].title.en.charAt(0).toLowerCase() + picture.insights[0].title.en.slice(1) : "not much yet, because the basics are missing"}.`), [t(lang, "Was ist gerade wichtig?", "What matters right now?"), t(lang, "Wie steht mein Nettovermögen?", "What is my net worth?")]);
}

function questionApplies(key: FactKey, state: AppState): boolean {
  const property = factNumber(state.facts, "property_value");
  if (key === "mortgage_balance") return property !== null && property > 0;
  return true;
}

async function nextQuestion(ctx: ToolContext, lang: Lang, skipped: Set<FactKey>, finish: (reply: string, suggestions: string[], meta?: CompanionResult["meta"]) => CompanionResult, lead: string): Promise<CompanionResult> {
  const next = ONBOARDING.find(key => !ctx.state.facts[key] && !skipped.has(key) && questionApplies(key, ctx.state));
  if (next) return finish(askQuestion(next, lang, lead), questionSuggestions(next, lang), { pendingFact: next, onboarding: true });
  await runToolAndRefresh("finish_onboarding", {}, ctx);
  ctx.emitCard({ type: "picture", metrics: ctx.state.picture.metrics.slice(0, 4) });
  return finish(`${lead} ${t(lang, "Das reicht für ein erstes Bild.", "That is enough for a first picture.")} ${firstRead(ctx.state, lang)}`, insightSuggestions(ctx.state.picture, lang), { onboarding: false });
}

async function loadSample(ctx: ToolContext, lang: Lang, finish: (reply: string, suggestions: string[], meta?: CompanionResult["meta"]) => CompanionResult): Promise<CompanionResult> {
  await runToolAndRefresh("load_sample_data", {}, ctx);
  ctx.emitCard({ type: "picture", metrics: ctx.state.picture.metrics.slice(0, 4) });
  return finish(t(lang, `Ich habe einen fiktiven Beispielhaushalt geladen – Familie, Haus mit Hypothek, Depot. Alles ist als Beispiel markiert und lässt sich jederzeit durch Ihre eigenen Zahlen ersetzen. ${firstRead(ctx.state, lang)}`, `I have loaded a fictional sample household: a family, a house with a mortgage, a brokerage account. Everything is labelled as sample and you can replace it with your own numbers any time. ${firstRead(ctx.state, lang)}`), insightSuggestions(ctx.state.picture, lang), { onboarding: false });
}

export function detectStatedFacts(text: string, lang: Lang, now: Date): Array<{ key: FactKey; value: number | string }> {
  const results: Array<{ key: FactKey; value: number | string }> = [];
  const lower = text.toLowerCase();
  const isStatement = /\b(ist|sind|habe|hab|beträgt|liegt bei|verdiene|zahle|is|are|have|got|earn|make|pay|worth|=)\b/.test(lower) && !/\?\s*$/.test(text);
  if (!isStatement) return results;
  const retire = lower.match(/\b(?:rente mit|in rente mit|retire at|retirement age (?:is|of)|aufhören mit)\s*(\d{2})/);
  if (retire) results.push({ key: "retirement_age", value: Number(retire[1]) });
  const age = lower.match(/\b(?:ich bin|i am|i'm|im)\s+(\d{2})\b(?!\s*(k|%))/) || lower.match(/\b(\d{2})\s*(?:jahre alt|years old)\b/);
  if (age) results.push({ key: "age", value: Number(age[1]) });
  const fixed = lower.match(/\b(zinsbindung|fixed rate|fixed until|festgeschrieben)\b/);
  if (fixed) { const ym = extractYearMonth(text, now); if (ym) results.push({ key: "mortgage_fixed_until", value: ym }); }
  const amount = parseAmount(text.replace(/\b(mit|at)\s+\d{2}\b/g, ""), lang);
  if (amount !== null && amount > 100) {
    for (const [key, pattern] of FACT_HINTS) {
      if (key === "age" || key === "retirement_age") continue;
      if (pattern.test(lower) && !results.some(item => item.key === key)) { results.push({ key, value: amount }); break; }
    }
  }
  return results;
}

function formatFact(key: FactKey, value: number | string, lang: Lang): string {
  const def = FACT_BY_KEY[key];
  if (typeof value === "string") return def.choiceLabels?.[value]?.[lang] ?? value;
  if (def.type === "money") return money(value, lang);
  if (def.type === "percent") return pct(value, lang);
  if (def.type === "months") return `${num(value, lang)} ${t(lang, "Monate", "months")}`;
  if (def.type === "age") return `${value}`;
  return num(value, lang);
}

export { firstRead, insightSuggestions };

/** Extracts a plausible name from a short message; null if it does not look like one. */
export function extractName(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(RX.name);
  const candidate = (match ? match[1] : trimmed).replace(/[^\p{L}\p{M}' -]/gu, "").trim();
  if (!candidate || candidate.length < 2 || candidate.split(/\s+/).length > 3) return null;
  if (RX.greeting.test(candidate) || RX.skip.test(candidate) || /^(ja|yes|nein|no|ok|okay|sure|klar|give name|name)$/i.test(candidate)) return null;
  return candidate.split(/\s+/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function extractRetirementTarget(text: string): number | null {
  const match = text.match(/\b(?:retir\w*|ruhestand|rente)\b[^\d]{0,24}\b(?:at|mit)?\s*(\d{2})\b/i);
  if (!match) return null;
  const age = Number(match[1]);
  return age >= 18 && age <= 100 ? age : null;
}

/** Best-effort migration for assistant turns created before pendingFact was reliable. */
function inferAskedFact(text: string, state: AppState): FactKey | null {
  if (!text || !/[?]\s*$/.test(text.trim())) return null;
  const patterns: Array<[FactKey, RegExp]> = [
    ["income_net_monthly", /\b(net monthly income|monthly income|income after tax|take.?home|monatliches netto|nettoeinkommen)\b/i],
    ["expenses_monthly", /\b(monthly (?:expenses|spending|costs)|spend (?:each|per) month|monatliche ausgaben|ausgaben (?:im|pro) monat)\b/i],
    ["cash_liquid", /\b(cash reserve|available cash|cash savings|liquid cash|guthaben|reserve|notgroschen|tagesgeld)\b/i],
    ["investments_value", /\b(investments?|portfolio|brokerage|depot|angelegt)\b/i],
    ["property_value", /\b(property|home|house|flat|immobilie|haus|wohnung)\b/i],
    ["mortgage_balance", /\b(mortgage balance|remaining mortgage|restschuld|hypothek)\b/i],
    ["other_debt", /\b(other debt|other loans|weitere schulden|sonstige schulden)\b/i],
    ["retirement_age", /\b(what age.*(?:retire|stop working)|retirement age|mit welchem alter|wann.*(?:rente|ruhestand))\b/i],
    ["age", /\b(how old|your (?:current )?age|wie alt|ihr alter)\b/i],
    ["goal_primary", /\b(main goal|financial goal|want to achieve|most important to you|finanzielles ziel|möchten sie erreichen|ist ihnen.*wichtig)\b/i],
  ];
  for (const [key, pattern] of patterns) if (!state.facts[key] && pattern.test(text)) return key;
  return null;
}

/**
 * Deterministic pre-pass for the live model: stores what can be stored without a
 * model call (a name, an answer to the fact the assistant just asked for, facts stated
 * in prose) and finishes onboarding once the basics are covered.
 */
export async function prestore(text: string, ctx: ToolContext, history: Message[]): Promise<{ stored: Array<{ key: FactKey; value: number | string }>; name: string | null; skipped: FactKey[] }> {
  const lang = ctx.lang, trimmed = text.trim();
  const lastAssistant = [...history].reverse().find(message => message.role === "assistant");
  const skipped = new Set<FactKey>(lastAssistant?.meta?.skipped ?? []);
  const pending = lastAssistant?.meta?.pendingFact ?? null;
  const stored: Array<{ key: FactKey; value: number | string }> = [];
  let name: string | null = null;
  const isQuestion = /\?\s*$/.test(trimmed) || has(trimmed, RX.networth, RX.cashflow, RX.mortgage, RX.retirement, RX.help, RX.next, RX.million, RX.portfolio);
  if (RX.policy.test(trimmed) || RX.sample.test(trimmed)) return { stored, name, skipped: [...skipped] };
  if (!ctx.state.profile?.name) {
    const candidate = extractName(trimmed);
    if (candidate && !/\d/.test(trimmed)) { await runToolAndRefresh("set_name", { name: candidate }, ctx); name = candidate; }
  }
  if (pending) {
    if (RX.skip.test(trimmed)) skipped.add(pending);
    else if (!isQuestion || FACT_BY_KEY[pending].type === "text") {
      const value = parseFactAnswer(pending, trimmed, lang, ctx.now);
      const bareAnswer = FACT_BY_KEY[pending].type === "text" ? !name : /^[^a-zA-Z]*$|^(keine|nein|nichts|none|no|nope|nothing|zero|null)\b|\d/i.test(trimmed);
      if (value !== null && bareAnswer && !name) stored.push({ key: pending, value });
    }
  }
  for (const fact of detectStatedFacts(trimmed, lang, ctx.now)) if (!stored.some(item => item.key === fact.key)) stored.push(fact);
  if (stored.length) await runToolAndRefresh("set_facts", { facts: stored }, ctx);
  if (!ctx.state.profile?.onboardingDone && ctx.state.profile?.name) {
    const open = ONBOARDING.filter(key => !ctx.state.facts[key] && !skipped.has(key) && questionApplies(key, ctx.state));
    if (!open.length) await runToolAndRefresh("finish_onboarding", {}, ctx);
  }
  return { stored, name, skipped: [...skipped] };
}
