from __future__ import annotations

import json
import os
from typing import Any

from .twin_service import DemoState

BLOCKED = ("recommend", "empfehlen", "best product", "bestes produkt", "buy", "kaufen", "trade", "handeln", "steuerlich verbindlich", "kredit genehmigen")


def ai_available() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def _blocked_answer() -> dict[str, object]:
    return {
        "display_response": "Dabei kann FinTwin keine konkrete Produktempfehlung, Rangfolge, Transaktion oder verbindliche Steuer- oder Kreditaussage geben. Ich kann stattdessen neutrale Kriterien und Fragen für eine qualifizierte Fachperson strukturieren.",
        "claims": [], "tool_calls": [], "assumptions": [],
        "warnings": ["Durch die Richtlinie für regulierte Empfehlungen begrenzt."],
        "follow_up_question": "Soll ich neutrale Vergleichskriterien zusammenstellen?",
        "policy_result": "blocked", "requires_human_review": True, "mode": "policy_guard",
    }


def _tool_context(state: DemoState) -> dict[str, Any]:
    return {
        "household": "Michael und Anna Becker, synthetischer Demo-Haushalt",
        "as_of": "2026-08-30T10:00:00+02:00", "twin_version": state.version,
        "financial_snapshot": {"net_household_income_monthly_eur": 7240, "external_outflows_august_eur": 6672, "free_cashflow_august_eur": 568, "net_worth_eur": 487320, "emergency_runway_months": 7.8, "source_ids": ["agg_cashflow_202608", "transfer_matches_202608", "agg_net_worth_202608"]},
        "recurring_costs": {"items": [{"name": "Immobilienrate", "monthly_eur": 1420}, {"name": "Krankenversicherung", "monthly_eur": 612}, {"name": "Bildungsunterstützung", "monthly_eur": 520}], "year_over_year_change_monthly_eur": 134, "source_ids": ["agg_recurring_yoy_202608"]},
        "review_topics": {"items": ["Zinsbindung endet am 31.10.2027", "Wiederkehrende Kosten sind um 134 Euro pro Monat gestiegen", "Annas Einkommensschutz ist nicht bestätigt", "Bestätigter Netto-Rentenwert fehlt"], "source_ids": ["finding_mortgage_refix", "finding_recurring_cost_drift", "finding_protection_data_incomplete", "fact_goal_retirement"]},
        "mortgage_sensitivity": {"principal_eur": 240000, "remaining_months": 240, "monthly_payment_eur": {"4_percent": 1454.35, "5_percent": 1583.89, "6_percent": 1719.43}, "source_ids": ["scenario_mortgage_4", "scenario_mortgage_5", "scenario_mortgage_6", "fact_mortgage_balance"]},
        "retirement_baseline": {"target_age": 63, "projected_real_assets_eur": 299810.07, "required_capital_eur": 325714, "readiness_ratio": 0.92, "source_ids": ["scenario_retirement_age63", "fact_retirement_assets", "fact_goal_retirement"]},
    }


