from __future__ import annotations

import os
from datetime import date, datetime, UTC
from decimal import Decimal
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .copilot import scripted_answer
from .finance_engine import child_goal_plan, mortgage_refix, retirement_baseline
from .generator import HOUSEHOLD_ID, generate_fixture
from .reconciliation import reconcile
from .twin_service import VersionConflict, state

app = FastAPI(title="FinTwin API", version="1.0.0", description="Synthetic-only, deterministic Allfinanz review demonstration")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])
fixture = generate_fixture()


class FactProposalBody(BaseModel):
    path: str
    typed_value: str | int | Decimal


class MortgageBody(BaseModel):
    principal: Decimal = Field(gt=0)
    annual_nominal_rate: Decimal = Field(ge=0, le=Decimal("0.20"))
    remaining_months: int = Field(gt=0, le=600)
    monthly_special_repayment: Decimal = Field(default=Decimal("0"), ge=0)
    scenario_start_date: date = date(2027, 11, 1)


class RetirementBody(BaseModel):
    current_assets: Decimal = Field(ge=0)
    monthly_contribution: Decimal = Field(ge=0)
    years_to_retirement: int = Field(gt=0, le=60)
    annual_nominal_return: Decimal = Field(ge=Decimal("-0.5"), le=Decimal("0.5"))
    annual_fee: Decimal = Field(ge=0, le=Decimal("0.20"))
    annual_inflation: Decimal = Field(ge=0, le=Decimal("0.20"))
    expected_net_pension_income: Decimal | None = Field(default=None, ge=0)
    target_retirement_spending: Decimal = Field(gt=0)
    withdrawal_rate: Decimal = Field(gt=0, le=Decimal("0.20"))


class ChildGoalBody(BaseModel):
    target_amount: Decimal = Field(gt=0)
    current_savings: Decimal = Field(ge=0)
    years: int = Field(gt=0, le=30)
    annual_return: Decimal = Field(ge=0, le=Decimal("0.30"))


class CopilotBody(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    language: Literal["de", "en"] = "de"


class BriefBody(BaseModel):
    selected_run_ids: list[str] = Field(default_factory=list)
    language: Literal["de", "en"] = "de"


def ensure_household(household_id: str) -> None:
    if household_id != HOUSEHOLD_ID:
        raise HTTPException(status_code=404, detail="Household not found")


def require_key(value: str | None) -> str:
    if not value:
        raise HTTPException(status_code=400, detail="Idempotency-Key header is required")
    return value


def expected_version(if_match: str | None) -> int:
    if not if_match:
        raise HTTPException(status_code=428, detail="If-Match header is required")
    try:
        return int(if_match.strip('W/"'))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="If-Match must contain the expected Twin version") from exc


def envelope(data: object, source_ids: list[str] | None = None, warnings: list[str] | None = None, engine_version: str | None = None) -> dict[str, object]:
    return {"ok": True, "data": data, "as_of": "2026-08-30T10:00:00Z", "twin_version": state.version, "source_ids": source_ids or [], "assumptions": [], "warnings": warnings or [], "engine_version": engine_version, "correlation_id": f"req_{uuid4().hex[:12]}"}


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {"status": "ok", "mode": "synthetic-demo", "demo_mode": True, "regulated_recommendations": False, "version": "1.0.0"}


@app.get("/v1/demo/households/{household_id}/overview")
def overview(household_id: str) -> dict[str, object]:
    ensure_household(household_id)
    reports = reconcile(fixture)
    data = {"household": fixture["household"], "transaction_count": len(fixture["transactions"]), "reconciled_periods": sum(item["status"] == "reconciled" for item in reports), "period_count": len(reports), "metrics": {"net_worth": "487320.00", "free_cashflow": "568.00", "free_cashflow_yoy_delta": "-185.00", "emergency_runway_months": "7.8", "fixed_cost_ratio": "0.54"}, "changes": [{"title": "Gehalt bestätigt", "detail": "Michaels monatliches Nettoeinkommen beträgt jetzt €4.380.", "at": "2026-08-18"}, {"title": "Zinsbindung im Review-Fenster", "detail": "Die Zinsbindung endet am 31.10.2027.", "at": "2026-08-01"}], "synthetic": True}
    return envelope(data, ["fixture_becker_v1", "agg_net_worth_202608", "agg_cashflow_202608"])


