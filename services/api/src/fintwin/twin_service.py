from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from threading import RLock
from uuid import uuid4


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


INITIAL_FACTS = [
    {"fact_id": "fact_household_michael_age", "path": "household.michael.age", "value": 52, "label": "Michael’s age", "source_type": "user_confirmed", "source_ids": ["intake_001"], "observed_at": "2026-08-30T10:00:00Z", "effective_from": "2026-08-30", "confidence": "1.00", "verification_status": "confirmed"},
    {"fact_id": "fact_household_anna_age", "path": "household.anna.age", "value": 50, "label": "Anna’s age", "source_type": "user_confirmed", "source_ids": ["intake_002"], "observed_at": "2026-08-30T10:00:00Z", "effective_from": "2026-08-30", "confidence": "1.00", "verification_status": "confirmed"},
    {"fact_id": "fact_income_michael", "path": "income.michael.net_monthly", "value": "4380.00", "label": "Michael net income", "source_type": "synthetic_feed", "source_ids": ["src_txn_salary_latest"], "observed_at": "2026-08-27T06:00:00Z", "effective_from": "2026-08-01", "confidence": "1.00", "verification_status": "verified"},
    {"fact_id": "fact_income_anna", "path": "income.anna.net_monthly", "value": "2860.00", "label": "Anna net income", "source_type": "synthetic_feed", "source_ids": ["src_txn_salary_anna_latest"], "observed_at": "2026-08-28T06:00:00Z", "effective_from": "2026-08-01", "confidence": "1.00", "verification_status": "verified"},
    {"fact_id": "fact_goal_retirement", "path": "goals.retirement.target_age", "value": 63, "label": "Retirement target age", "source_type": "inferred", "source_ids": ["intake_note_004"], "observed_at": "2026-08-20T14:00:00Z", "effective_from": "2026-08-20", "confidence": "0.82", "verification_status": "proposed"},
    {"fact_id": "fact_goal_reserve", "path": "goals.emergency_reserve.months", "value": 6, "label": "Emergency reserve target", "source_type": "user_confirmed", "source_ids": ["intake_005"], "observed_at": "2026-08-20T14:00:00Z", "effective_from": "2026-08-20", "confidence": "1.00", "verification_status": "confirmed"},
    {"fact_id": "fact_mortgage_balance", "path": "liabilities.mortgage.principal", "value": "240000.00", "label": "Mortgage principal", "source_type": "synthetic_feed", "source_ids": ["mortgage_snapshot_202608"], "observed_at": "2026-08-01T08:00:00Z", "effective_from": "2026-08-01", "confidence": "1.00", "verification_status": "verified"},
    {"fact_id": "fact_mortgage_end", "path": "liabilities.mortgage.fixed_rate_end", "value": "2027-10-31", "label": "Fixed-rate end", "source_type": "synthetic_feed", "source_ids": ["mortgage_contract_001"], "observed_at": "2026-08-01T08:00:00Z", "effective_from": "2026-08-01", "confidence": "0.99", "verification_status": "verified"},
    {"fact_id": "fact_retirement_assets", "path": "assets.retirement.current", "value": "184000.00", "label": "Retirement assets", "source_type": "derived", "source_ids": ["asset_snapshot_m_202608", "asset_snapshot_a_202608"], "observed_at": "2026-08-30T09:00:00Z", "effective_from": "2026-08-30", "confidence": "0.98", "verification_status": "verified"},
]

REVIEW = [
    {"domain": "Absicherung", "status": "incomplete", "title": "Einkommensschutz-Daten unvollständig", "why": "Annas Einkommensschutz ist nicht bestätigt.", "evidence_ids": ["fact_income_anna"], "missing_facts": ["insurance.anna.income_protection"], "question": "Welche Leistungen und Laufzeiten stehen in Annas Police?"},
    {"domain": "Altersvorsorge", "status": "attention", "title": "Rentenbasis prüfen", "why": "Das Zielalter 63 ist nur mit 82% Konfidenz erfasst.", "evidence_ids": ["fact_goal_retirement", "fact_retirement_assets"], "missing_facts": ["pension.anna.expected_net"], "question": "Welche bestätigten Netto-Rentenansprüche liegen vor?"},
    {"domain": "Vermögensaufbau", "status": "reviewed", "title": "Regelmäßige Beiträge erkannt", "why": "Monatliche Eigenüberträge zu beiden Depots sind vollständig abgeglichen.", "evidence_ids": ["transfer_series_investments"], "missing_facts": [], "question": "Dienen freie liquide Mittel einem bereits geplanten Ziel?"},
    {"domain": "Wohneigentum", "status": "attention", "title": "Zinsbindung endet in 14 Monaten", "why": "Die Anschlussrate kann die monatliche Belastung deutlich verändern.", "evidence_ids": ["fact_mortgage_balance", "fact_mortgage_end"], "missing_facts": [], "question": "Welche Rate bleibt bei 4%, 5% oder 6% tragbar?"},
    {"domain": "Geld sparen & managen", "status": "attention", "title": "Wiederkehrende Kosten steigen", "why": "Verifizierte laufende Kosten liegen €134 pro Monat über dem Vorjahr.", "evidence_ids": ["agg_recurring_yoy_202608"], "missing_facts": [], "question": "Welche Kostenänderungen sind beabsichtigt?"},
    {"domain": "Konzepte für Kinder", "status": "incomplete", "title": "Bildungsziel noch nicht bestätigt", "why": "Zielbetrag und Zieldatum fehlen.", "evidence_ids": ["household_dependents"], "missing_facts": ["goals.education.target_amount", "goals.education.target_date"], "question": "Welcher Betrag soll bis wann verfügbar sein?"},
    {"domain": "Firmenkunden", "status": "not_in_demo", "title": "Nicht Teil dieser Demo", "why": "Der Prototyp ist ausschließlich für private Haushalte ausgelegt.", "evidence_ids": [], "missing_facts": [], "question": None},
]