def _source_ids(context: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for value in context.values():
        if isinstance(value, dict) and isinstance(value.get("source_ids"), list):
            values.extend(value["source_ids"])
    return list(dict.fromkeys(values))


def live_answer(question: str, state: DemoState) -> dict[str, object]:
    if any(term in question.casefold() for term in BLOCKED):
        return _blocked_answer()
    if not ai_available():
        return scripted_answer(question, state)

    from openai import OpenAI
    context = _tool_context(state)
    client = OpenAI()
    tool = {"type": "function", "name": "get_verified_household_context", "description": "Liefert ausschließlich verifizierte FinTwin-Demodaten mit Quellen-IDs.", "parameters": {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"], "additionalProperties": False}, "strict": True}
    first = client.responses.create(
        model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
        instructions="Du bist der deutschsprachige FinTwin-Assistent. Keine Produkt-, Transaktions-, Steuer-, Rechts- oder Kreditentscheidung. Nutze ausschließlich Werkzeugdaten und kennzeichne Szenarien als Modellrechnung.",
        input=question, tools=[tool], tool_choice={"type": "function", "name": "get_verified_household_context"},
    )
    calls = [item for item in first.output if getattr(item, "type", None) == "function_call"]
    if not calls:
        raise RuntimeError("Erforderlicher Werkzeugaufruf fehlt")
    final = client.responses.create(
        model=os.getenv("OPENAI_MODEL", "gpt-5-mini"), previous_response_id=first.id,
        input=[{"type": "function_call_output", "call_id": call.call_id, "output": json.dumps(context, ensure_ascii=False)} for call in calls],
        tools=[tool], instructions="Antworte ausschließlich aus dem Werkzeugergebnis, auf Deutsch und in höchstens 120 Wörtern. Nutze deutsches Zahlenformat und erfinde keine Werte.",
    )
    answer = final.output_text.strip()
    return {
        "display_response": answer,
        "claims": [{"text": answer, "source_ids": _source_ids(context), "confidence": "model_with_verified_context"}],
        "tool_calls": [{"name": "get_verified_household_context", "trace_id": first.id}],
        "assumptions": [], "warnings": ["KI-generierte Einordnung; wichtige Entscheidungen menschlich prüfen."],
        "follow_up_question": None, "policy_result": "allowed", "requires_human_review": True, "mode": "openai_live",
    }


def scripted_answer(question: str, state: DemoState) -> dict[str, object]:
    query = question.casefold()
    if any(term in query for term in BLOCKED):
        return _blocked_answer()
    if "wiederkehr" in query or "kosten" in query:
        text, sources, tool = "Die größten regelmäßigen Ausgaben sind Immobilienrate (1.420 €), Krankenversicherung (612 €) und Bildungsunterstützung (520 €). Die verifizierten laufenden Kosten liegen 134 € pro Monat über dem Vorjahr.", ["agg_recurring_yoy_202608"], "get_recurring_series"
    elif "vermögen" in query:
        text, sources, tool = "Das Nettovermögen beträgt 487.320 €. Kontosalden sind vom 30. August, Depotwerte vom 29. August; die Immobilie basiert auf einer synthetischen Bewertung vom 1. Juli.", ["agg_net_worth_202608"], "get_financial_snapshot"
    elif any(term in query for term in ("zins", "hypothek", "anschluss", "4 %", "5 %", "6 %")):
        text, sources, tool = "Bei 240.000 € Restschuld und 240 Monaten beträgt die modellierte Monatsrate bei 4 % 1.454,35 €, bei 5 % 1.583,89 € und bei 6 % 1.719,43 €. Das ist eine Sensitivitätsrechnung, kein Kreditangebot.", ["scenario_mortgage_4", "scenario_mortgage_5", "scenario_mortgage_6", "fact_mortgage_balance"], "run_mortgage_scenario"
    elif "rente" in query or "ruhestand" in query:
        text, sources, tool = "Im Basisszenario stehen mit 63 rund 299.810 € in heutiger Kaufkraft einem Kapitalbedarf von rund 325.714 € gegenüber. Der Deckungsgrad beträgt 92 %. Das ist eine Modellrechnung, keine Prognose.", ["scenario_retirement_age63", "fact_retirement_assets", "fact_goal_retirement"], "run_retirement_baseline"
    elif "mitbringen" in query or "berater" in query:
        text, sources, tool = "Für das Gespräch fehlen vor allem Annas aktuelle Einkommensschutz-Police, bestätigte Netto-Rentenansprüche, der Darlehensvertrag und das gewünschte Ausgabenniveau im Ruhestand.", ["finding_protection_data_incomplete", "fact_goal_retirement"], "get_allfinanz_review"
    else:
        text, sources, tool = "Im August lagen die externen Einnahmen bei 7.240 € und die externen Ausgaben bei 6.672 €. Eigenüberträge sind ausgeschlossen; der freie Cashflow betrug 568 €.", ["agg_cashflow_202608", "transfer_matches_202608"], "get_financial_snapshot"
    return {
        "display_response": text, "claims": [{"text": text, "source_ids": sources, "confidence": "deterministic"}],
        "tool_calls": [{"name": tool, "trace_id": "trace_demo_001"}], "assumptions": [],
        "warnings": ["Demo-Antwort: Für Live-KI OPENAI_API_KEY konfigurieren."], "follow_up_question": None,
        "policy_result": "allowed", "requires_human_review": False, "mode": "scripted_fallback",
    }