@app.get("/v1/households/{household_id}/twin")
def get_twin(household_id: str, version: int | None = None) -> dict[str, object]:
    ensure_household(household_id)
    if version is not None and version > state.version:
        raise HTTPException(status_code=404, detail="Twin version not found")
    return envelope(state.snapshot(), [fact["fact_id"] for fact in state.facts if fact["verification_status"] != "superseded"])


@app.post("/v1/households/{household_id}/facts/proposals")
def propose_fact(household_id: str, body: FactProposalBody, idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None, if_match: Annotated[str | None, Header(alias="If-Match")] = None) -> dict[str, object]:
    ensure_household(household_id)
    try:
        result = state.propose(path=body.path, value=str(body.typed_value) if isinstance(body.typed_value, Decimal) else body.typed_value, expected_version=expected_version(if_match), idempotency_key=require_key(idempotency_key))
    except VersionConflict as conflict:
        raise HTTPException(status_code=409, detail={"code": "TWIN_VERSION_CONFLICT", "current_version": conflict.current_version}) from conflict
    return envelope(result)


@app.post("/v1/fact-proposals/{proposal_id}/confirm")
def confirm_fact(proposal_id: str, idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None, if_match: Annotated[str | None, Header(alias="If-Match")] = None) -> dict[str, object]:
    try:
        result = state.confirm(proposal_id, expected_version=expected_version(if_match), idempotency_key=require_key(idempotency_key))
    except VersionConflict as conflict:
        raise HTTPException(status_code=409, detail={"code": "TWIN_VERSION_CONFLICT", "current_version": conflict.current_version}) from conflict
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Proposal not found") from exc
    return envelope(result, [result["fact"]["fact_id"]])


@app.get("/v1/households/{household_id}/review")
def get_review(household_id: str) -> dict[str, object]:
    ensure_household(household_id)
    review = state.review()
    source_ids = [item for domain in review["domains"] for item in domain["evidence_ids"]]
    return envelope(review, source_ids)


@app.get("/v1/households/{household_id}/transactions")
def transactions(household_id: str, category: str | None = None, q: str | None = None, cursor: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100)) -> dict[str, object]:
    ensure_household(household_id)
    records = fixture["transactions"]
    if category:
        records = [tx for tx in records if tx["category"] == category]
    if q:
        records = [tx for tx in records if q.casefold() in tx["description"].casefold()]
    page = records[cursor:cursor + limit]
    next_cursor = cursor + limit if cursor + limit < len(records) else None
    return envelope({"items": page, "next_cursor": next_cursor, "total": len(records)}, [tx["source_id"] for tx in page])


@app.get("/v1/households/{household_id}/recurring")
def recurring(household_id: str) -> dict[str, object]:
    ensure_household(household_id)
    series = [{"name": "Immobilienrate", "monthly_amount": "1420.00", "confidence": "1.00", "change_yoy": "0.00"}, {"name": "Krankenversicherung", "monthly_amount": "638.80", "confidence": "0.99", "change_yoy": "26.80"}, {"name": "Bildungsunterstützung", "monthly_amount": "520.00", "confidence": "1.00", "change_yoy": "0.00"}]
    return envelope({"series": series, "annualized_delta": "1608.00"}, ["agg_recurring_yoy_202608"])