@dataclass
class VersionConflict(Exception):
    current_version: int


class DemoState:
    def __init__(self) -> None:
        self._lock = RLock()
        self.reset()

    def reset(self) -> None:
        with getattr(self, "_lock", RLock()):
            self.version = 17
            self.facts = deepcopy(INITIAL_FACTS)
            self.proposals: dict[str, dict[str, object]] = {}
            self.idempotency: dict[str, dict[str, object]] = {}
            self.scenarios: list[dict[str, object]] = []
            self.audit: list[dict[str, object]] = []

    def snapshot(self) -> dict[str, object]:
        return {"household_id": "hh_becker", "version": self.version, "facts": deepcopy(self.facts), "as_of": "2026-08-30T10:00:00Z"}

    def review(self) -> dict[str, object]:
        return {"strengths": [REVIEW[2]], "topics": [REVIEW[3], REVIEW[4], REVIEW[0]], "domains": deepcopy(REVIEW), "rule_version": "needs-review-1.0.0"}

    def propose(self, *, path: str, value: object, expected_version: int, idempotency_key: str) -> dict[str, object]:
        with self._lock:
            if cached := self.idempotency.get(idempotency_key):
                return deepcopy(cached)
            if expected_version != self.version:
                raise VersionConflict(self.version)
            current = next((fact for fact in self.facts if fact["path"] == path), None)
            proposal = {"proposal_id": f"proposal_{uuid4().hex[:10]}", "path": path, "proposed_value": value, "current_value": current["value"] if current else None, "status": "proposed", "expected_twin_version": self.version, "created_at": now_iso()}
            self.proposals[proposal["proposal_id"]] = proposal
            self.idempotency[idempotency_key] = proposal
            return deepcopy(proposal)

    def confirm(self, proposal_id: str, *, expected_version: int, idempotency_key: str) -> dict[str, object]:
        with self._lock:
            if cached := self.idempotency.get(idempotency_key):
                return deepcopy(cached)
            if expected_version != self.version:
                raise VersionConflict(self.version)
            proposal = self.proposals.get(proposal_id)
            if not proposal:
                raise KeyError(proposal_id)
            old = next((fact for fact in self.facts if fact["path"] == proposal["path"]), None)
            if old:
                old["verification_status"] = "superseded"
            new_fact = {"fact_id": f"fact_{uuid4().hex[:12]}", "path": proposal["path"], "value": proposal["proposed_value"], "label": old["label"] if old else proposal["path"], "source_type": "user_confirmed", "source_ids": [proposal_id], "observed_at": now_iso(), "effective_from": datetime.now(UTC).date().isoformat(), "confidence": "1.00", "verification_status": "confirmed", "supersedes_fact_id": old["fact_id"] if old else None}
            self.facts.append(new_fact)
            self.version += 1
            proposal["status"] = "confirmed"
            result = {"proposal": deepcopy(proposal), "fact": deepcopy(new_fact), "twin_version": self.version}
            self.idempotency[idempotency_key] = result
            self.audit.append({"event": "fact_confirmed", "actor": "demo_user", "proposal_id": proposal_id, "twin_version": self.version, "at": now_iso()})
            return result

    def save_scenario(self, scenario: dict[str, object], idempotency_key: str) -> dict[str, object]:
        with self._lock:
            if cached := self.idempotency.get(idempotency_key):
                return deepcopy(cached)
            saved = {"run_id": f"run_{uuid4().hex[:12]}", "twin_version": self.version, "created_at": now_iso(), **scenario}
            self.scenarios.append(saved)
            self.idempotency[idempotency_key] = saved
            return deepcopy(saved)


state = DemoState()
