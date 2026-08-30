from __future__ import annotations

from .twin_service import DemoState


BLOCKED = ("recommend", "empfehlen", "best product", "bestes produkt", "buy", "kaufen", "trade", "handeln", "tax conclusion", "steuerlich verbindlich", "approve my loan", "kredit genehmigen")


def scripted_answer(question: str, state: DemoState) -> dict[str, object]:
    query = question.casefold()
    if any(term in query for term in BLOCKED):
        return {
            "display_response": "Dabei kann FinTwin keine konkrete Produktempfehlung, Rangfolge, Transaktion oder verbindliche Steuer-/Kreditaussage geben. Ich kann stattdessen Kriterien und Fragen für ein Gespräch mit einer qualifizierten Fachperson strukturieren.",
            "claims": [],
            "tool_calls": [],
            "assumptions": [],
            "warnings": ["Blocked by policy: regulated recommendation or execution."],
            "follow_up_question": "Soll ich neutrale Vergleichskriterien zusammenstellen?",
            "policy_result": "blocked",
            "requires_human_review": True,
            "mode": "scripted_fallback",
        }
    if "last month" in query or "letzten monat" in query or "geld" in query:
        text = "Im August lagen die externen Einnahmen bei €7.240 und die externen Ausgaben bei €6.672. Eigenüberträge sind ausgeschlossen; der freie Cashflow betrug damit €568."
        claims = [{"text": "August external inflows were €7,240.", "source_ids": ["agg_cashflow_202608"], "confidence": "0.99"}, {"text": "August external outflows were €6,672, excluding own transfers.", "source_ids": ["agg_cashflow_202608", "transfer_matches_202608"], "confidence": "0.99"}]
        tool = "get_financial_snapshot"
    elif "recurring" in query or "wiederkehr" in query or "größten" in query:
        text = "Die größten wiederkehrenden Kosten sind die Immobilienrate (€1.420), Krankenversicherung (€612) und Bildungsunterstützung (€520). Verifizierte laufende Kosten stiegen im Jahresvergleich um €134 pro Monat."
        claims = [{"text": "Verified recurring costs increased by €134 per month year over year.", "source_ids": ["agg_recurring_yoy_202608"], "confidence": "0.98"}]
        tool = "get_recurring_series"
    elif "net worth" in query or "nettovermögen" in query or "vermögen" in query:
        text = "Das Nettovermögen beträgt €487.320. Kontosalden sind vom 30. August, Depotwerte vom 29. August und die Immobilie ist eine synthetische Bewertung vom 1. Juli."
        claims = [{"text": "Current net worth is €487,320.", "source_ids": ["agg_net_worth_202608"], "confidence": "0.97"}]
        tool = "get_financial_snapshot"
    elif "4%" in query or "5%" in query or "6%" in query or "refix" in query or "anschluss" in query:
        text = "Bei €240.000 Restschuld und 240 Monaten beträgt die modellierte Monatsrate bei 4% €1.454,35, bei 5% €1.583,89 und bei 6% €1.719,43. Das ist eine Planungssensitivität, kein Kreditangebot."
        claims = [{"text": "Modelled monthly payments are €1,454.35 at 4%, €1,583.89 at 5%, and €1,719.43 at 6%.", "source_ids": ["scenario_mortgage_4", "scenario_mortgage_5", "scenario_mortgage_6", "fact_mortgage_balance"], "confidence": "1.00"}]
        tool = "run_mortgage_scenario"
    elif "retiring at 63" in query or "retire at 63" in query or "ruhestand mit 63" in query or "rente mit 63" in query:
        text = "Unter den Baseline-Annahmen ergeben sich mit 63 rund €299.810 in heutigen Euro. Dem stehen rund €325.714 erforderliches Kapital gegenüber; die Readiness Ratio beträgt 92%. Dies ist keine Prognose."
        claims = [{"text": "The age-63 baseline produces €299,810.07 real projected assets and a 0.920 readiness ratio.", "source_ids": ["scenario_retirement_age63", "fact_retirement_assets", "fact_goal_retirement"], "confidence": "1.00"}]
        tool = "run_retirement_baseline"
    elif "assumption" in query or "annahme" in query:
        text = "Das Rentenalter verändert dieses Baseline-Ergebnis am stärksten: Ein zusätzliches Jahr bringt weitere Beiträge und ein weiteres Jahr Verzinsung. Rendite, Gebühren und Zielausgaben bleiben ebenfalls offen ausgewiesene Annahmen."
        claims = [{"text": "Retirement timing is the largest tested lever in the baseline sensitivity.", "source_ids": ["scenario_retirement_sensitivity_age"], "confidence": "1.00"}]
        tool = "explain_calculation"
    elif "well understood" in query or "need review" in query or "gut verstanden" in query or "prüfung" in query:
        text = "Gut belegt sind Einkommen, Kontobewegungen und regelmäßige Depotbeiträge. Review benötigen die Anschlussfinanzierung, gestiegene laufende Kosten und Annas unbestätigter Einkommensschutz; außerdem fehlt ein bestätigter Netto-Rentenwert."
        claims = [{"text": "Mortgage refix, recurring-cost drift, and incomplete protection data are current review topics.", "source_ids": ["finding_mortgage_refix", "finding_recurring_cost_drift", "finding_protection_data_incomplete"], "confidence": "1.00"}]
        tool = "get_allfinanz_review"
    elif "bring" in query or "mitbringen" in query or "adviser" in query or "berater" in query:
        text = "Bringen Sie die aktuelle Einkommensschutz-Police von Anna, bestätigte Netto-Rentenansprüche, den Darlehensvertrag und Ihr gewünschtes Ausgabeniveau im Ruhestand mit."
        claims = [{"text": "Anna’s income-protection fact is incomplete.", "source_ids": ["finding_protection_data_incomplete"], "confidence": "1.00"}]
        tool = "get_allfinanz_review"
    else:
        text = "Ich kann Cashflow, wiederkehrende Kosten, Nettovermögen, Review-Themen und gespeicherte Szenarien anhand der verifizierten Demo-Daten erklären. Stellen Sie bitte eine konkrete Frage zu einem dieser Bereiche."
        claims = []
        tool = "get_allfinanz_review"
    return {"display_response": text, "claims": claims, "tool_calls": [{"name": tool, "trace_id": "trace_scripted_001"}], "assumptions": [], "warnings": [], "follow_up_question": None, "policy_result": "allowed", "requires_human_review": False, "mode": "scripted_fallback"}