@app.post("/v1/households/{household_id}/scenarios/mortgage")
def run_mortgage(household_id: str, body: MortgageBody, idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict[str, object]:
    ensure_household(household_id)
    result = mortgage_refix(principal=body.principal, annual_nominal_rate=body.annual_nominal_rate, months=body.remaining_months, start_date=body.scenario_start_date, monthly_special_repayment=body.monthly_special_repayment)
    saved = state.save_scenario({"kind": "mortgage", "inputs": body.model_dump(mode="json"), "result": result}, require_key(idempotency_key))
    return envelope(saved, ["fact_mortgage_balance", "fact_mortgage_end"], result["warnings"], result["engine_version"])


@app.post("/v1/households/{household_id}/scenarios/retirement")
def run_retirement(household_id: str, body: RetirementBody, idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict[str, object]:
    ensure_household(household_id)
    result = retirement_baseline(current_assets=body.current_assets, monthly_contribution=body.monthly_contribution, years=body.years_to_retirement, annual_nominal_return=body.annual_nominal_return, annual_fee=body.annual_fee, annual_inflation=body.annual_inflation, expected_net_pension_income=body.expected_net_pension_income, target_monthly_spending=body.target_retirement_spending, withdrawal_rate=body.withdrawal_rate)
    saved = state.save_scenario({"kind": "retirement", "inputs": body.model_dump(mode="json"), "result": result}, require_key(idempotency_key))
    return envelope(saved, ["fact_retirement_assets", "fact_goal_retirement"], result["warnings"], result["engine_version"])


@app.post("/v1/households/{household_id}/scenarios/child-goal")
def run_child_goal(household_id: str, body: ChildGoalBody, idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict[str, object]:
    ensure_household(household_id)
    if os.getenv("ENABLE_CHILD_GOAL", "true").lower() != "true":
        raise HTTPException(status_code=404, detail="Feature not enabled")
    result = child_goal_plan(target_amount=body.target_amount, current_savings=body.current_savings, years=body.years, annual_return=body.annual_return)
    saved = state.save_scenario({"kind": "child_goal", "inputs": body.model_dump(mode="json"), "result": result}, require_key(idempotency_key))
    return envelope(saved, ["household_dependents"], result["warnings"], result["engine_version"])


@app.post("/v1/households/{household_id}/copilot/turns")
def copilot_turn(household_id: str, body: CopilotBody, idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict[str, object]:
    ensure_household(household_id)
    key = require_key(idempotency_key)
    if cached := state.idempotency.get(key):
        return envelope(cached)
    result = scripted_answer(body.question, state)
    state.idempotency[key] = result
    return envelope(result, [sid for claim in result["claims"] for sid in claim["source_ids"]], result["warnings"])


@app.post("/v1/households/{household_id}/adviser-brief")
def adviser_brief(household_id: str, body: BriefBody, idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict[str, object]:
    ensure_household(household_id)
    require_key(idempotency_key)
    selected = [run for run in state.scenarios if not body.selected_run_ids or run["run_id"] in body.selected_run_ids]
    verified = [fact for fact in state.facts if fact["verification_status"] in {"confirmed", "verified"}]
    data = {"brief_id": f"brief_{uuid4().hex[:10]}", "title": "FinTwin Adviser Brief", "household": "Michael & Anna Becker", "verified_facts": verified, "review": state.review(), "selected_scenarios": selected, "questions": ["Welche Rate bleibt bei einer Anschlussfinanzierung tragbar?", "Welche bestätigten Netto-Rentenansprüche fehlen?", "Welche Leistungen enthält Annas Einkommensschutz?"], "disclaimer": "Independent synthetic-data prototype. No product recommendation or financial, tax or legal advice.", "generated_at": datetime.now(UTC).isoformat()}
    return envelope(data, [fact["fact_id"] for fact in verified])


@app.post("/v1/demo/reset")
def reset_demo(idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> dict[str, object]:
    require_key(idempotency_key)
    state.reset()
    return envelope({"reset": True, "twin_version": state.version})
