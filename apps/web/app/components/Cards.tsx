"use client";
import { Brain, CircleCheck, Database, Flag, Landmark, ListChecks, PieChart, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import type { Card, Lang } from "@fintwin/contracts";
import { FACT_BY_KEY } from "@fintwin/engine";
import { factDisplay, metricValue, money, pct, yearMonth } from "../lib/format";
import { copy } from "../lib/i18n";

export function CardView({ card, lang }: { card: Card; lang: Lang }) {
  const t = copy(lang).cards;
  switch (card.type) {
    case "facts":
      return <div className="card"><div className="card-head"><Database />{t.updated}<span className="spacer" /><small>{card.source === "sample" ? copy(lang).sampleNote : card.source === "edit" ? (lang === "de" ? "im Bild bearbeitet" : "edited in picture") : lang === "de" ? "aus dem Gespräch" : "from the conversation"}</small></div>
        <div className="chips">{card.items.map(item => <span className="chip accent" key={item.key}>{FACT_BY_KEY[item.key]?.label[lang] ?? item.key} <b className="num">{factDisplay(item.key, item.value, lang)}</b></span>)}</div></div>;
    case "mortgage": {
      const current = card.currentPayment;
      return <div className="card"><div className="card-head"><Landmark />{t.mortgage}<span className="spacer" /><small className="num">{money(card.principal, lang)} · {Math.round(card.months / 12)} {t.years}</small></div>
        <div className="mini-table">{current !== null && <div className="mini-row"><span>{t.today}</span><b className="num">{money(current, lang, 2)}</b><small>/ {t.month}</small></div>}
          {card.result.map(item => <div className={`mini-row ${item.annualRatePct === 5 ? "focus" : ""}`} key={item.annualRatePct}><span>{t.at} {pct(item.annualRatePct, lang)}</span><b className="num">{money(item.payment, lang, 2)}</b><small className="num">{current !== null ? `${item.payment - current >= 0 ? "+" : "−"}${money(Math.abs(item.payment - current), lang)}` : `${money(item.totalInterest, lang)} ${lang === "de" ? "Zinsen" : "interest"}`}</small></div>)}</div>
        <p className="note">{copy(lang).plan.model}</p></div>;
    }
    case "retirement": {
      const result = card.result, ratio = result.readinessRatio;
      return <div className="card"><div className="card-head"><TrendingUp />{t.retirement}<span className="spacer" /><small>{card.retirementAge !== null ? `${lang === "de" ? "mit" : "at"} ${card.retirementAge}` : ""}</small></div>
        <div className="metric-grid"><div className="metric"><small>{t.real}</small><strong className="num">{money(result.projectedReal, lang)}</strong><em>{result.input.years} {t.years}</em></div>
          <div className="metric"><small>{lang === "de" ? "Pro Monat" : "Per month"}</small><strong className="num">{money(result.sustainableMonthlyReal, lang)}</strong><em>{lang === "de" ? "4 % Entnahme" : "4% withdrawal"}</em></div>
          {result.requiredCapital !== null && <div className="metric"><small>{t.needed}</small><strong className="num">{money(result.requiredCapital, lang)}</strong><em>{lang === "de" ? "für Ihr Budget" : "for your target"}</em></div>}
          {ratio !== null && <div className="metric"><small>{t.covered}</small><strong className="num">{pct(Math.min(999, ratio * 100), lang, 0)}</strong><div className="bar"><i className={ratio < 0.8 ? "warn" : ""} style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div></div>}</div>
        <p className="note">{lang === "de" ? `Annahmen: ${result.input.annualReturnPct} % Rendite, ${result.input.annualFeePct} % Kosten, ${result.input.inflationPct} % Inflation. Modellrechnung.` : `Assumptions: ${result.input.annualReturnPct}% return, ${result.input.annualFeePct}% fees, ${result.input.inflationPct}% inflation. Model calculation.`}</p></div>;
    }
    case "goal": {
      const result = card.result;
      return <div className="card"><div className="card-head"><Flag />{t.goal}<span className="spacer" /><small>{card.label}</small></div>
        <div className="metric-grid"><div className="metric"><small>{lang === "de" ? "Zielbetrag" : "Target"}</small><strong className="num">{money(result.target, lang)}</strong><em>{t.start}: {money(result.start, lang)} · {money(result.monthly, lang)} {t.monthly}</em></div>
          <div className="metric"><small>{t.reached}</small><strong className="num">{result.reachedYearMonth ? yearMonth(result.reachedYearMonth, lang) : "—"}</strong><em>{result.months !== null ? `${Math.round(result.months / 12)} ${t.years}` : copy(lang).plan.never}</em></div></div>
        <div className="chips">{result.requiredMonthlyForYears.map(item => <span className="chip" key={item.years}>{item.years} {t.years}: <b className="num">{money(item.monthly, lang)}</b></span>)}</div></div>;
    }
    case "picture":
      return <div className="card"><div className="card-head"><Sparkles />{t.picture}</div>
        <div className="metric-grid">{card.metrics.map(metric => <div className={`metric ${metric.tone}`} key={metric.key}><small><i className={`tone ${metric.tone}`} />{metric.label[lang]}</small><strong className="num">{metricValue(metric.value, metric.unit, lang)}</strong>{metric.note && <em>{metric.note[lang]}</em>}</div>)}</div></div>;
    case "portfolio":
      return <div className="card"><div className="card-head"><PieChart />{t.portfolio}<span className="spacer" /><small>{copy(lang).delayed}</small></div>
        <div className="metric-grid"><div className="metric"><small>{copy(lang).valueNow}</small><strong className="num">{money(card.summary.marketValueEur, lang)}</strong><em className={card.summary.gainEur >= 0 ? "pos" : "neg"}>{card.summary.gainEur >= 0 ? "+" : ""}{money(card.summary.gainEur, lang)} ({pct(card.summary.gainPct, lang)})</em></div>
          <div className="metric"><small>{copy(lang).top3}</small><strong className="num">{pct(card.summary.topThreeWeightPct, lang, 0)}</strong><em>{card.top.map(item => item.symbol).join(" · ")}</em></div></div>
        <div className="bar">{card.sectors.map((sector, index) => <i key={sector.name} className={`s${Math.min(3, index)}`} style={{ width: `${sector.weightPct}%` }} title={sector.name} />)}</div>
        <div className="legend">{card.sectors.map((sector, index) => <span key={sector.name}><i className={`s${Math.min(3, index)}`} />{sector.name} {pct(sector.weightPct, lang, 0)}</span>)}</div></div>;
    case "next_step":
      return <div className="card"><div className="card-head"><ListChecks />{t.step}</div><div className="step"><CircleCheck style={{ width: 16, color: "var(--accent)" }} /><span>{card.step.text}</span></div></div>;
    case "memory":
      return <span className="chip"><Brain />{t.memory}: {card.text}</span>;
    case "sample_loaded":
      return <span className="chip amber"><Database />{t.sample}</span>;
    case "policy":
      return <span className="chip"><ShieldCheck />{t.policy}: {card.reason}</span>;
    default:
      return null;
  }
}
